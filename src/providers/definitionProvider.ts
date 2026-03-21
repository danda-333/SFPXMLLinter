import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { buildDocumentCompositionModel, collectSelectedDocumentContributions } from "../composition/documentModel";
import {
  FactsByUriAccessor,
  findFormDeclaration,
  findFormSymbolDeclaration,
  resolveWorkflowDeclaration
} from "./referenceModelUtils";
import { getParsedFactsByUri } from "../core/model/indexAccess";
import { resolveDocumentFacts } from "../core/model/factsResolution";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;
type FactsAccessor = (document: vscode.TextDocument) => ReturnType<typeof parseDocumentFactsFromText> | undefined;
type ModelVersionAccessor = () => number;

export class SfpXmlDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(
    private readonly getIndex: IndexAccessor,
    private readonly getFactsForDocument?: FactsAccessor,
    private readonly getFactsForUri?: FactsByUriAccessor,
    private readonly getModelVersion?: ModelVersionAccessor
  ) {}

  public provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    return this.withConsistentSnapshot(() => this.provideDefinitionInternal(document, position));
  }

  private provideDefinitionInternal(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = resolveDocumentFacts(document, index, {
      getFactsForDocument: this.getFactsForDocument,
      getFactsForUri: this.getFactsForUri ? ((uri, _index) => this.getFactsForUri?.(uri)) : undefined,
      parseFacts: parseDocumentFacts,
      mode: "strict-accessor"
    });
    if (!facts) {
      return undefined;
    }
    const documentComposition = buildDocumentCompositionModel(facts, index);

    for (const formRef of facts.formIdentReferences) {
      if (!formRef.range.contains(position)) {
        continue;
      }
      const target = findFormDeclaration(index, formRef.formIdent, this.getFactsForUri);
      if (target) {
        return target;
      }
    }

    for (const mappingFormRef of facts.mappingFormIdentReferences) {
      if (!mappingFormRef.range.contains(position)) {
        continue;
      }
      const target = findFormDeclaration(index, mappingFormRef.formIdent, this.getFactsForUri);
      if (target) {
        return target;
      }
    }

    if (facts.rootTag?.toLowerCase() === "workflow") {
      if (inRange(facts.workflowFormIdentRange, position) && facts.workflowFormIdent) {
        return findFormDeclaration(index, facts.workflowFormIdent, this.getFactsForUri);
      }

      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        if (ref.kind === "formControl") {
          return facts.workflowFormIdent
            ? resolveWorkflowDeclaration(index, facts, documentComposition, "control", ref.ident, this.getFactsForUri)
            : undefined;
        }

        if (ref.kind === "button") {
          return facts.workflowFormIdent
            ? resolveWorkflowDeclaration(index, facts, documentComposition, "button", ref.ident, this.getFactsForUri)
            : undefined;
        }

        if (ref.kind === "section") {
          return facts.workflowFormIdent
            ? resolveWorkflowDeclaration(index, facts, documentComposition, "section", ref.ident, this.getFactsForUri)
            : undefined;
        }

        if (ref.kind === "controlShareCode") {
          const local = facts.controlShareCodeDefinitions.get(ref.ident);
          if (local) {
            return new vscode.Location(document.uri, local);
          }
          const injected = findInjectedShareCodeDefinition(index, documentComposition, "control", ref.ident, this.getFactsForUri);
          if (injected) {
            return injected;
          }
        }

        if (ref.kind === "buttonShareCode") {
          const local = facts.buttonShareCodeDefinitions.get(ref.ident);
          if (local) {
            return new vscode.Location(document.uri, local);
          }
          const injected = findInjectedShareCodeDefinition(index, documentComposition, "button", ref.ident, this.getFactsForUri);
          if (injected) {
            return injected;
          }
        }
      }

      for (const ref of facts.workflowControlIdentReferences) {
        if (!ref.range.contains(position) || !facts.workflowFormIdent) {
          continue;
        }
        const resolved = resolveWorkflowDeclaration(index, facts, documentComposition, "control", ref.ident, this.getFactsForUri);
        if (resolved) {
          return resolved;
        }
      }
    }

    const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow"
      ? facts.workflowFormIdent
      : facts.formIdent ?? facts.rootFormIdent;
    for (const mappingRef of facts.mappingIdentReferences) {
      if (!mappingRef.range.contains(position) || !owningFormIdent) {
        continue;
      }

      if (mappingRef.kind === "fromIdent") {
        if (facts.rootTag?.toLowerCase() === "workflow") {
          return resolveWorkflowDeclaration(index, facts, documentComposition, "control", mappingRef.ident, this.getFactsForUri);
        }
        return findFormSymbolDeclaration(index, owningFormIdent, "control", mappingRef.ident, this.getFactsForUri)
          ?? findFormDeclaration(index, owningFormIdent, this.getFactsForUri);
      }

      const targetFormIdent = mappingRef.mappingFormIdent;
      if (targetFormIdent) {
        return findFormSymbolDeclaration(index, targetFormIdent, "control", mappingRef.ident, this.getFactsForUri)
          ?? findFormDeclaration(index, targetFormIdent, this.getFactsForUri);
      }

      if (facts.rootTag?.toLowerCase() === "workflow") {
        return resolveWorkflowDeclaration(index, facts, documentComposition, "control", mappingRef.ident, this.getFactsForUri);
      }

      return findFormSymbolDeclaration(index, owningFormIdent, "control", mappingRef.ident, this.getFactsForUri)
        ?? findFormDeclaration(index, owningFormIdent, this.getFactsForUri);
    }

    if (facts.rootTag?.toLowerCase() === "form" && facts.formIdent) {
      for (const ref of facts.htmlControlReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }
        return findFormSymbolDeclaration(index, facts.formIdent, "control", ref.ident, this.getFactsForUri)
          ?? findFormDeclaration(index, facts.formIdent, this.getFactsForUri);
      }

      const htmlControlIdent = resolveHtmlTemplateControlIdentFromTagContext(document, position);
      if (htmlControlIdent) {
        return findFormSymbolDeclaration(index, facts.formIdent, "control", htmlControlIdent, this.getFactsForUri)
          ?? findFormDeclaration(index, facts.formIdent, this.getFactsForUri);
      }
    }

    for (const usingRef of facts.usingReferences) {
      const component = resolveComponentByKey(index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      if (usingRef.componentValueRange.contains(position)) {
        return component.componentLocation;
      }

      if (usingRef.sectionValueRange?.contains(position)) {
        const contributionKey = usingRef.sectionValue ?? "";
        return component.contributionDefinitions.get(contributionKey) ?? component.componentLocation;
      }
    }

    return undefined;
  }

  private withConsistentSnapshot<T>(compute: () => T): T {
    if (!this.getModelVersion) {
      return compute();
    }
    const start = this.getModelVersion();
    const first = compute();
    const end = this.getModelVersion();
    if (start === end) {
      return first;
    }
    return compute();
  }
}

function inRange(range: vscode.Range | undefined, position: vscode.Position): boolean {
  return range ? range.contains(position) : false;
}

function findInjectedShareCodeDefinition(
  index: WorkspaceIndex,
  documentComposition: ReturnType<typeof buildDocumentCompositionModel>,
  kind: "control" | "button",
  ident: string,
  getFactsForUri?: FactsByUriAccessor
): vscode.Location | undefined {
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }
    const facts = getParsedFactsByUri(index, component.uri, getFactsForUri, "strict-accessor");
    if (!facts) {
      continue;
    }

    if (kind === "control") {
      const range = facts.controlShareCodeDefinitions.get(ident);
      if (range) {
        return new vscode.Location(component.uri, range);
      }
      continue;
    }

    const range = facts.buttonShareCodeDefinitions.get(ident);
    if (range) {
      return new vscode.Location(component.uri, range);
    }
  }

  return undefined;
}

function resolveHtmlTemplateControlIdentFromTagContext(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);

  const lt = text.lastIndexOf("<", offset);
  if (lt < 0) {
    return undefined;
  }

  const gtBefore = text.lastIndexOf(">", offset);
  if (gtBefore > lt) {
    return undefined;
  }

  const gt = text.indexOf(">", lt);
  if (gt < 0 || offset > gt) {
    return undefined;
  }

  const fragment = text.slice(lt, gt + 1);
  if (/^<\s*\//.test(fragment)) {
    return undefined;
  }

  const tagMatch = /^<\s*([A-Za-z_][\w:.-]*)\b([\s\S]*?)\/?\s*>$/.exec(fragment);
  if (!tagMatch) {
    return undefined;
  }

  const rawTag = tagMatch[1];
  const attrsRaw = tagMatch[2] ?? "";
  const tagName = stripPrefix(rawTag).toLowerCase();
  if (tagName !== "control" && tagName !== "controllabel" && tagName !== "controlplaceholder") {
    return undefined;
  }

  const tagNameStart = lt + fragment.indexOf(rawTag);
  const tagNameEnd = tagNameStart + rawTag.length;
  const isOnTagName = offset >= tagNameStart && offset <= tagNameEnd;

  const attrsStartOffset = fragment.indexOf(attrsRaw);
  const attrsStart = lt + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
  const attrs = parseAttributeInfos(attrsRaw, attrsStart);
  const expectedAttr = tagName === "control" ? "id" : "controlid";
  const attr = attrs.find((a) => a.name.toLowerCase() === expectedAttr) ?? (tagName === "control" ? attrs.find((a) => a.name.toLowerCase() === "controlid") : undefined);
  if (!attr?.value) {
    return undefined;
  }

  const isOnAttrName = offset >= attr.nameStart && offset <= attr.nameEnd;
  const isOnAttrValue = offset >= attr.valueStart && offset <= attr.valueEnd;
  if (!isOnTagName && !isOnAttrName && !isOnAttrValue) {
    return undefined;
  }

  return attr.value;
}

interface AttributeInfo {
  name: string;
  value: string;
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
}

function parseAttributeInfos(rawAttrs: string, attrsStart: number): AttributeInfo[] {
  const out: AttributeInfo[] = [];
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawAttrs)) !== null) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    const valueOffsetInMatch = match[0].indexOf(value);
    if (valueOffsetInMatch < 0) {
      continue;
    }

    const nameStart = attrsStart + match.index;
    const nameEnd = nameStart + name.length;
    const valueStart = attrsStart + match.index + valueOffsetInMatch;
    const valueEnd = valueStart + value.length;
    out.push({ name, value, nameStart, nameEnd, valueStart, valueEnd });
  }

  return out;
}

function stripPrefix(value: string): string {
  const parts = value.split(":");
  return parts[parts.length - 1];
}

