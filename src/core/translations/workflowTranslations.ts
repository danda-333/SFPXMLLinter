import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export interface TranslationRecord {
  key: string;
  value: string;
  languageId: number;
  sourceUri: vscode.Uri;
  sourceLine: number;
}

export interface TranslationCollision {
  key: string;
  languageId: number;
  entries: TranslationRecord[];
}

export interface WorkflowTranslationSnapshot {
  enabled: boolean;
  byKey: Map<string, string>;
  collisions: TranslationCollision[];
  scannedFiles: vscode.Uri[];
}

export interface WorkflowTranslationsSettings {
  enabled: boolean;
  languageId: number;
  resourcesRoots: string[];
}

interface CsvCell {
  value: string;
  line: number;
}

interface CsvRow {
  cells: CsvCell[];
}

export class WorkflowTranslationsService {
  private cache: WorkflowTranslationSnapshot | undefined;
  private cacheKey: string | undefined;

  public constructor(
    private readonly publishDiagnostics: (updates: ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]>) => void,
    private readonly log: (message: string) => void
  ) {}

  public invalidate(): void {
    this.cache = undefined;
    this.cacheKey = undefined;
  }

  public getSnapshot(settings: WorkflowTranslationsSettings): WorkflowTranslationSnapshot {
    const key = JSON.stringify({
      enabled: settings.enabled,
      languageId: settings.languageId,
      resourcesRoots: settings.resourcesRoots
    });
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }

    const snapshot = this.buildSnapshot(settings);
    this.cache = snapshot;
    this.cacheKey = key;
    this.publishCollisionDiagnostics(snapshot);
    return snapshot;
  }

  private buildSnapshot(settings: WorkflowTranslationsSettings): WorkflowTranslationSnapshot {
    if (!settings.enabled) {
      return { enabled: false, byKey: new Map(), collisions: [], scannedFiles: [] };
    }

    const roots = this.resolveExistingRoots(settings.resourcesRoots);
    if (roots.length === 0) {
      return { enabled: false, byKey: new Map(), collisions: [], scannedFiles: [] };
    }

    const csvFiles: string[] = [];
    for (const root of roots) {
      this.collectCsvFiles(root, csvFiles);
    }
    csvFiles.sort((a, b) => a.localeCompare(b));

    const byComposite = new Map<string, TranslationRecord[]>();
    const scannedFiles: vscode.Uri[] = [];
    for (const file of csvFiles) {
      const uri = vscode.Uri.file(file);
      scannedFiles.push(uri);
      const rows = this.readCsvRows(file);
      if (!rows.length) {
        continue;
      }

      const header = rows[0].cells.map((cell) => normalizeHeader(cell.value));
      const keyIndex = header.indexOf("klíč") >= 0 ? header.indexOf("klíč") : header.indexOf("klic");
      const valueIndex = header.indexOf("hodnota");
      const languageIndex = header.indexOf("jazyk");
      if (keyIndex < 0 || valueIndex < 0 || languageIndex < 0) {
        continue;
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const keyCell = row.cells[keyIndex];
        const valueCell = row.cells[valueIndex];
        const languageCell = row.cells[languageIndex];
        if (!keyCell || !valueCell || !languageCell) {
          continue;
        }

        const key = keyCell.value.trim();
        if (!key) {
          continue;
        }

        const languageId = Number.parseInt(languageCell.value.trim(), 10);
        if (!Number.isFinite(languageId) || languageId !== settings.languageId) {
          continue;
        }

        const record: TranslationRecord = {
          key,
          value: valueCell.value,
          languageId,
          sourceUri: uri,
          sourceLine: Math.max(0, keyCell.line)
        };
        const composite = `${record.key}@@${record.languageId}`;
        const existing = byComposite.get(composite);
        if (existing) {
          existing.push(record);
        } else {
          byComposite.set(composite, [record]);
        }
      }
    }

    const byKey = new Map<string, string>();
    const collisions: TranslationCollision[] = [];
    for (const entries of byComposite.values()) {
      if (entries.length > 1) {
        const [first] = entries;
        collisions.push({ key: first.key, languageId: first.languageId, entries: [...entries] });
        continue;
      }

      const [entry] = entries;
      byKey.set(entry.key, entry.value);
    }

    return {
      enabled: true,
      byKey,
      collisions,
      scannedFiles
    };
  }

  private resolveExistingRoots(resourceRoots: string[]): string[] {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const existing = new Set<string>();
    for (const folder of workspaceFolders) {
      for (const root of resourceRoots) {
        const full = path.resolve(folder.uri.fsPath, root);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          existing.add(full);
        }
      }
    }

    return [...existing];
  }

  private collectCsvFiles(dir: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.collectCsvFiles(full, out);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
        out.push(full);
      }
    }
  }

  private readCsvRows(filePath: string): CsvRow[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      this.log(`translations: failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }

    return parseSemicolonCsv(content);
  }

  private publishCollisionDiagnostics(snapshot: WorkflowTranslationSnapshot): void {
    const updates: Array<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]> = snapshot.scannedFiles.map((uri) => [uri, undefined]);
    const byUri = new Map<string, vscode.Diagnostic[]>();
    if (snapshot.enabled && snapshot.collisions.length > 0) {
      for (const collision of snapshot.collisions) {
        for (const entry of collision.entries) {
          const key = entry.sourceUri.toString();
          const list = byUri.get(key) ?? [];
          const line = Math.max(0, entry.sourceLine);
          const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, Number.MAX_SAFE_INTEGER));
          list.push(
            new vscode.Diagnostic(
              range,
              `[translation-collision] Translation key '${collision.key}' with language '${collision.languageId}' is defined multiple times; value is ignored for inlay hints.`,
              vscode.DiagnosticSeverity.Warning
            )
          );
          byUri.set(key, list);
        }
      }
    }

    for (const [uri, diagnostics] of byUri.entries()) {
      updates.push([vscode.Uri.parse(uri), diagnostics]);
    }
    this.publishDiagnostics(updates);
  }
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function parseSemicolonCsv(raw: string): CsvRow[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: CsvRow[] = [];
  let currentCells: CsvCell[] = [];
  let currentValue = "";
  let inQuotes = false;
  let line = 0;
  let cellStartLine = 0;

  const pushCell = () => {
    currentCells.push({ value: currentValue, line: cellStartLine });
    currentValue = "";
  };

  const pushRow = () => {
    if (currentCells.length === 1 && currentCells[0].value === "" && rows.length > 0) {
      currentCells = [];
      return;
    }
    rows.push({ cells: currentCells });
    currentCells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        currentValue += "\"";
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === ";") {
      pushCell();
      cellStartLine = line;
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      pushCell();
      pushRow();
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      line++;
      cellStartLine = line;
      continue;
    }

    currentValue += ch;
  }

  if (currentValue.length > 0 || currentCells.length > 0) {
    pushCell();
    pushRow();
  }

  return rows;
}
