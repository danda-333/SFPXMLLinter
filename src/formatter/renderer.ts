import { ElementNode, FormatterOptions, XmlDocumentAst, XmlNode, XmlToken } from "./types";

const SPECIAL_PRESERVE_INNER = new Set(["sql", "sqlcommand", "htmltemplate", "xmldescription"]);
const BLANK_LINES_MARKER_PREFIX = "__SFP_BLANK_LINES__:";

interface ParsedAttribute {
  name: string;
  valueRaw?: string;
}

export function renderFormattedXml(ast: XmlDocumentAst, options: FormatterOptions): string {
  const chunks = renderNodeSequence(ast, ast.nodes, options, 0);
  return joinDocumentChunks(chunks, options.lineEnding, options.maxConsecutiveBlankLines);
}

function renderNode(ast: XmlDocumentAst, node: XmlNode, options: FormatterOptions, level: number): string {
  if (node.rules.has("disable")) {
    return ast.source.slice(node.start, node.end);
  }

  switch (node.kind) {
    case "xmlDecl":
      return node.raw.trim();
    case "text":
      return renderText(node.raw, options, level);
    case "comment":
      return renderCommentBlock(ast, node, options, level);
    case "cdata":
      return renderLiteralBlock(node.raw, options, level);
    case "orphanClosing":
      return `${repeatIndent(options.indentUnit, level)}${node.raw.trim()}`;
    case "element":
      return renderElement(ast, node, options, level);
    default:
      return "";
  }
}

function renderElement(ast: XmlDocumentAst, node: ElementNode, options: FormatterOptions, level: number): string {
  if (isCommandElement(node) && !node.rules.has("format-inner")) {
    return ast.source.slice(node.start, node.end);
  }

  if (node.invalid) {
    return renderInvalidElementFallback(ast, node, options, level);
  }

  const preserveInner = shouldPreserveInner(node);
  if (preserveInner && !node.selfClosing && node.closeToken) {
    return renderPreserveInnerElement(ast, node, options, level);
  }

  const indent = repeatIndent(options.indentUnit, level);
  const openTag = renderOpeningTag(node.openToken, options, node.selfClosing, node.rules);
  if (node.selfClosing) {
    return `${indent}${openTag}`;
  }

  const closeTag = renderClosingTag(node);
  const nonWhitespaceChildren = node.children.filter((child) => !(child.kind === "text" && child.raw.trim().length === 0));
  if (nonWhitespaceChildren.length === 0) {
    const innerRaw = node.closeToken ? ast.source.slice(node.openToken.end, node.closeToken.start) : "";
    const isMultilineInSource = /[\r\n]/.test(innerRaw);
    if (!isMultilineInSource) {
      return `${indent}${openTag}${closeTag}`;
    }
    return `${indent}${openTag}${options.lineEnding}${indent}${closeTag}`;
  }

  if (isStringElement(node) && nonWhitespaceChildren.length === 1 && nonWhitespaceChildren[0].kind === "text") {
    const inlineText = node.rules.has("no-inline-text-normalize")
      ? nonWhitespaceChildren[0].raw.trim()
      : normalizeInlineText(nonWhitespaceChildren[0].raw);
    return `${indent}${openTag}${inlineText}${closeTag}`;
  }

  if (
    !isStringElement(node) &&
    !node.rules.has("no-inline-text-normalize") &&
    nonWhitespaceChildren.length === 1 &&
    nonWhitespaceChildren[0].kind === "text"
  ) {
    const innerRaw = node.closeToken ? ast.source.slice(node.openToken.end, node.closeToken.start) : "";
    const isMultilineInSource = /[\r\n]/.test(innerRaw);
    if (!isMultilineInSource) {
      const inlineText = node.rules.has("no-inline-text-normalize")
        ? nonWhitespaceChildren[0].raw.trim()
        : normalizeInlineText(nonWhitespaceChildren[0].raw);
      return `${indent}${openTag}${inlineText}${closeTag}`;
    }
  }

  const renderedChildren: string[] = [];
  renderedChildren.push(...renderNodeSequence(ast, node.children, options, level + 1));

  if (renderedChildren.length === 0) {
    return `${indent}${openTag}${closeTag}`;
  }

  return `${indent}${openTag}${options.lineEnding}${joinChunks(
    renderedChildren,
    options.lineEnding,
    options.maxConsecutiveBlankLines
  )}${options.lineEnding}${indent}${closeTag}`;
}

function renderInvalidElementFallback(ast: XmlDocumentAst, node: ElementNode, options: FormatterOptions, level: number): string {
  if (isStringElement(node)) {
    return renderInvalidElementInline(ast, node, options, level);
  }

  const indent = repeatIndent(options.indentUnit, level);
  const open = renderOpeningTag(node.openToken, options, node.selfClosing, node.rules);
  if (node.selfClosing) {
    return `${indent}${open}`;
  }

  const renderedChildren: string[] = [];
  const childLevel = node.closeToken ? level + 1 : level;
  renderedChildren.push(...renderNodeSequence(ast, node.children, options, childLevel));

  if (!node.closeToken) {
    if (renderedChildren.length === 0) {
      return `${indent}${open}`;
    }
    return `${indent}${open}${options.lineEnding}${joinChunks(
      renderedChildren,
      options.lineEnding,
      options.maxConsecutiveBlankLines
    )}`;
  }

  const close = renderClosingTag(node);
  if (renderedChildren.length === 0) {
    return `${indent}${open}${close}`;
  }
  return `${indent}${open}${options.lineEnding}${joinChunks(
    renderedChildren,
    options.lineEnding,
    options.maxConsecutiveBlankLines
  )}${options.lineEnding}${indent}${close}`;
}

function renderInvalidElementInline(ast: XmlDocumentAst, node: ElementNode, options: FormatterOptions, level: number): string {
  const indent = repeatIndent(options.indentUnit, level);
  const open = renderOpeningTag(node.openToken, options, node.selfClosing, node.rules);
  if (node.selfClosing) {
    return `${indent}${open}`;
  }

  const inlineChildren = node.children
    .map((child) => renderInlineNode(ast, child, options))
    .filter((part) => part.length > 0)
    .join("");
  if (!node.closeToken) {
    return `${indent}${open}${inlineChildren}`;
  }
  const close = renderClosingTag(node);
  return `${indent}${open}${inlineChildren}${close}`;
}

function renderInlineNode(ast: XmlDocumentAst, node: XmlNode, options: FormatterOptions): string {
  if (node.rules.has("disable")) {
    return ast.source.slice(node.start, node.end);
  }

  switch (node.kind) {
    case "text":
      return normalizeInlineText(node.raw);
    case "comment":
    case "cdata":
      return node.raw.trim();
    case "orphanClosing":
      return node.raw.trim();
    case "xmlDecl":
      return node.raw.trim();
    case "element":
      if (node.invalid) {
        if (isStringElement(node)) {
          return renderInvalidElementInline(ast, node, options, 0).trim();
        }
        return renderInvalidElementFallback(ast, node, options, 0).trim();
      }
      if (shouldPreserveInner(node) && !node.selfClosing && node.closeToken) {
        return `${renderOpeningTag(node.openToken, options, false, node.rules)}${ast.source.slice(node.openToken.end, node.closeToken.start)}${renderClosingTag(node)}`;
      }
      if (node.selfClosing) {
        return renderOpeningTag(node.openToken, options, true, node.rules);
      }
      return `${renderOpeningTag(node.openToken, options, false, node.rules)}${node.children
        .map((child) => renderInlineNode(ast, child, options))
        .join("")}${renderClosingTag(node)}`;
    default:
      return "";
  }
}

function isStringElement(node: ElementNode): boolean {
  const local = node.name.includes(":") ? node.name.split(":").pop() ?? node.name : node.name;
  return local.toLowerCase() === "string";
}

function isCommandElement(node: ElementNode): boolean {
  const local = node.name.includes(":") ? node.name.split(":").pop() ?? node.name : node.name;
  return local.toLowerCase() === "command";
}

function isSpecialPreserveElement(node: ElementNode): boolean {
  const local = node.name.includes(":") ? node.name.split(":").pop() ?? node.name : node.name;
  const key = local.toLowerCase();
  return key === "sql" || key === "sqlcommand" || key === "htmltemplate" || key === "xmldescription";
}

function renderPreserveInnerElement(ast: XmlDocumentAst, node: ElementNode, options: FormatterOptions, level: number): string {
  const indent = repeatIndent(options.indentUnit, level);
  const childIndent = repeatIndent(options.indentUnit, level + 1);
  const open = renderOpeningTag(node.openToken, options, false, node.rules);
  const close = renderClosingTag(node);
  if (!node.closeToken) {
    return `${indent}${open}`;
  }

  const innerRaw = ast.source.slice(node.openToken.end, node.closeToken.start);
  if (innerRaw.trim().length === 0) {
    return `${indent}${open}${close}`;
  }

  if (isSpecialPreserveElement(node)) {
    return renderSpecialPreserveElement(innerRaw, indent, childIndent, open, close, options.lineEnding, options.tabSize);
  }

  const reindentedInner = reindentBlockPreserveStructure(innerRaw, options.lineEnding, childIndent);
  return `${indent}${open}${options.lineEnding}${reindentedInner}${options.lineEnding}${indent}${close}`;
}

function shouldPreserveInner(node: ElementNode): boolean {
  if (node.rules.has("format-inner")) {
    return false;
  }
  if (node.rules.has("preserve-inner")) {
    return true;
  }

  const local = node.name.includes(":") ? node.name.split(":").pop() ?? node.name : node.name;
  return SPECIAL_PRESERVE_INNER.has(local.toLowerCase());
}

function renderSpecialPreserveElement(
  innerRaw: string,
  indent: string,
  childIndent: string,
  openTag: string,
  closeTag: string,
  lineEnding: string,
  tabSize: number
): string {
  if (!innerRaw.includes("\n") && !innerRaw.includes("\r")) {
    return `${indent}${openTag}${innerRaw}${closeTag}`;
  }

  const lines = splitLines(innerRaw);
  const hasInlineStart = lines[0].trim().length > 0;
  const hasInlineEnd = lines[lines.length - 1].trim().length > 0;
  const coreLines = [...lines];

  // Remove only structural wrapper line breaks produced by multiline XML rendering.
  // This keeps user-authored blank lines stable across repeated formatting.
  if (!hasInlineStart && coreLines.length > 0 && coreLines[0].trim().length === 0) {
    coreLines.shift();
  }
  if (!hasInlineEnd && coreLines.length > 0 && coreLines[coreLines.length - 1].trim().length === 0) {
    coreLines.pop();
  }

  const out: string[] = [];

  if (hasInlineStart) {
    out.push(`${indent}${openTag}${coreLines[0]?.trimStart() ?? ""}`);
  } else {
    out.push(`${indent}${openTag}`);
  }

  const startIndex = hasInlineStart ? 1 : 0;
  const endIndex = hasInlineEnd ? coreLines.length - 2 : coreLines.length - 1;
  const middle = coreLines.slice(startIndex, endIndex + 1);
  const middleNonEmpty = middle.filter((line) => line.trim().length > 0);
  const middleMinLead =
    middleNonEmpty.length > 0 ? Math.min(...middleNonEmpty.map((line) => computeVisualWidth(getLeadingWhitespace(line), tabSize))) : 0;
  for (let i = startIndex; i <= endIndex; i++) {
    const line = coreLines[i];
    if (line === undefined) {
      continue;
    }
    if (line.trim().length === 0) {
      out.push("");
      continue;
    }
    const normalized = shiftLineByVisualDelta(line, -middleMinLead, tabSize);
    out.push(`${childIndent}${normalized}`);
  }

  if (hasInlineEnd) {
    out.push(`${indent}${coreLines[coreLines.length - 1]?.trimStart() ?? ""}${closeTag}`);
  } else {
    out.push(`${indent}${closeTag}`);
  }

  return out.join(lineEnding);
}

function renderOpeningTag(token: XmlToken, options: FormatterOptions, selfClosing: boolean, rules?: ReadonlySet<string>): string {
  if (rules?.has("no-attr-normalize")) {
    return token.raw.trim();
  }

  const name = token.name ?? "";
  const attrs = parseAttributes(token.attributesRaw ?? "");
  if (options.typeAttributeFirst && !rules?.has("no-type-first")) {
    attrs.sort((a, b) => getAttributeRank(a.name) - getAttributeRank(b.name));
  }

  const attrsText = attrs.map((attr) => ` ${renderAttribute(attr)}`).join("");
  if (selfClosing) {
    return `<${name}${attrsText} />`;
  }

  return `<${name}${attrsText}>`;
}

function renderClosingTag(node: ElementNode): string {
  const name = node.closeToken?.name ?? node.name;
  return `</${name}>`;
}

function renderAttribute(attr: ParsedAttribute): string {
  if (!attr.valueRaw) {
    return attr.name;
  }
  return `${attr.name}=${attr.valueRaw}`;
}

function getAttributeRank(name: string): number {
  if (name.toLowerCase() === "xsi:type") {
    return 0;
  }
  return 1;
}

function parseAttributes(raw: string): ParsedAttribute[] {
  const attrs: ParsedAttribute[] = [];
  const regex = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const name = match[1];
    if (!name) {
      continue;
    }
    attrs.push({
      name,
      valueRaw: match[2]
    });
  }
  return attrs;
}

function renderText(raw: string, options: FormatterOptions, level: number): string {
  if (raw.trim().length === 0) {
    const lineBreaks = (raw.match(/\r\n|\n|\r/g) ?? []).length;
    const blankLines = Math.max(0, lineBreaks - 1);
    return blankLines > 0 ? `${BLANK_LINES_MARKER_PREFIX}${blankLines}` : "";
  }

  const lines = splitLines(raw);
  const indent = repeatIndent(options.indentUnit, level);
  const renderedLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${indent}${line}`);
  return renderedLines.join(options.lineEnding);
}

function renderLiteralBlock(raw: string, options: FormatterOptions, level: number): string {
  const lines = splitLines(raw);
  const indent = repeatIndent(options.indentUnit, level);
  return lines.map((line) => `${indent}${line.trim()}`).join(options.lineEnding);
}

function renderCommentBlock(ast: XmlDocumentAst, node: XmlNode, options: FormatterOptions, level: number): string {
  const raw = node.kind === "comment" ? node.raw : "";
  const indent = repeatIndent(options.indentUnit, level);
  if (!raw.includes("\n") && !raw.includes("\r")) {
    return `${indent}${raw.trim()}`;
  }

  // Multiline comment: shift whole block while preserving relative inner indentation.
  const lines = splitLines(raw);
  if (lines.length === 0) {
    return `${indent}<!-- -->`;
  }

  const currentFirstLead = computeStartColumn(ast.source, node.start, options.tabSize);
  const targetLead = computeVisualWidth(indent, options.tabSize);
  const delta = targetLead - currentFirstLead;
  const first = `${indent}${lines[0].trimStart()}`;
  if (lines.length === 1) {
    return first;
  }

  const rest = lines.slice(1);
  const adjustedRest = shiftCommentRestLines(rest, delta, options.tabSize);
  return [first, ...adjustedRest].join(options.lineEnding);
}

function normalizeInlineText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function reindentBlockPreserveStructure(raw: string, lineEnding: string, targetIndent: string): string {
  const lines = trimOuterBlankLines(splitLines(raw));
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return "";
  }

  const minLead = Math.min(...nonEmpty.map((line) => countLeadingWhitespace(line)));
  const reindented = lines.map((line) => {
    if (line.trim().length === 0) {
      return "";
    }
    return `${targetIndent}${stripLeadingWhitespace(line, minLead)}`;
  });

  return reindented.join(lineEnding);
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) {
    start++;
  }
  while (end > start && lines[end - 1].trim().length === 0) {
    end--;
  }
  return lines.slice(start, end);
}

function countLeadingWhitespace(value: string): number {
  const match = value.match(/^[ \t]*/);
  return match?.[0].length ?? 0;
}

function stripLeadingWhitespace(value: string, count: number): string {
  let remaining = count;
  let index = 0;
  while (remaining > 0 && index < value.length && (value[index] === " " || value[index] === "\t")) {
    index++;
    remaining--;
  }
  return value.slice(index);
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function computeStartColumn(source: string, offset: number, tabSize: number): number {
  const lastNl = source.lastIndexOf("\n", Math.max(0, offset - 1));
  const lineStart = lastNl >= 0 ? lastNl + 1 : 0;
  let col = 0;
  for (let i = lineStart; i < offset; i++) {
    const ch = source[i];
    if (ch === "\t") {
      const jump = tabSize - (col % tabSize || 0);
      col += jump;
      continue;
    }
    col += 1;
  }
  return col;
}

function shiftCommentRestLines(lines: string[], delta: number, tabSize: number): string[] {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return lines;
  }

  if (delta === 0) {
    return lines;
  }

  if (delta > 0) {
    return lines.map((line) => shiftLineByVisualDelta(line, delta, tabSize));
  }

  const minLead = Math.min(...nonEmpty.map((line) => computeVisualWidth(getLeadingWhitespace(line), tabSize)));
  const removable = Math.min(-delta, minLead);
  if (removable <= 0) {
    return lines;
  }

  return lines.map((line) => shiftLineByVisualDelta(line, -removable, tabSize));
}

function shiftLineByVisualDelta(line: string, delta: number, tabSize: number): string {
  if (line.length === 0 || delta === 0) {
    return line;
  }

  const leading = getLeadingWhitespace(line);
  const body = line.slice(leading.length);
  const currentWidth = computeVisualWidth(leading, tabSize);
  const nextWidth = Math.max(0, currentWidth + delta);
  return " ".repeat(nextWidth) + body;
}

function getLeadingWhitespace(value: string): string {
  const match = value.match(/^[ \t]*/);
  return match?.[0] ?? "";
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

function repeatIndent(indentUnit: string, level: number): string {
  if (level <= 0) {
    return "";
  }
  return indentUnit.repeat(level);
}

function joinDocumentChunks(chunks: readonly string[], eol: string, maxConsecutiveBlankLines: number): string {
  if (chunks.length === 0) {
    return "";
  }

  const normalized: string[] = [];
  for (const chunk of expandBlankMarkers(chunks, maxConsecutiveBlankLines)) {

    const trimmed = chunk.trim();
    if (trimmed.length === 0) {
      continue;
    }
    normalized.push(trimmed);
  }

  return normalized.join(eol);
}

function joinChunks(chunks: readonly string[], eol: string, maxConsecutiveBlankLines: number): string {
  return expandBlankMarkers(chunks, maxConsecutiveBlankLines).join(eol);
}

function expandBlankMarkers(chunks: readonly string[], maxConsecutiveBlankLines: number): string[] {
  const expanded: string[] = [];
  let blankRun = 0;
  for (const chunk of chunks) {
    if (!chunk.startsWith(BLANK_LINES_MARKER_PREFIX)) {
      expanded.push(chunk);
      blankRun = 0;
      continue;
    }

    const value = Number.parseInt(chunk.slice(BLANK_LINES_MARKER_PREFIX.length), 10);
    const count = Number.isFinite(value) ? Math.max(0, value) : 0;
    for (let i = 0; i < count; i++) {
      blankRun++;
      if (blankRun > maxConsecutiveBlankLines) {
        continue;
      }
      expanded.push("");
    }
  }
  return expanded;
}

function renderNodeSequence(
  ast: XmlDocumentAst,
  nodes: readonly XmlNode[],
  options: FormatterOptions,
  level: number
): string[] {
  const out: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const previous = findPreviousSignificantNode(nodes, i - 1);
    const mergeIndex = findLastNonMarkerChunkIndex(out);
    if (node.kind === "comment" && previous && mergeIndex >= 0 && shouldKeepCommentInline(ast, previous, node)) {
      const between = ast.source.slice(previous.end, node.start);
      out[mergeIndex] = `${out[mergeIndex]}${between}${node.raw.trimStart()}`;
      continue;
    }

    const rendered = renderNode(ast, node, options, level);
    if (rendered.length === 0) {
      continue;
    }

    out.push(rendered);
  }

  return out;
}

function shouldKeepCommentInline(ast: XmlDocumentAst, previous: XmlNode, comment: XmlNode): boolean {
  if (comment.kind !== "comment") {
    return false;
  }
  if (previous.kind === "text") {
    return false;
  }

  const between = ast.source.slice(previous.end, comment.start);
  if (!/^[ \t]*$/.test(between)) {
    return false;
  }

  return !between.includes("\n") && !between.includes("\r");
}

function findPreviousSignificantNode(nodes: readonly XmlNode[], fromIndex: number): XmlNode | undefined {
  for (let i = fromIndex; i >= 0; i--) {
    const n = nodes[i];
    if (n.kind === "text" && n.raw.trim().length === 0) {
      continue;
    }
    return n;
  }
  return undefined;
}

function findLastNonMarkerChunkIndex(chunks: readonly string[]): number {
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (!chunks[i].startsWith(BLANK_LINES_MARKER_PREFIX)) {
      return i;
    }
  }
  return -1;
}
