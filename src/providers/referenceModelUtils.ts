import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { ParsedDocumentFacts } from "../indexer/xmlFacts";
import { normalizeComponentKey } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { DocumentCompositionModel, collectSelectedDocumentContributions } from "../composition/documentModel";

export type FormSymbolKind = "control" | "button" | "section";

interface FactsEntry {
  uri: vscode.Uri;
  facts: ParsedDocumentFacts;
}

function getFactsEntries(index: WorkspaceIndex): FactsEntry[] {
  const out: FactsEntry[] = [];
  for (const [uriKey, facts] of index.parsedFactsByUri.entries()) {
    try {
      out.push({ uri: vscode.Uri.parse(uriKey), facts });
    } catch {
      // Skip invalid uri keys.
    }
  }
  return out;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function findFormDeclaration(index: WorkspaceIndex, formIdent: string): vscode.Location | undefined {
  for (const entry of getFactsEntries(index)) {
    if ((entry.facts.rootTag ?? "").toLowerCase() !== "form") {
      continue;
    }
    if (!sameText(entry.facts.formIdent, formIdent)) {
      continue;
    }
    if (entry.facts.rootIdentRange) {
      return new vscode.Location(entry.uri, entry.facts.rootIdentRange);
    }
  }

  return undefined;
}

export function findFormSymbolDeclaration(
  index: WorkspaceIndex,
  formIdent: string,
  kind: FormSymbolKind,
  ident: string
): vscode.Location | undefined {
  for (const entry of getFactsEntries(index)) {
    if ((entry.facts.rootTag ?? "").toLowerCase() !== "form") {
      continue;
    }
    if (!sameText(entry.facts.formIdent, formIdent)) {
      continue;
    }

    if (kind === "control") {
      const info = entry.facts.declaredControlInfos.find((item) => item.ident === ident);
      if (info?.range) {
        return new vscode.Location(entry.uri, info.range);
      }
      continue;
    }

    if (kind === "button") {
      const info = entry.facts.declaredButtonInfos.find((item) => item.ident === ident);
      if (info?.range) {
        return new vscode.Location(entry.uri, info.range);
      }
      continue;
    }

    const info = entry.facts.identOccurrences.find((item) => item.kind === "section" && item.ident === ident);
    if (info?.range) {
      return new vscode.Location(entry.uri, info.range);
    }
  }

  return undefined;
}

export function findComponentSymbolDeclaration(
  index: WorkspaceIndex,
  componentKey: string,
  kind: FormSymbolKind,
  ident: string
): vscode.Location | undefined {
  const component = resolveComponentByKey(index, componentKey);
  if (!component) {
    return undefined;
  }

  const facts = index.parsedFactsByUri.get(component.uri.toString());
  if (!facts) {
    return undefined;
  }

  if (kind === "control") {
    const info = facts.declaredControlInfos.find((item) => item.ident === ident);
    return info?.range ? new vscode.Location(component.uri, info.range) : undefined;
  }

  if (kind === "button") {
    const info = facts.declaredButtonInfos.find((item) => item.ident === ident);
    return info?.range ? new vscode.Location(component.uri, info.range) : undefined;
  }

  const info = facts.identOccurrences.find((item) => item.kind === "section" && item.ident === ident);
  return info?.range ? new vscode.Location(component.uri, info.range) : undefined;
}

export function resolveWorkflowDeclaration(
  index: WorkspaceIndex,
  workflowFacts: ParsedDocumentFacts,
  composition: DocumentCompositionModel,
  kind: FormSymbolKind,
  ident: string
): vscode.Location | undefined {
  if (!workflowFacts.workflowFormIdent) {
    return undefined;
  }

  const local = findFormSymbolDeclaration(index, workflowFacts.workflowFormIdent, kind, ident);
  if (local) {
    return local;
  }

  for (const contributionRef of collectSelectedDocumentContributions(composition)) {
    const includeIdent =
      kind === "control"
        ? contributionRef.contribution.formControlIdents.has(ident)
        : kind === "button"
          ? contributionRef.contribution.formButtonIdents.has(ident)
          : contributionRef.contribution.formSectionIdents.has(ident);
    if (!includeIdent) {
      continue;
    }

    const declaration = findComponentSymbolDeclaration(index, contributionRef.componentKey, kind, ident);
    if (declaration) {
      return declaration;
    }
  }

  return undefined;
}

export function collectFormIdentReferenceLocations(index: WorkspaceIndex, formIdent: string): vscode.Location[] {
  const out: vscode.Location[] = [];
  for (const entry of getFactsEntries(index)) {
    for (const ref of entry.facts.formIdentReferences) {
      if (sameText(ref.formIdent, formIdent)) {
        out.push(new vscode.Location(entry.uri, ref.range));
      }
    }
    for (const ref of entry.facts.mappingFormIdentReferences) {
      if (sameText(ref.formIdent, formIdent)) {
        out.push(new vscode.Location(entry.uri, ref.range));
      }
    }
  }
  return out;
}

export function collectWorkflowReferenceLocations(
  index: WorkspaceIndex,
  formIdent: string,
  kind: FormSymbolKind,
  ident: string
): vscode.Location[] {
  const kindMap = kind === "control" ? "formControl" : kind === "button" ? "button" : "section";
  const out: vscode.Location[] = [];

  for (const entry of getFactsEntries(index)) {
    if ((entry.facts.rootTag ?? "").toLowerCase() !== "workflow") {
      continue;
    }
    if (!sameText(entry.facts.workflowFormIdent, formIdent)) {
      continue;
    }
    for (const ref of entry.facts.workflowReferences) {
      if (ref.kind === kindMap && ref.ident === ident) {
        out.push(new vscode.Location(entry.uri, ref.range));
      }
    }
  }

  return out;
}

export function collectHtmlControlReferenceLocations(index: WorkspaceIndex, formIdent: string, controlIdent: string): vscode.Location[] {
  const out: vscode.Location[] = [];

  for (const entry of getFactsEntries(index)) {
    if ((entry.facts.rootTag ?? "").toLowerCase() !== "form") {
      continue;
    }
    if (!sameText(entry.facts.formIdent, formIdent)) {
      continue;
    }
    for (const ref of entry.facts.htmlControlReferences) {
      if (ref.ident === controlIdent) {
        out.push(new vscode.Location(entry.uri, ref.range));
      }
    }
  }

  return out;
}

export function collectComponentReferenceLocations(index: WorkspaceIndex, componentKey: string): vscode.Location[] {
  const normalized = normalizeComponentKey(componentKey);
  const out: vscode.Location[] = [];

  for (const entry of getFactsEntries(index)) {
    for (const ref of entry.facts.usingReferences) {
      if (ref.componentKey === normalized) {
        out.push(new vscode.Location(entry.uri, ref.componentValueRange));
      }
    }
    for (const ref of entry.facts.includeReferences) {
      if (ref.componentKey === normalized) {
        out.push(new vscode.Location(entry.uri, ref.componentValueRange));
      }
    }
    for (const ref of entry.facts.placeholderReferences) {
      if (ref.componentKey === normalized) {
        out.push(new vscode.Location(entry.uri, ref.range));
      }
    }
  }

  return out;
}

export function collectComponentContributionReferenceLocations(
  index: WorkspaceIndex,
  componentKey: string,
  contributionName: string
): vscode.Location[] {
  const normalized = normalizeComponentKey(componentKey);
  const out: vscode.Location[] = [];

  for (const entry of getFactsEntries(index)) {
    for (const ref of entry.facts.usingReferences) {
      if (ref.componentKey === normalized && ref.sectionValue === contributionName && ref.sectionValueRange) {
        out.push(new vscode.Location(entry.uri, ref.sectionValueRange));
      }
    }
    for (const ref of entry.facts.includeReferences) {
      if (ref.componentKey === normalized && ref.sectionValue === contributionName && ref.sectionValueRange) {
        out.push(new vscode.Location(entry.uri, ref.sectionValueRange));
      }
    }
  }

  return out;
}

