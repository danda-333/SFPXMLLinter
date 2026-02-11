import * as vscode from "vscode";
import { WorkspaceIndex, IndexedComponent, IndexedForm } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;
type TargetKind =
  | "form"
  | "control"
  | "button"
  | "section"
  | "component"
  | "componentSection"
  | "componentControlDeclaration"
  | "componentButtonDeclaration"
  | "componentSectionDeclaration";

interface ReferenceTarget {
  formIdent: string;
  ident: string;
  kind: TargetKind;
  declaration: vscode.Location;
  componentKey?: string;
}

export class SfpXmlReferencesProvider implements vscode.ReferenceProvider {
  constructor(private readonly getIndex: IndexAccessor) {}

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): vscode.ProviderResult<vscode.Location[]> {
    const target = this.resolveReferenceTarget(document, position);
    if (!target) {
      return [];
    }

    const index = this.getIndex(document.uri);
    const out: vscode.Location[] = [];
    const seen = new Set<string>();

    if (context.includeDeclaration) {
      pushUniqueLocation(out, seen, target.declaration);
    }

    if (target.kind === "form") {
      for (const location of index.formIdentReferenceLocations.get(target.ident) ?? []) {
        pushUniqueLocation(out, seen, location);
      }

      for (const location of index.mappingFormIdentReferenceLocations.get(target.ident) ?? []) {
        pushUniqueLocation(out, seen, location);
      }

      return out;
    }

    if (target.kind === "component") {
      for (const location of index.componentReferenceLocationsByKey.get(target.ident) ?? []) {
        pushUniqueLocation(out, seen, location);
      }
      return out;
    }

    if (target.kind === "componentSection") {
      const componentKey = target.componentKey ?? "";
      for (const location of index.componentSectionReferenceLocationsByKey.get(componentKey)?.get(target.ident) ?? []) {
        pushUniqueLocation(out, seen, location);
      }
      return out;
    }

    if (
      target.kind === "componentControlDeclaration" ||
      target.kind === "componentButtonDeclaration" ||
      target.kind === "componentSectionDeclaration"
    ) {
      const componentKey = target.componentKey ?? "";
      const formIdents = index.componentUsageFormIdentsByKey.get(componentKey) ?? new Set<string>();
      for (const formIdent of formIdents) {
        const byForm =
          target.kind === "componentControlDeclaration"
            ? index.controlReferenceLocationsByFormIdent
            : target.kind === "componentButtonDeclaration"
              ? index.buttonReferenceLocationsByFormIdent
              : index.sectionReferenceLocationsByFormIdent;
        for (const location of byForm.get(formIdent)?.get(target.ident) ?? []) {
          pushUniqueLocation(out, seen, location);
        }
      }

      return out;
    }

    const byForm =
      target.kind === "control"
        ? index.controlReferenceLocationsByFormIdent
        : target.kind === "button"
          ? index.buttonReferenceLocationsByFormIdent
          : index.sectionReferenceLocationsByFormIdent;

    for (const location of byForm.get(target.formIdent)?.get(target.ident) ?? []) {
      pushUniqueLocation(out, seen, location);
    }

    return out;
  }

  private resolveReferenceTarget(document: vscode.TextDocument, position: vscode.Position): ReferenceTarget | undefined {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = parseDocumentFacts(document);

    const formEntry = findFormByUri(index, document.uri);
    if (formEntry) {
      if (formEntry.formIdentLocation.range.contains(position)) {
        return {
          formIdent: formEntry.ident,
          ident: formEntry.ident,
          kind: "form",
          declaration: formEntry.formIdentLocation
        };
      }

      const local = findTargetInFormDefinitions(formEntry, position);
      if (local) {
        return local;
      }
    }

    for (const ref of facts.formIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }

      const form = index.formsByIdent.get(ref.formIdent);
      if (!form) {
        continue;
      }

      return {
        formIdent: form.ident,
        ident: form.ident,
        kind: "form",
        declaration: form.formIdentLocation
      };
    }

    for (const ref of facts.mappingFormIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }

      const form = index.formsByIdent.get(ref.formIdent);
      if (!form) {
        continue;
      }

      return {
        formIdent: form.ident,
        ident: form.ident,
        kind: "form",
        declaration: form.formIdentLocation
      };
    }

    for (const usingRef of facts.usingReferences) {
      if (usingRef.componentValueRange.contains(position)) {
        const component = resolveComponentByKey(index, usingRef.componentKey);
        if (component) {
          return {
            formIdent: "",
            ident: usingRef.componentKey,
            kind: "component",
            declaration: component.componentLocation
          };
        }

        return {
          formIdent: "",
          ident: usingRef.componentKey,
          kind: "component",
          declaration: new vscode.Location(document.uri, usingRef.componentValueRange)
        };
      }

      if (usingRef.sectionValue && usingRef.sectionValueRange?.contains(position)) {
        const component = resolveComponentByKey(index, usingRef.componentKey);
        if (component) {
          const sectionDecl = component.sectionDefinitions.get(usingRef.sectionValue);
          if (sectionDecl) {
            return {
              formIdent: "",
              ident: usingRef.sectionValue,
              kind: "componentSection",
              declaration: sectionDecl,
              componentKey: usingRef.componentKey
            };
          }
        }

        return {
          formIdent: "",
          ident: usingRef.sectionValue,
          kind: "componentSection",
          declaration: new vscode.Location(document.uri, usingRef.sectionValueRange),
          componentKey: usingRef.componentKey
        };
      }
    }

    if (facts.rootTag?.toLowerCase() === "component") {
      const component = findComponentByUri(index, document.uri);
      if (component) {
        const componentTagRange = findComponentTagNameRange(document);
        if (componentTagRange?.contains(position)) {
          return {
            formIdent: "",
            ident: component.key,
            kind: "component",
            declaration: component.componentLocation,
            componentKey: component.key
          };
        }

        for (const [section, location] of component.sectionDefinitions.entries()) {
          if (!location.range.contains(position)) {
            continue;
          }

          return {
            formIdent: "",
            ident: section,
            kind: "componentSection",
            declaration: location,
            componentKey: component.key
          };
        }

        for (const [ident, location] of component.formControlDefinitions.entries()) {
          if (!location.range.contains(position)) {
            continue;
          }

          return {
            formIdent: "",
            ident,
            kind: "componentControlDeclaration",
            declaration: location,
            componentKey: component.key
          };
        }

        for (const [ident, location] of component.formButtonDefinitions.entries()) {
          if (!location.range.contains(position)) {
            continue;
          }

          return {
            formIdent: "",
            ident,
            kind: "componentButtonDeclaration",
            declaration: location,
            componentKey: component.key
          };
        }

        for (const [ident, location] of component.formSectionDefinitions.entries()) {
          if (!location.range.contains(position)) {
            continue;
          }

          return {
            formIdent: "",
            ident,
            kind: "componentSectionDeclaration",
            declaration: location,
            componentKey: component.key
          };
        }
      }
    }

    if (facts.rootTag?.toLowerCase() === "form" && facts.formIdent) {
      const form = index.formsByIdent.get(facts.formIdent);
      if (form) {
        for (const ref of facts.htmlControlReferences) {
          if (!ref.range.contains(position)) {
            continue;
          }

          const declaration = form.controlDefinitions.get(ref.ident);
          if (!declaration) {
            continue;
          }

          return {
            formIdent: form.ident,
            ident: ref.ident,
            kind: "control",
            declaration
          };
        }

        const fromTagContext = resolveHtmlTemplateControlTargetFromTagContext(document, position, form);
        if (fromTagContext) {
          return fromTagContext;
        }
      }
    }

    if (facts.rootTag?.toLowerCase() === "workflow" && facts.workflowFormIdent) {
      const form = index.formsByIdent.get(facts.workflowFormIdent);
      if (!form) {
        return undefined;
      }

      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        const kind = toTargetKind(ref.kind);
        if (!kind) {
          continue;
        }

        const declaration = getDeclarationForKind(form, kind, ref.ident);
        if (!declaration) {
          continue;
        }

        return {
          formIdent: form.ident,
          ident: ref.ident,
          kind,
          declaration
        };
      }
    }

    return undefined;
  }
}

function findFormByUri(index: WorkspaceIndex, uri: vscode.Uri): IndexedForm | undefined {
  for (const form of index.formsByIdent.values()) {
    if (form.uri.toString() === uri.toString()) {
      return form;
    }
  }

  return undefined;
}

function findComponentByUri(index: WorkspaceIndex, uri: vscode.Uri): IndexedComponent | undefined {
  for (const component of index.componentsByKey.values()) {
    if (component.uri.toString() === uri.toString()) {
      return component;
    }
  }

  return undefined;
}

function findTargetInFormDefinitions(form: IndexedForm, position: vscode.Position): ReferenceTarget | undefined {
  for (const [ident, location] of form.controlDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident,
        kind: "control",
        declaration: location
      };
    }
  }

  for (const [ident, location] of form.buttonDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident,
        kind: "button",
        declaration: location
      };
    }
  }

  for (const [ident, location] of form.sectionDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident,
        kind: "section",
        declaration: location
      };
    }
  }

  return undefined;
}

function toTargetKind(kind: "formControl" | "controlShareCode" | "button" | "buttonShareCode" | "section"): Exclude<TargetKind, "form"> | undefined {
  if (kind === "formControl") {
    return "control";
  }

  if (kind === "button") {
    return "button";
  }

  if (kind === "section") {
    return "section";
  }

  return undefined;
}

function getDeclarationForKind(
  form: IndexedForm,
  kind: Exclude<TargetKind, "form">,
  identKey: string
): vscode.Location | undefined {
  if (kind === "control") {
    return form.controlDefinitions.get(identKey);
  }

  if (kind === "button") {
    return form.buttonDefinitions.get(identKey);
  }

  return form.sectionDefinitions.get(identKey);
}

function pushUniqueLocation(target: vscode.Location[], seen: Set<string>, location: vscode.Location): void {
  const key = `${location.uri.toString()}#${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(location);
}

function findComponentTagNameRange(document: vscode.TextDocument): vscode.Range | undefined {
  const text = document.getText();
  const match = /<\s*([A-Za-z_][\w:.-]*)\b/.exec(text);
  if (!match) {
    return undefined;
  }

  const raw = match[1];
  const normalized = raw.split(":").pop() ?? raw;
  if (normalized.toLowerCase() !== "component") {
    return undefined;
  }

  const start = (match.index ?? 0) + match[0].indexOf(raw);
  const end = start + raw.length;
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function resolveHtmlTemplateControlTargetFromTagContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  form: IndexedForm
): ReferenceTarget | undefined {
  const context = getHtmlTemplateTagContext(document, position);
  if (!context) {
    return undefined;
  }

  const declaration = form.controlDefinitions.get(context.ident);
  if (!declaration) {
    return undefined;
  }

  return {
    formIdent: form.ident,
    ident: context.ident,
    kind: "control",
    declaration
  };
}

interface HtmlTemplateTagContext {
  ident: string;
}

function getHtmlTemplateTagContext(document: vscode.TextDocument, position: vscode.Position): HtmlTemplateTagContext | undefined {
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
  const tagName = stripPrefix(rawTag);
  const tagLower = tagName.toLowerCase();
  if (tagLower !== "control" && tagLower !== "controllabel" && tagLower !== "controlplaceholder") {
    return undefined;
  }

  const tagNameStart = lt + fragment.indexOf(rawTag);
  const tagNameEnd = tagNameStart + rawTag.length;
  const isOnTagName = offset >= tagNameStart && offset <= tagNameEnd;

  const attrsStartOffset = fragment.indexOf(attrsRaw);
  const attrsStart = lt + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
  const attrs = parseAttributeInfos(attrsRaw, attrsStart);

  const expectedAttr = tagLower === "control" ? "id" : "controlid";
  const attr = attrs.find((a) => a.name.toLowerCase() === expectedAttr) ?? (tagLower === "control" ? attrs.find((a) => a.name.toLowerCase() === "controlid") : undefined);
  if (!attr?.value) {
    return undefined;
  }

  const isOnAttrName = offset >= attr.nameStart && offset <= attr.nameEnd;
  const isOnAttrValue = offset >= attr.valueStart && offset <= attr.valueEnd;
  if (!isOnTagName && !isOnAttrName && !isOnAttrValue) {
    return undefined;
  }

  return { ident: attr.value };
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
