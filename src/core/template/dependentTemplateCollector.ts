import { WorkspaceIndex } from "../../indexer/types";
import { ParsedDocumentFacts } from "../../indexer/xmlFacts";
import { getComponentVariantKeys } from "../model/indexAccess";

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

  for (const [uriKey, facts] of index.parsedFactsByUri.entries()) {
    const fsPath = uriKeyToFsPath(uriKey);
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
    for (const [uriKey, facts] of index.parsedFactsByUri.entries()) {
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root !== "workflow" && root !== "dataview") {
        continue;
      }

      const fsPath = uriKeyToFsPath(uriKey);
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

function uriKeyToFsPath(uriKey: string): string | undefined {
  const raw = uriKey.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.includes("://")) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "file:") {
        return undefined;
      }
      let pathname = decodeURIComponent(parsed.pathname);
      pathname = pathname.replace(/^\/([A-Za-z]:\/)/, "$1");
      return pathname.replace(/\//g, "\\");
    } catch {
      return undefined;
    }
  }
  return raw;
}

function defaultIsTemplatePath(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/xml_templates/");
}

