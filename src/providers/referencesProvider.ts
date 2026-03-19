import * as vscode from "vscode";
import { WorkspaceIndex, IndexedComponent, IndexedForm } from "../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText } from "../indexer/xmlFacts";
import { documentInConfiguredRoots, normalizeComponentKey } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { getSystemMetadata } from "../config/systemMetadata";
import { getEquivalentFormIdentKeys, resolveSystemTableName } from "../utils/formIdents";
import { buildDocumentCompositionModel, collectSelectedDocumentContributions } from "../composition/documentModel";
import {
  collectComponentContributionReferenceLocations,
  collectComponentReferenceLocations,
  collectFormIdentReferenceLocations,
  collectHtmlControlReferenceLocations,
  collectWorkflowReferenceLocations,
  findFormDeclaration,
  findFormSymbolDeclaration,
  FormSymbolKind,
  resolveWorkflowDeclaration
} from "./referenceModelUtils";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;
type FactsAccessor = (document: vscode.TextDocument) => ReturnType<typeof parseDocumentFactsFromText>;
type SymbolReferencesAccessor = (kind: string, ident: string) => readonly vscode.Location[];

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
  public constructor(
    private readonly getIndex: IndexAccessor,
    private readonly getFactsForDocument?: FactsAccessor,
    private readonly getSymbolReferences?: SymbolReferencesAccessor
  ) {}

  public provideReferences(
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
      const metadata = getSystemMetadata();
      for (const formIdentKey of getEquivalentFormIdentKeys(target.ident, metadata)) {
        for (const location of collectFormIdentReferenceLocations(index, formIdentKey)) {
          pushUniqueLocation(out, seen, location);
        }
      }
      return out;
    }

    if (target.kind === "component") {
      for (const location of collectComponentReferenceLocations(index, target.ident)) {
        pushUniqueLocation(out, seen, location);
      }
      return out;
    }

    if (target.kind === "componentSection") {
      for (const location of collectComponentContributionReferenceLocations(index, target.componentKey ?? "", target.ident)) {
        pushUniqueLocation(out, seen, location);
      }
      return out;
    }

    if (
      target.kind === "componentControlDeclaration" ||
      target.kind === "componentButtonDeclaration" ||
      target.kind === "componentSectionDeclaration"
    ) {
      const formKind: FormSymbolKind =
        target.kind === "componentControlDeclaration"
          ? "control"
          : target.kind === "componentButtonDeclaration"
            ? "button"
            : "section";

      for (const location of collectWorkflowReferencesForComponentDeclarationTarget(index, target.componentKey ?? "", target.ident, formKind)) {
        pushUniqueLocation(out, seen, location);
      }
      return out;
    }

    for (const location of this.getSymbolReferences?.(target.kind, target.ident) ?? []) {
      pushUniqueLocation(out, seen, location);
    }

    const formKind = target.kind as FormSymbolKind;
    for (const location of collectWorkflowReferenceLocations(index, target.formIdent, formKind, target.ident)) {
      pushUniqueLocation(out, seen, location);
    }
    if (target.kind === "control") {
      for (const location of collectHtmlControlReferenceLocations(index, target.formIdent, target.ident)) {
        pushUniqueLocation(out, seen, location);
      }
    }

    return out;
  }

  private resolveReferenceTarget(document: vscode.TextDocument, position: vscode.Position): ReferenceTarget | undefined {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = this.getFactsForDocument?.(document) ?? parseDocumentFacts(document);
    const documentComposition = buildDocumentCompositionModel(facts, index);

    const formEntry = findFormByUri(index, document.uri);
    if (formEntry) {
      const formDeclaration = findFormDeclaration(index, formEntry.ident) ?? formEntry.formIdentLocation;
      if (formDeclaration.range.contains(position)) {
        return {
          formIdent: formEntry.ident,
          ident: formEntry.ident,
          kind: "form",
          declaration: formDeclaration
        };
      }

      const local = findTargetInFormDefinitions(formEntry, facts, position);
      if (local) {
        return local;
      }
    }

    for (const ref of facts.formIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }
      const declaration = findFormDeclaration(index, ref.formIdent);
      if (declaration) {
        return { formIdent: ref.formIdent, ident: ref.formIdent, kind: "form", declaration };
      }

      const systemTable = resolveSystemTableName(ref.formIdent, getSystemMetadata());
      if (systemTable) {
        return {
          formIdent: systemTable,
          ident: ref.formIdent,
          kind: "form",
          declaration: new vscode.Location(document.uri, ref.range)
        };
      }
    }

    for (const ref of facts.mappingFormIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }
      const declaration = findFormDeclaration(index, ref.formIdent);
      if (declaration) {
        return { formIdent: ref.formIdent, ident: ref.formIdent, kind: "form", declaration };
      }

      const systemTable = resolveSystemTableName(ref.formIdent, getSystemMetadata());
      if (systemTable) {
        return {
          formIdent: systemTable,
          ident: ref.formIdent,
          kind: "form",
          declaration: new vscode.Location(document.uri, ref.range)
        };
      }
    }

    for (const usingRef of facts.usingReferences) {
      if (usingRef.componentValueRange.contains(position)) {
        const component = resolveComponentByKey(index, usingRef.componentKey);
        return {
          formIdent: "",
          ident: usingRef.componentKey,
          kind: "component",
          declaration: component?.componentLocation ?? new vscode.Location(document.uri, usingRef.componentValueRange)
        };
      }

      if (usingRef.sectionValue && usingRef.sectionValueRange?.contains(position)) {
        const component = resolveComponentByKey(index, usingRef.componentKey);
        const declaration = component?.contributionDefinitions.get(usingRef.sectionValue) ?? new vscode.Location(document.uri, usingRef.sectionValueRange);
        return {
          formIdent: "",
          ident: usingRef.sectionValue,
          kind: "componentSection",
          declaration,
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

        for (const [section, location] of component.contributionDefinitions.entries()) {
          if (location.range.contains(position)) {
            return {
              formIdent: "",
              ident: section,
              kind: "componentSection",
              declaration: location,
              componentKey: component.key
            };
          }
        }

        for (const info of facts.declaredControlInfos) {
          if (info.range.contains(position)) {
            return {
              formIdent: "",
              ident: info.ident,
              kind: "componentControlDeclaration",
              declaration: new vscode.Location(document.uri, info.range),
              componentKey: component.key
            };
          }
        }

        for (const info of facts.declaredButtonInfos) {
          if (info.range.contains(position)) {
            return {
              formIdent: "",
              ident: info.ident,
              kind: "componentButtonDeclaration",
              declaration: new vscode.Location(document.uri, info.range),
              componentKey: component.key
            };
          }
        }

        for (const occurrence of facts.identOccurrences) {
          if (occurrence.kind === "section" && occurrence.range.contains(position)) {
            return {
              formIdent: "",
              ident: occurrence.ident,
              kind: "componentSectionDeclaration",
              declaration: new vscode.Location(document.uri, occurrence.range),
              componentKey: component.key
            };
          }
        }
      }
    }

    if (facts.rootTag?.toLowerCase() === "form" && facts.formIdent) {
      for (const ref of facts.htmlControlReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        const declaration = findFormSymbolDeclaration(index, facts.formIdent, "control", ref.ident);
        if (!declaration) {
          continue;
        }

        return {
          formIdent: facts.formIdent,
          ident: ref.ident,
          kind: "control",
          declaration
        };
      }
    }

    if (facts.rootTag?.toLowerCase() === "workflow" && facts.workflowFormIdent) {
      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        const kind = toTargetKind(ref.kind);
        if (!kind) {
          continue;
        }

        const declaration = resolveWorkflowDeclaration(index, facts, documentComposition, kind, ref.ident);
        if (!declaration) {
          continue;
        }

        return {
          formIdent: facts.workflowFormIdent,
          ident: ref.ident,
          kind,
          declaration
        };
      }
    }

    return undefined;
  }
}

function collectWorkflowReferencesForComponentDeclarationTarget(
  index: WorkspaceIndex,
  componentKey: string,
  ident: string,
  kind: FormSymbolKind
): vscode.Location[] {
  const normalized = normalizeComponentKey(componentKey);
  const out: vscode.Location[] = [];
  for (const facts of index.parsedFactsByUri.values()) {
    if ((facts.rootTag ?? "").toLowerCase() !== "workflow" || !facts.workflowFormIdent) {
      continue;
    }

    const composition = buildDocumentCompositionModel(facts, index);
    const contains = collectSelectedDocumentContributions(composition).some((entry) => {
      if (normalizeComponentKey(entry.componentKey) !== normalized) {
        return false;
      }
      return kind === "control"
        ? entry.contribution.formControlIdents.has(ident)
        : kind === "button"
          ? entry.contribution.formButtonIdents.has(ident)
          : entry.contribution.formSectionIdents.has(ident);
    });
    if (!contains) {
      continue;
    }

    out.push(...collectWorkflowReferenceLocations(index, facts.workflowFormIdent, kind, ident));
  }
  return out;
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

function findTargetInFormDefinitions(
  form: IndexedForm,
  facts: ReturnType<typeof parseDocumentFacts>,
  position: vscode.Position
): ReferenceTarget | undefined {
  for (const info of facts.declaredControlInfos) {
    if (info.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident: info.ident,
        kind: "control",
        declaration: new vscode.Location(form.uri, info.range)
      };
    }
  }

  for (const info of facts.declaredButtonInfos) {
    if (info.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident: info.ident,
        kind: "button",
        declaration: new vscode.Location(form.uri, info.range)
      };
    }
  }

  for (const occurrence of facts.identOccurrences) {
    if (occurrence.kind === "section" && occurrence.range.contains(position)) {
      return {
        formIdent: form.ident,
        ident: occurrence.ident,
        kind: "section",
        declaration: new vscode.Location(form.uri, occurrence.range)
      };
    }
  }

  return undefined;
}

function toTargetKind(kind: "formControl" | "controlShareCode" | "button" | "buttonShareCode" | "section"): FormSymbolKind | undefined {
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
