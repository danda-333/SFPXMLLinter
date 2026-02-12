import { applyFormatRules } from "./rules";
import { parseXmlTolerant } from "./parser";
import { renderFormattedXml } from "./renderer";
import { FormatterOptions } from "./types";

export interface FormatXmlResult {
  text: string;
  recoveries: number;
  invalidNodes: number;
}

export function formatXmlTolerant(source: string, options: FormatterOptions): FormatXmlResult {
  const ast = parseXmlTolerant(source);
  applyFormatRules(ast);
  const rendered = renderFormattedXml(ast, options);
  return {
    text: normalizeLeadingIndentation(rendered, options),
    recoveries: ast.recoveries,
    invalidNodes: ast.invalidNodes
  };
}

function normalizeLeadingIndentation(text: string, options: FormatterOptions): string {
  const normalizedLineEndings = text.replace(/\r\n/g, "\n");
  const lines = normalizedLineEndings.split("\n");
  const out = lines.map((line) => {
    const match = line.match(/^[ \t]+/);
    if (!match) {
      return line;
    }

    const leading = match[0];
    const width = computeVisualWidth(leading, options.tabSize);
    const canonical = options.insertSpaces
      ? " ".repeat(width)
      : "\t".repeat(Math.floor(width / options.tabSize)) + " ".repeat(width % options.tabSize);
    return canonical + line.slice(leading.length);
  });
  return out.join(options.lineEnding);
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
