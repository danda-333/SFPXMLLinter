import { formatXmlTolerant } from "./index";
import { parseXmlTolerant } from "./parser";
import { tokenizeXml } from "./tokenizer";
import { FormatterOptions, ElementNode, XmlNode } from "./types";

export interface SelectionFormatResult {
  text: string;
  rangeStart: number;
  rangeEnd: number;
  recoveries: number;
  invalidNodes: number;
}

export function formatXmlSelectionWithContext(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  options: FormatterOptions
): SelectionFormatResult {
  const normalized = normalizeSelectionToWholeLines(source, selectionStart, selectionEnd);
  const selectionText = source.slice(normalized.start, normalized.end);
  const boundaryOffset = firstNonWhitespaceOffset(source, normalized.start, normalized.end);
  const startsAtElementBoundary =
    boundaryOffset !== undefined ? selectionStartsAtElementBoundary(source, boundaryOffset, normalized.end) : false;
  const normalizedSelectionText = startsAtElementBoundary ? selectionText : stripCommonIndent(selectionText, options.tabSize);
  const contextParents = resolveSelectionParentChain(source, normalized.start, normalized.end);
  if (!contextParents) {
    const formatted = formatXmlTolerant(normalizedSelectionText, options);
    return {
      text: formatted.text,
      rangeStart: normalized.start,
      rangeEnd: normalized.end,
      recoveries: formatted.recoveries,
      invalidNodes: formatted.invalidNodes
    };
  }

  const startMarker = "<!--__SFP_SEL_START__-->";
  const endMarker = "<!--__SFP_SEL_END__-->";
  const openTags = contextParents.map((el) => el.openToken.raw.trim());
  const syntheticClosings = buildSyntheticClosings(normalizedSelectionText);
  const closeTags = [...contextParents]
    .reverse()
    .map((el) => (el.closeToken?.raw?.trim() ? el.closeToken.raw.trim() : `</${el.name}>`));
  const virtual = [...openTags, `${startMarker}${normalizedSelectionText}${endMarker}`, ...syntheticClosings, ...closeTags].join(options.lineEnding);
  const formatted = formatXmlTolerant(virtual, options);
  const extracted = extractSelectionBetweenMarkers(formatted.text, startMarker, endMarker);
  const normalizedExtracted =
    extracted !== undefined ? normalizeExtractedSelectionToOriginalBounds(extracted, normalizedSelectionText, options.lineEnding) : undefined;

  return {
    text: normalizedExtracted ?? selectionText,
    rangeStart: normalized.start,
    rangeEnd: normalized.end,
    recoveries: formatted.recoveries,
    invalidNodes: formatted.invalidNodes
  };
}

function normalizeSelectionToWholeLines(source: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const lineStart = findLineStart(source, selectionStart);
  let lineEnd = findLineEnd(source, selectionEnd);

  if (selectionEnd > lineStart && selectionEnd <= source.length && source[selectionEnd - 1] === "\n") {
    lineEnd = normalizeLineEndOffset(source, selectionEnd - 1);
  }

  if (lineEnd < lineStart) {
    lineEnd = lineStart;
  }

  return { start: lineStart, end: lineEnd };
}

function findLineStart(source: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, source.length));
  const lastNl = source.lastIndexOf("\n", safe - 1);
  return lastNl >= 0 ? lastNl + 1 : 0;
}

function findLineEnd(source: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, source.length));
  const nextNl = source.indexOf("\n", safe);
  if (nextNl < 0) {
    return source.length;
  }
  return normalizeLineEndOffset(source, nextNl);
}

function normalizeLineEndOffset(source: string, offset: number): number {
  if (offset > 0 && source[offset] === "\n" && source[offset - 1] === "\r") {
    return offset - 1;
  }
  return offset;
}

function resolveSelectionParentChain(source: string, startOffset: number, endOffset: number): ElementNode[] | undefined {
  const ast = parseXmlTolerant(source);
  return findParentChainForFirstSelectedNode(ast.nodes, startOffset, endOffset, []);
}

function selectionStartsAtElementBoundary(source: string, startOffset: number, endOffset: number): boolean {
  const ast = parseXmlTolerant(source);
  return hasElementBoundaryAtOffset(ast.nodes, startOffset, endOffset);
}

function firstNonWhitespaceOffset(source: string, startOffset: number, endOffset: number): number | undefined {
  for (let i = startOffset; i < endOffset; i++) {
    const ch = source[i];
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") {
      return i;
    }
  }
  return undefined;
}

function hasElementBoundaryAtOffset(nodes: readonly XmlNode[], startOffset: number, endOffset: number): boolean {
  for (const node of nodes) {
    if (node.end <= startOffset) {
      continue;
    }
    if (node.start >= endOffset) {
      break;
    }

    if (node.kind === "element") {
      if (node.start === startOffset) {
        return true;
      }
      if (hasElementBoundaryAtOffset(node.children, startOffset, endOffset)) {
        return true;
      }
      continue;
    }
  }
  return false;
}

function findParentChainForFirstSelectedNode(
  nodes: readonly XmlNode[],
  startOffset: number,
  endOffset: number,
  parents: ElementNode[]
): ElementNode[] | undefined {
  for (const node of nodes) {
    if (node.end <= startOffset) {
      continue;
    }
    if (node.start >= endOffset) {
      break;
    }

    if (node.kind === "text" && node.raw.trim().length === 0) {
      continue;
    }

    if (node.kind !== "element") {
      return parents;
    }

    // When selection starts at the element boundary, this element is the selected root node.
    // Parent chain must not include it, otherwise selection gets indented twice.
    if (startOffset <= node.start) {
      return parents;
    }

    const childParents = [...parents, node];
    const nested = findParentChainForFirstSelectedNode(node.children, startOffset, endOffset, childParents);
    if (nested) {
      return nested;
    }

    return parents;
  }

  return undefined;
}

function extractSelectionBetweenMarkers(formatted: string, startMarker: string, endMarker: string): string | undefined {
  const start = formatted.indexOf(startMarker);
  if (start < 0) {
    return undefined;
  }
  const from = start + startMarker.length;
  const end = formatted.indexOf(endMarker, from);
  if (end < 0) {
    return undefined;
  }
  return formatted.slice(from, end);
}

function normalizeExtractedSelectionToOriginalBounds(extracted: string, original: string, lineEnding: "\n" | "\r\n"): string {
  let value = extracted;
  if (!original.startsWith("\n") && !original.startsWith("\r\n") && !original.startsWith("\r")) {
    while (value.startsWith(lineEnding) || value.startsWith("\n") || value.startsWith("\r\n") || value.startsWith("\r")) {
      if (value.startsWith(lineEnding)) {
        value = value.slice(lineEnding.length);
        continue;
      }
      if (value.startsWith("\r\n")) {
        value = value.slice(2);
        continue;
      }
      if (value.startsWith("\r")) {
        value = value.slice(1);
        continue;
      }
      value = value.slice(1);
    }
  }

  if (!original.endsWith("\n") && !original.endsWith("\r\n") && !original.endsWith("\r")) {
    while (value.endsWith(lineEnding) || value.endsWith("\n") || value.endsWith("\r\n") || value.endsWith("\r")) {
      if (value.endsWith(lineEnding)) {
        value = value.slice(0, -lineEnding.length);
        continue;
      }
      if (value.endsWith("\r\n")) {
        value = value.slice(0, -2);
        continue;
      }
      if (value.endsWith("\r")) {
        value = value.slice(0, -1);
        continue;
      }
      value = value.slice(0, -1);
    }
  }

  return value;
}

function stripCommonIndent(value: string, tabSize: number): string {
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return value;
  }

  const minIndent = Math.min(...nonEmpty.map((line) => computeVisualWidth(getLeadingWhitespace(line), tabSize)));
  if (minIndent <= 0) {
    return lines.join("\n");
  }

  return lines.map((line) => stripLeadingVisualWidth(line, minIndent, tabSize)).join("\n");
}

function getLeadingWhitespace(value: string): string {
  const match = value.match(/^[\t ]*/);
  return match?.[0] ?? "";
}

function stripLeadingVisualWidth(line: string, width: number, tabSize: number): string {
  let consumed = 0;
  let index = 0;
  while (index < line.length) {
    const ch = line[index];
    if (ch !== " " && ch !== "\t") {
      break;
    }
    const step = ch === "\t" ? tabSize - (consumed % tabSize || 0) : 1;
    if (consumed + step > width) {
      break;
    }
    consumed += step;
    index++;
    if (consumed === width) {
      break;
    }
  }
  return line.slice(index);
}

function computeVisualWidth(value: string, tabSize: number): number {
  let col = 0;
  for (const ch of value) {
    if (ch === "\t") {
      const jump = tabSize - (col % tabSize || 0);
      col += jump;
      continue;
    }
    col += 1;
  }
  return col;
}

function buildSyntheticClosings(selectionText: string): string[] {
  const tokens = tokenizeXml(selectionText);
  const stack: string[] = [];

  for (const token of tokens) {
    if (token.kind === "openingTag") {
      if (token.name) {
        stack.push(token.name);
      }
      continue;
    }

    if (token.kind === "selfClosingTag") {
      continue;
    }

    if (token.kind === "closingTag") {
      const name = token.name ?? "";
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) {
        stack.splice(idx, 1);
      }
    }
  }

  return stack.reverse().map((name) => `</${name}>`);
}
