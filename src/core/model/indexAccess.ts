import type * as vscode from "vscode";
import type { WorkspaceIndex, IndexedComponent, IndexedForm } from "../../indexer/types";
import type { ParsedDocumentFacts } from "../../indexer/xmlFacts";

export type FactsByUriAccessor = (
  uri: vscode.Uri,
  index: WorkspaceIndex
) => ParsedDocumentFacts | undefined;

export type UriKeyParser = (uriKey: string) => vscode.Uri | undefined;

export interface IndexedFactsEntry {
  uri: vscode.Uri;
  facts: ParsedDocumentFacts;
}

export function getParsedFactsByUri(
  index: WorkspaceIndex,
  uri: vscode.Uri,
  getFactsForUri?: FactsByUriAccessor
): ParsedDocumentFacts | undefined {
  if (getFactsForUri) {
    const fromAccessor = getFactsForUri(uri, index);
    if (fromAccessor) {
      return fromAccessor;
    }
  }

  const direct = index.parsedFactsByUri.get(uri.toString());
  if (direct) {
    return direct;
  }

  const normalizedTarget = normalizeUriLike(uri);
  for (const [key, fallbackFacts] of index.parsedFactsByUri.entries()) {
    const normalizedKey = normalizeUriKey(key);
    if (normalizedKey === normalizedTarget) {
      return fallbackFacts;
    }
  }

  return undefined;
}

export function getIndexedFormByIdent(
  index: WorkspaceIndex,
  formIdent: string | undefined
): IndexedForm | undefined {
  if (!formIdent) {
    return undefined;
  }
  return index.formsByIdent.get(formIdent);
}

export function getIndexedForms(index: WorkspaceIndex): IndexedForm[] {
  return [...index.formsByIdent.values()];
}

export function countIndexedForms(index: WorkspaceIndex): number {
  return index.formsByIdent.size;
}

export function hasIndexedFormIdent(index: WorkspaceIndex, formIdent: string): boolean {
  return index.formsByIdent.has(formIdent);
}

export function getIndexedComponents(index: WorkspaceIndex): IndexedComponent[] {
  return [...index.componentsByKey.values()];
}

export function getIndexedComponentKeys(index: WorkspaceIndex): string[] {
  return [...index.componentsByKey.keys()];
}

export function getParsedFactsEntries(
  index: WorkspaceIndex,
  getFactsForUri: FactsByUriAccessor | undefined,
  parseUriKey: UriKeyParser
): IndexedFactsEntry[] {
  const out: IndexedFactsEntry[] = [];
  for (const [uriKey, fallbackFacts] of index.parsedFactsByUri.entries()) {
    const uri = parseUriKey(uriKey);
    if (!uri) {
      continue;
    }
    let facts: ParsedDocumentFacts | undefined;
    if (getFactsForUri) {
      facts = getFactsForUri(uri, index) ?? fallbackFacts;
    } else {
      facts = fallbackFacts;
    }
    if (!facts) {
      continue;
    }
    out.push({ uri, facts });
  }
  return out;
}

export function getComponentKeysForUri(index: WorkspaceIndex, uri: vscode.Uri): Set<string> {
  const out = new Set<string>();
  const direct = index.componentKeyByUri.get(uri.toString());
  if (direct) {
    out.add(direct);
  }

  const normalizedTarget = normalizeUriLike(uri);
  for (const [key, componentKey] of index.componentKeyByUri.entries()) {
    if (normalizeUriKey(key) === normalizedTarget) {
      out.add(componentKey);
    }
  }

  return out;
}

export function getComponentVariantKeys(index: WorkspaceIndex, componentKey: string): Set<string> {
  const out = new Set<string>();
  const normalized = componentKey.trim();
  if (!normalized) {
    return out;
  }

  out.add(normalized);
  const baseName = normalized.split("/").pop() ?? normalized;
  const variants = index.componentKeysByBaseName.get(baseName);
  if (!variants || variants.size === 0) {
    return out;
  }
  for (const variant of variants) {
    out.add(variant);
  }
  return out;
}

export function countIndexedParsedFacts(index: WorkspaceIndex): number {
  return index.parsedFactsByUri.size;
}

function normalizeUriLike(uri: vscode.Uri): string {
  return normalizeUriKey(uri.toString());
}

function normalizeUriKey(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return raw;
  }

  if (raw.includes("://")) {
    try {
      const url = new URL(raw);
      if (url.protocol === "file:") {
        // URL pathname can start with "/C:/..." on Windows.
        const pathname = decodeURIComponent(url.pathname);
        return normalizePathLike(pathname);
      }
    } catch {
      // Fall back to raw normalize below.
    }
  }

  return normalizePathLike(raw);
}

function normalizePathLike(value: string): string {
  let out = value.replace(/\\/g, "/");
  out = out.replace(/^\/([a-zA-Z]:\/)/, "$1");
  return out.toLowerCase();
}
