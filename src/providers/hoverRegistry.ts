import * as vscode from "vscode";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { getSettings } from "../config/settings";
import { documentInConfiguredRoots } from "../utils/paths";

export interface HoverContentResolver {
  resolve(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.MarkdownString | undefined>;
}

export class HoverRegistry implements vscode.HoverProvider {
  constructor(private readonly resolvers: HoverContentResolver[]) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    for (const resolver of this.resolvers) {
      const content = await resolver.resolve(document, position);
      if (content) {
        return new vscode.Hover(content);
      }
    }

    return undefined;
  }
}

interface HoverDocEntry {
  tag?: string;
  attribute?: string;
  value?: string;
  summary: string;
  details?: string;
}

interface HoverDocsFile {
  entries?: HoverDocEntry[];
}

interface ResolvedHoverDocEntry extends HoverDocEntry {
  sourcePriority: number;
  entryPriority: number;
}

interface XmlHoverContext {
  tagName?: string;
  attributeName?: string;
  attributeValue?: string;
}

export class DocumentationHoverResolver implements HoverContentResolver {
  private docsCache: ResolvedHoverDocEntry[] = [];
  private dirty = true;
  private loadPromise: Promise<void> | undefined;

  public markDirty(): void {
    this.dirty = true;
  }

  async resolve(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.MarkdownString | undefined> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const context = getHoverContext(document, position);
    if (!context.tagName && !context.attributeName) {
      return undefined;
    }

    await this.ensureLoaded();
    if (this.docsCache.length === 0) {
      return undefined;
    }

    const matched = findBestEntry(this.docsCache, context);
    if (!matched) {
      return undefined;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${escapeMarkdown(matched.summary)}**`);
    if (matched.details) {
      md.appendMarkdown(`\n\n${escapeMarkdown(matched.details)}`);
    }

    return md;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = (async () => {
      this.docsCache = await loadHoverDocs();
      this.dirty = false;
      this.loadPromise = undefined;
    })();

    await this.loadPromise;
  }
}

async function loadHoverDocs(): Promise<ResolvedHoverDocEntry[]> {
  const settings = getSettings();
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return [];
  }

  const entries: ResolvedHoverDocEntry[] = [];
  let sourcePriority = 0;
  for (const folder of folders) {
    for (const filePath of settings.hoverDocsFiles) {
      sourcePriority++;
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(folder.uri.fsPath, filePath);
      try {
        const raw = await fs.readFile(resolved, "utf8");
        const parsed = JSON.parse(raw) as HoverDocsFile;
        if (!parsed.entries || !Array.isArray(parsed.entries)) {
          continue;
        }

        let entryPriority = 0;
        for (const entry of parsed.entries) {
          entryPriority++;
          if (entry && typeof entry.summary === "string" && entry.summary.trim().length > 0) {
            entries.push({
              ...entry,
              sourcePriority,
              entryPriority
            });
          }
        }
      } catch {
        // Ignore missing/invalid docs file, resolver remains best-effort.
      }
    }
  }

  return entries;
}

function findBestEntry(entries: ResolvedHoverDocEntry[], ctx: XmlHoverContext): ResolvedHoverDocEntry | undefined {
  const candidates = entries.filter((entry) => matchesEntry(entry, ctx));
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    const scoreDelta = scoreEntry(b, ctx) - scoreEntry(a, ctx);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const sourceDelta = b.sourcePriority - a.sourcePriority;
    if (sourceDelta !== 0) {
      return sourceDelta;
    }

    return b.entryPriority - a.entryPriority;
  });
  return candidates[0];
}

function matchesEntry(entry: HoverDocEntry, ctx: XmlHoverContext): boolean {
  if (entry.tag && !equalsCI(entry.tag, ctx.tagName)) {
    return false;
  }

  if (entry.attribute && !equalsCI(entry.attribute, ctx.attributeName)) {
    return false;
  }

  if (entry.value && !equalsCI(entry.value, ctx.attributeValue)) {
    return false;
  }

  return true;
}

function scoreEntry(entry: HoverDocEntry, ctx: XmlHoverContext): number {
  let score = 0;
  if (entry.tag && equalsCI(entry.tag, ctx.tagName)) {
    score += 10;
  }
  if (entry.attribute && equalsCI(entry.attribute, ctx.attributeName)) {
    score += 20;
  }
  if (entry.value && equalsCI(entry.value, ctx.attributeValue)) {
    score += 30;
  }
  return score;
}

function equalsCI(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

function getHoverContext(document: vscode.TextDocument, position: vscode.Position): XmlHoverContext {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.slice(0, offset);
  const lastLt = before.lastIndexOf("<");
  const lastGt = before.lastIndexOf(">");

  if (lastLt < 0 || lastLt < lastGt) {
    return {};
  }

  const nextGtOffset = text.indexOf(">", lastLt);
  const tagEnd = nextGtOffset >= 0 ? nextGtOffset + 1 : text.length;
  const tagText = text.slice(lastLt, tagEnd);

  const tagNameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tagText);
  const tagName = tagNameMatch?.[1];

  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attrName: string | undefined;
  let attrValue: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(tagText)) !== null) {
    const name = match[1];
    const nameStart = lastLt + match.index;
    const nameEnd = nameStart + name.length;

    const value = match[3] ?? match[4] ?? "";
    const valueIndex = match[0].indexOf(value);
    const valueStart = lastLt + match.index + valueIndex;
    const valueEnd = valueStart + value.length;

    if (offset >= nameStart && offset <= nameEnd) {
      attrName = name;
      break;
    }

    if (offset >= valueStart && offset <= valueEnd) {
      attrName = name;
      attrValue = value;
      break;
    }
  }

  return {
    tagName,
    attributeName: attrName,
    attributeValue: attrValue
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
