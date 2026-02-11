import * as vscode from "vscode";
import { getSettings } from "../config/settings";

export function isXmlDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "xml";
}

export function toLowerPath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

export function normalizeComponentKey(raw: string): string {
  let key = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");

  if (/\.component\.xml$/i.test(key)) {
    key = key.slice(0, -".component.xml".length);
  } else if (/\.xml$/i.test(key)) {
    key = key.slice(0, -".xml".length);
  }

  return key;
}

export function documentInConfiguredRoots(document: vscode.TextDocument): boolean {
  if (!isXmlDocument(document)) {
    return false;
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return false;
  }

  const rel = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/").toLowerCase();
  const settings = getSettings();

  return settings.workspaceRoots.some((root) => {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    return rel.includes(`/${normalizedRoot}/`) || rel.startsWith(`${normalizedRoot}/`);
  });
}

export async function globConfiguredXmlFiles(): Promise<vscode.Uri[]> {
  const settings = getSettings();
  const includePatterns = settings.workspaceRoots.map((root) => {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return `**/${normalizedRoot}/**/*.xml`;
  });

  const lists = await Promise.all(includePatterns.map((pattern) => vscode.workspace.findFiles(pattern)));
  const map = new Map<string, vscode.Uri>();
  for (const list of lists) {
    for (const uri of list) {
      map.set(uri.toString(), uri);
    }
  }

  return [...map.values()];
}

export function makeRangeFromIndices(text: string, start: number, length: number): vscode.Range {
  const startPos = indexToPosition(text, start);
  const endPos = indexToPosition(text, start + length);
  return new vscode.Range(startPos, endPos);
}

export function indexToPosition(text: string, index: number): vscode.Position {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  const until = text.slice(0, safeIndex);
  const lines = until.split(/\r?\n/);
  const line = lines.length - 1;
  const character = lines[lines.length - 1]?.length ?? 0;
  return new vscode.Position(line, character);
}
