import { SystemMetadata } from "../config/systemMetadata";
import { WorkspaceIndex } from "../indexer/types";

const DBO_PREFIX = "dbo.";

export function resolveSystemTableName(formIdent: string, metadata: SystemMetadata): string | undefined {
  const trimmed = formIdent.trim();
  if (!trimmed) {
    return undefined;
  }

  if (metadata.systemTables.has(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith(DBO_PREFIX)) {
    const table = trimmed.slice(DBO_PREFIX.length);
    if (metadata.systemTables.has(table)) {
      return table;
    }
  }

  return undefined;
}

export function isKnownFormIdent(formIdent: string, index: WorkspaceIndex, metadata: SystemMetadata): boolean {
  return index.formsByIdent.has(formIdent) || resolveSystemTableName(formIdent, metadata) !== undefined;
}

export function getAllFormIdentCandidates(index: WorkspaceIndex, metadata: SystemMetadata): string[] {
  const out = new Set<string>();
  for (const form of index.formsByIdent.values()) {
    out.add(form.ident);
  }

  for (const table of metadata.systemTables) {
    out.add(table);
    out.add(`${DBO_PREFIX}${table}`);
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

export function getEquivalentFormIdentKeys(formIdent: string, metadata: SystemMetadata): string[] {
  const systemTable = resolveSystemTableName(formIdent, metadata);
  if (!systemTable) {
    return [formIdent];
  }

  const withSchema = `${DBO_PREFIX}${systemTable}`;
  if (formIdent === withSchema) {
    return [withSchema, systemTable];
  }

  return [systemTable, withSchema];
}
