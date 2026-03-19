import * as vscode from "vscode";

export function isInsideSqlOrCommandBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
  return getEnclosingSqlOrCommandRegion(document, position) !== undefined;
}

export function shouldAutoTriggerSqlSuggest(document: vscode.TextDocument, position: vscode.Position): boolean {
  const region = getEnclosingSqlOrCommandRegion(document, position);
  if (!region) {
    return false;
  }

  const text = document.getText();
  const offset = document.offsetAt(position);
  const beforeCursor = text.slice(region.openEnd, offset);
  const lastAt = beforeCursor.lastIndexOf("@");
  if (lastAt < 0) {
    return false;
  }

  const tail = beforeCursor.slice(lastAt + 1);
  if (!tail.length) {
    return true;
  }

  if (/\s/.test(tail)) {
    return false;
  }

  return /^[A-Za-z_][\w]*(?:==[^\s<>"']*)?$/.test(tail);
}

export function getEnclosingSqlOrCommandRegion(
  document: vscode.TextDocument,
  position: vscode.Position
): { openEnd: number; closeStart: number } | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const openRegex = /<\s*(?:[A-Za-z_][\w.-]*:)?(SQL|Command)\b[^>]*>/gi;

  let lastOpen: RegExpExecArray | undefined;
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(text)) !== null) {
    if (match.index >= offset) {
      break;
    }

    lastOpen = match;
  }

  if (!lastOpen) {
    return undefined;
  }

  const openStart = lastOpen.index;
  const openEnd = openStart + lastOpen[0].length;
  if (offset < openEnd) {
    return undefined;
  }

  const tagMatch = /<\s*(?:[A-Za-z_][\w.-]*:)?(SQL|Command)\b/i.exec(lastOpen[0]);
  const tag = (tagMatch?.[1] ?? "").toLowerCase();
  if (!tag) {
    return undefined;
  }

  const closeRegex = new RegExp(`<\\s*\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, "i");
  const afterOpen = text.slice(openEnd);
  const close = closeRegex.exec(afterOpen);
  if (!close) {
    return undefined;
  }

  const closeStart = openEnd + close.index;
  if (offset > closeStart) {
    return undefined;
  }

  return { openEnd, closeStart };
}

