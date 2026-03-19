import * as vscode from "vscode";
import { formatXmlSelectionWithContext } from "../../formatter/selection";
import { FormatterOptions } from "../../formatter/types";
import { SfpXmlLinterSettings } from "../../config/settings";

export function createFormatterOptions(
  editorOptions: vscode.TextEditorOptions,
  document: vscode.TextDocument,
  settings: SfpXmlLinterSettings
): FormatterOptions {
  const tabSize = typeof editorOptions.tabSize === "number" ? editorOptions.tabSize : 2;
  const insertSpaces = editorOptions.insertSpaces !== false;
  const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";
  const lineEnding: "\n" | "\r\n" = document.getText().includes("\r\n") ? "\r\n" : "\n";
  return {
    indentUnit,
    lineEnding,
    tabSize,
    insertSpaces,
    maxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
    forceInlineAttributes: true,
    typeAttributeFirst: true
  };
}

export function formatRangeLikeDocument(
  document: vscode.TextDocument,
  range: vscode.Range,
  options: FormatterOptions
): { text: string; recoveries: number; invalidNodes: number; range: vscode.Range } {
  const source = document.getText();
  const result = formatXmlSelectionWithContext(source, document.offsetAt(range.start), document.offsetAt(range.end), options);
  const text = result.text;
  return {
    text,
    recoveries: result.recoveries,
    invalidNodes: result.invalidNodes,
    range: new vscode.Range(document.positionAt(result.rangeStart), document.positionAt(result.rangeEnd))
  };
}

export function createFormatterOptionsFromFormattingOptions(
  options: vscode.FormattingOptions,
  document: vscode.TextDocument,
  settings: SfpXmlLinterSettings
): FormatterOptions {
  const tabSize = Number.isFinite(options.tabSize) ? Math.max(1, Math.floor(options.tabSize)) : 2;
  const indentUnit = options.insertSpaces ? " ".repeat(tabSize) : "\t";
  const lineEnding: "\n" | "\r\n" = document.getText().includes("\r\n") ? "\r\n" : "\n";
  return {
    indentUnit,
    lineEnding,
    tabSize,
    insertSpaces: !!options.insertSpaces,
    maxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
    forceInlineAttributes: true,
    typeAttributeFirst: true
  };
}

