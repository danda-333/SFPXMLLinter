import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";

type IndexAccessor = () => WorkspaceIndex;

export class SfpXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: IndexAccessor) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex();
    const facts = parseDocumentFacts(document);

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
      const workflowControlShareCodeDefinitions = collectWorkflowControlShareCodeDefinitions(facts, index);
      const workflowButtonShareCodeDefinitions = collectWorkflowButtonShareCodeDefinitions(facts, index);

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
          const wf = workflowForm;
          if (!wf) {
            continue;
          }
          return wf.controlDefinitions.get(key) ?? wf.formIdentLocation;
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
          const wf = workflowForm;
          if (!wf) {
            continue;
          }
          return wf.buttonDefinitions.get(key) ?? wf.formIdentLocation;
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
          const wf = workflowForm;
          if (!wf) {
            continue;
          }
          return wf.sectionDefinitions.get(key) ?? wf.formIdentLocation;
        }
      }

      if (workflowForm) {
        for (const ref of facts.workflowControlIdentReferences) {
          if (!ref.range.contains(position)) {
            continue;
          }

          return workflowForm.controlDefinitions.get(ref.ident) ?? workflowForm.formIdentLocation;
        }
      }
    }

    const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow" ? facts.workflowFormIdent : facts.formIdent;
    const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
    for (const mappingRef of facts.mappingIdentReferences) {
      if (!mappingRef.range.contains(position) || !owningForm) {
        continue;
      }

      const key = mappingRef.ident;
      if (mappingRef.kind === "fromIdent") {
        return owningForm.controlDefinitions.get(key) ?? owningForm.formIdentLocation;
      }

      const targetFormIdent = mappingRef.mappingFormIdent;
      const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
      if (targetForm) {
        return targetForm.controlDefinitions.get(key) ?? targetForm.formIdentLocation;
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
        const sectionKey = usingRef.sectionValue ?? "";
        return component.sectionDefinitions.get(sectionKey) ?? component.componentLocation;
      }
    }

    return undefined;
  }
}

function inRange(range: vscode.Range | undefined, position: vscode.Position): boolean {
  return range ? range.contains(position) : false;
}

function collectWorkflowControlShareCodeDefinitions(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const [k, v] of component.workflowControlShareCodeDefinitions.entries()) {
      if (!out.has(k)) {
        out.set(k, v);
      }
    }
  }

  return out;
}

function collectWorkflowButtonShareCodeDefinitions(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Map<string, vscode.Location> {
  const out = new Map<string, vscode.Location>();
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const [k, v] of component.workflowButtonShareCodeDefinitions.entries()) {
      if (!out.has(k)) {
        out.set(k, v);
      }
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
