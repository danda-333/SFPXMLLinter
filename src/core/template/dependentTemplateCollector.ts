import { WorkspaceIndex } from "../../indexer/types";
import { ParsedDocumentFacts } from "../../indexer/xmlFacts";
import { getComponentVariantKeys, getParsedFactsEntries } from "../model/indexAccess";

export interface CollectDependentTemplatePathsFromIndexOptions {
  isTemplatePath?: (fsPath: string) => boolean;
}

export function collectDependentTemplatePathsFromIndex(
  index: WorkspaceIndex,
  componentKey: string,
  options?: CollectDependentTemplatePathsFromIndexOptions
): string[] {
  const candidateKeys = getComponentVariantKeys(index, componentKey);
  if (candidateKeys.size === 0) {
    return [];
  }

  const result = new Set<string>();
  const affectedFormIdents = new Set<string>();
  const isTemplatePath = options?.isTemplatePath ?? defaultIsTemplatePath;

  for (const { uri, facts } of getParsedFactsEntries(index, undefined, parseIndexUriKeyForCollector)) {
    const fsPath = uri.fsPath;
    if (!fsPath || !isTemplatePath(fsPath)) {
      continue;
    }

    const usingHit = facts.usingReferences.some((ref) => candidateKeys.has(ref.componentKey));
    const includeHit = facts.includeReferences.some((ref) => candidateKeys.has(ref.componentKey));
    const placeholderHit = facts.placeholderReferences.some((ref) => ref.componentKey && candidateKeys.has(ref.componentKey));
    if (!usingHit && !includeHit && !placeholderHit) {
      continue;
    }

    result.add(fsPath);
    const owningFormIdent = resolveOwningFormIdent(facts);
    if (owningFormIdent && (facts.rootTag ?? "").toLowerCase() === "form") {
      affectedFormIdents.add(owningFormIdent);
    }
  }

  // Important: include sibling Workflow/DataView templates for affected Forms
  // regardless of the current component contribution metadata. A component change
  // can remove prior non-form contributions and still requires cleanup rebuild.
  if (affectedFormIdents.size > 0) {
    for (const { uri, facts } of getParsedFactsEntries(index, undefined, parseIndexUriKeyForCollector)) {
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root !== "workflow" && root !== "dataview") {
        continue;
      }

      const fsPath = uri.fsPath;
      if (!fsPath || !isTemplatePath(fsPath)) {
        continue;
      }

      const owningFormIdent = resolveOwningFormIdent(facts);
      if (!owningFormIdent || !affectedFormIdents.has(owningFormIdent)) {
        continue;
      }

      result.add(fsPath);
    }
  }

  return [...result].sort((a, b) => a.localeCompare(b));
}

function resolveOwningFormIdent(facts: ParsedDocumentFacts): string | undefined {
  const root = (facts.rootTag ?? "").toLowerCase();
  if (root === "form") {
    return facts.formIdent;
  }
  if (root === "workflow") {
    return facts.workflowFormIdent ?? facts.rootFormIdent;
  }
  if (root === "dataview") {
    return facts.rootFormIdent;
  }
  return undefined;
}

function parseIndexUriKeyForCollector(uriKey: string): any {
  const raw = uriKey.trim();
  if (!raw) {
    return undefined;
  }

  if (raw.includes("://")) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "file:") {
        return undefined;
      }
      const fsPath = decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:\/)/, "$1");
      return { fsPath };
    } catch {
      return undefined;
    }
  }

  return { fsPath: raw };
}

function defaultIsTemplatePath(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/xml_templates/");
}

