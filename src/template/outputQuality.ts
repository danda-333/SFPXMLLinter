import { formatXmlTolerant } from "../formatter";
import { FormatterOptions } from "../formatter/types";
import { normalizeLineEndingsForTemplate } from "./lineEndings";

export type TemplateBuilderProvenanceMode = "off" | "fileComment";

export interface TemplateOutputQualityOptions {
  postBuildFormat: boolean;
  provenanceMode: TemplateBuilderProvenanceMode;
  provenanceLabel?: string;
  relativeTemplatePath: string;
  formatterMaxConsecutiveBlankLines: number;
}

export function applyTemplateOutputQuality(
  renderedXml: string,
  sourceTemplateText: string,
  options: TemplateOutputQualityOptions
): string {
  let out = renderedXml;

  if (options.provenanceMode === "fileComment") {
    out = applyFileProvenanceComment(out, options.provenanceLabel, options.relativeTemplatePath);
  }

  if (options.postBuildFormat) {
    const formatterOptions = createTemplateFormatterOptions(sourceTemplateText, options.formatterMaxConsecutiveBlankLines);
    out = formatXmlTolerant(out, formatterOptions).text;
  }

  return normalizeLineEndingsForTemplate(out, sourceTemplateText);
}

function applyFileProvenanceComment(xml: string, provenanceLabel: string | undefined, relativeTemplatePath: string): string {
  const label = (provenanceLabel ?? "unknown").trim() || "unknown";
  const comment = `<!-- Template builder: ${label} - ${relativeTemplatePath} -->`;
  const trimmed = xml.replace(/^\uFEFF/, "");
  const declMatch = /^\s*<\?xml[^>]*\?>/i.exec(trimmed);
  if (!declMatch) {
    return `${comment}\n${trimmed}`;
  }

  const decl = declMatch[0];
  const rest = trimmed.slice(decl.length).replace(/^\r?\n/, "");
  return `${decl}\n${comment}\n${rest}`;
}

function createTemplateFormatterOptions(source: string, maxConsecutiveBlankLines: number): FormatterOptions {
  const lineEnding: "\n" | "\r\n" = source.includes("\r\n") ? "\r\n" : "\n";
  const indentInfo = detectIndentStyle(source);
  const tabSize = indentInfo.tabSize;
  const insertSpaces = indentInfo.insertSpaces;
  return {
    indentUnit: insertSpaces ? " ".repeat(tabSize) : "\t",
    lineEnding,
    tabSize,
    insertSpaces,
    maxConsecutiveBlankLines,
    forceInlineAttributes: true,
    typeAttributeFirst: true
  };
}

function detectIndentStyle(source: string): { insertSpaces: boolean; tabSize: number } {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = /^([ \t]+)\S/.exec(line);
    if (!match) {
      continue;
    }
    const indent = match[1];
    if (indent.includes("\t")) {
      return { insertSpaces: false, tabSize: 4 };
    }
    return { insertSpaces: true, tabSize: Math.max(2, indent.length) };
  }
  return { insertSpaces: true, tabSize: 2 };
}
