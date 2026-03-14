import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { buildDocumentCompositionModel, collectSelectedDocumentContributions, DocumentCompositionModel } from "../composition/documentModel";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;

export class SfpXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: IndexAccessor) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = parseDocumentFacts(document);
    const documentComposition = buildDocumentCompositionModel(facts, index);

    for (const formRef of facts.formIdentReferences) {
      if (!formRef.range.contains(position)) {
        continue;
      }

      const targetForm = index.formsByIdent.get(formRef.formIdent);
      if (targetForm) {
        return targetForm.formIdentLocation;
      }
    }

    for (const mappingFormRef of facts.mappingFormIdentReferences) {
      if (!mappingFormRef.range.contains(position)) {
        continue;
      }

      const targetForm = index.formsByIdent.get(mappingFormRef.formIdent);
      if (targetForm) {
        return targetForm.formIdentLocation;
      }
    }

    if (facts.rootTag?.toLowerCase() === "workflow") {
      const workflowForm = facts.workflowFormIdent ? index.formsByIdent.get(facts.workflowFormIdent) : undefined;
      const workflowControlShareCodeDefinitions = collectWorkflowControlShareCodeDefinitions(index, documentComposition);
      const workflowButtonShareCodeDefinitions = collectWorkflowButtonShareCodeDefinitions(index, documentComposition);
      const workflowControlDefinitions = collectWorkflowControlDefinitions(workflowForm, index, documentComposition);
      const workflowButtonDefinitions = collectWorkflowButtonDefinitions(workflowForm, index, documentComposition);
      const workflowSectionDefinitions = collectWorkflowSectionDefinitions(workflowForm, index, documentComposition);

      if (workflowForm && inRange(facts.workflowFormIdentRange, position)) {
        return workflowForm.formIdentLocation;
      }

      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        if (ref.kind !== "controlShareCode" && ref.kind !== "buttonShareCode" && !workflowForm) {
          continue;
        }

        const key = ref.ident;
        if (ref.kind === "formControl") {
          return workflowControlDefinitions.get(key) ?? workflowForm?.formIdentLocation;
        }

        if (ref.kind === "controlShareCode") {
          const local = facts.controlShareCodeDefinitions.get(key);
          if (local) {
            return new vscode.Location(document.uri, local);
          }

          const injected = workflowControlShareCodeDefinitions.get(key);
          if (injected) {
            return injected;
          }

          return undefined;
        }

        if (ref.kind === "button") {
          return workflowButtonDefinitions.get(key) ?? workflowForm?.formIdentLocation;
        }

        if (ref.kind === "buttonShareCode") {
          const local = facts.buttonShareCodeDefinitions.get(key);
          if (local) {
            return new vscode.Location(document.uri, local);
          }

          const injected = workflowButtonShareCodeDefinitions.get(key);
          if (injected) {
            return injected;
          }

          return undefined;
        }

        if (ref.kind === "section") {
          return workflowSectionDefinitions.get(key) ?? workflowForm?.formIdentLocation;
        }
      }

      for (const ref of facts.workflowControlIdentReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        return workflowControlDefinitions.get(ref.ident) ?? workflowForm?.formIdentLocation;
      }
    }

    const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow"
      ? facts.workflowFormIdent
      : facts.formIdent ?? facts.rootFormIdent;
    const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
    const workflowControlDefinitionsForMappings =
      facts.rootTag?.toLowerCase() === "workflow"
        ? collectWorkflowControlDefinitions(
            facts.workflowFormIdent ? index.formsByIdent.get(facts.workflowFormIdent) : undefined,
            index,
            documentComposition
          )
        : undefined;
    for (const mappingRef of facts.mappingIdentReferences) {
      if (!mappingRef.range.contains(position) || !owningForm) {
        continue;
      }

      const key = mappingRef.ident;
      if (mappingRef.kind === "fromIdent") {
        if (workflowControlDefinitionsForMappings?.has(key)) {
          return workflowControlDefinitionsForMappings.get(key);
        }
        return owningForm.controlDefinitions.get(key) ?? owningForm.formIdentLocation;
      }

      const targetFormIdent = mappingRef.mappingFormIdent;
      const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
      if (targetForm) {
        return targetForm.controlDefinitions.get(key) ?? targetForm.formIdentLocation;
      }

      if (workflowControlDefinitionsForMappings?.has(key)) {
        return workflowControlDefinitionsForMappings.get(key);
      }

      return owningForm.controlDefinitions.get(key) ?? owningForm.formIdentLocation;
    }

    if (facts.rootTag?.toLowerCase() === "form" && facts.formIdent) {
      const form = index.formsByIdent.get(facts.formIdent);
      if (form) {
        for (const ref of facts.htmlControlReferences) {
          if (!ref.range.contains(position)) {
            continue;
          }

          return form.controlDefinitions.get(ref.ident) ?? form.formIdentLocation;
        }

        const htmlControlIdent = resolveHtmlTemplateControlIdentFromTagContext(document, position);
        if (htmlControlIdent) {
          return form.controlDefinitions.get(htmlControlIdent) ?? form.formIdentLocation;
        }
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
}

function inRange(range: vscode.Range | undefined, position: vscode.Position): boolean {
  return range ? range.contains(position) : false;
}

function collectWorkflowControlShareCodeDefinitions(
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.workflowControlShareCodeIdents) {
      const location = component.workflowControlShareCodeDefinitions.get(ident);
      if (!location || out.has(ident)) {
        continue;
      }
      out.set(ident, location);
    }
  }

  return out;
}

function collectWorkflowButtonShareCodeDefinitions(
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.workflowButtonShareCodeIdents) {
      const location = component.workflowButtonShareCodeDefinitions.get(ident);
      if (!location || out.has(ident)) {
        continue;
      }
      out.set(ident, location);
    }
  }

  return out;
}

function collectWorkflowControlDefinitions(
  workflowForm: import("../indexer/types").IndexedForm | undefined,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const [ident, location] of workflowForm?.controlDefinitions ?? []) {
    out.set(ident, location);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formControlIdents) {
      const location = component.formControlDefinitions.get(ident);
      if (!location || out.has(ident)) {
        continue;
      }
      out.set(ident, location);
    }
  }

  return out;
}

function collectWorkflowButtonDefinitions(
  workflowForm: import("../indexer/types").IndexedForm | undefined,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const [ident, location] of workflowForm?.buttonDefinitions ?? []) {
    out.set(ident, location);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formButtonIdents) {
      const location = component.formButtonDefinitions.get(ident);
      if (!location || out.has(ident)) {
        continue;
      }
      out.set(ident, location);
    }
  }

  return out;
}

function collectWorkflowSectionDefinitions(
  workflowForm: import("../indexer/types").IndexedForm | undefined,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const [ident, location] of workflowForm?.sectionDefinitions ?? []) {
    out.set(ident, location);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formSectionIdents) {
      const location = component.formSectionDefinitions.get(ident);
      if (!location || out.has(ident)) {
        continue;
      }
      out.set(ident, location);
    }
  }

  return out;
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
