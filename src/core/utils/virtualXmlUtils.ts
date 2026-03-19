import * as vscode from "vscode";
import * as fs from "node:fs/promises";

export async function readWorkspaceFileText(uri: vscode.Uri): Promise<string> {
  let text: string;
  if (uri.scheme === "file") {
    try {
      text = await fs.readFile(uri.fsPath, "utf8");
    } catch {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder("utf-8").decode(bytes);
    }
  } else {
    const bytes = await vscode.workspace.fs.readFile(uri);
    text = new TextDecoder("utf-8").decode(bytes);
  }

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function createVirtualXmlDocument(uri: vscode.Uri, text: string): vscode.TextDocument {
  const lineStarts = computeLineStarts(text);
  const lineCount = lineStarts.length;
  const doc = {
    uri,
    languageId: "xml",
    version: 0,
    lineCount,
    getText(range?: vscode.Range): string {
      if (!range) {
        return text;
      }

      const startOffset = this.offsetAt(range.start);
      const endOffset = this.offsetAt(range.end);
      return text.slice(startOffset, endOffset);
    },
    positionAt(offset: number): vscode.Position {
      return offsetToPosition(lineStarts, offset, text.length);
    },
    offsetAt(position: vscode.Position): number {
      const line = Math.max(0, Math.min(position.line, lineStarts.length - 1));
      const lineStart = lineStarts[line] ?? 0;
      return Math.max(0, Math.min(text.length, lineStart + Math.max(0, position.character)));
    },
    lineAt(lineOrPos: number | vscode.Position): vscode.TextLine {
      const rawLine = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line;
      const line = Math.max(0, Math.min(rawLine, lineCount - 1));
      const lineStart = lineStarts[line] ?? 0;
      const nextLineStart = line + 1 < lineCount ? lineStarts[line + 1] : text.length;
      const lineEndWithBreak = nextLineStart;

      let lineEnd = lineEndWithBreak;
      if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 10) {
        lineEnd--;
      }
      if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
        lineEnd--;
      }

      const lineText = text.slice(lineStart, lineEnd);
      const firstNonWhitespaceCharacterIndex = /\S/.test(lineText) ? (lineText.search(/\S/) ?? 0) : lineText.length;
      const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lineText.length));
      const rangeIncludingLineBreak = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, Math.max(0, lineEndWithBreak - lineStart))
      );

      return {
        lineNumber: line,
        text: lineText,
        range,
        rangeIncludingLineBreak,
        firstNonWhitespaceCharacterIndex,
        isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex >= lineText.length
      } as vscode.TextLine;
    }
  } as vscode.TextDocument;

  return doc;
}

export function createIndexOnlyXmlDocument(uri: vscode.Uri): vscode.TextDocument {
  const doc = {
    uri,
    languageId: "xml",
    version: 0,
    getText(): string {
      return "";
    },
    positionAt(_offset: number): vscode.Position {
      return new vscode.Position(0, 0);
    },
    offsetAt(_position: vscode.Position): number {
      return 0;
    }
  } as vscode.TextDocument;

  return doc;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(lineStarts: readonly number[], offset: number, textLength: number): vscode.Position {
  const safe = Math.max(0, Math.min(offset, textLength));
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const lineStart = lineStarts[mid];
    const nextLineStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : textLength + 1;
    if (safe < lineStart) {
      high = mid - 1;
      continue;
    }
    if (safe >= nextLineStart) {
      low = mid + 1;
      continue;
    }
    return new vscode.Position(mid, safe - lineStart);
  }

  const line = Math.max(0, Math.min(lineStarts.length - 1, low));
  return new vscode.Position(line, safe - (lineStarts[line] ?? 0));
}

