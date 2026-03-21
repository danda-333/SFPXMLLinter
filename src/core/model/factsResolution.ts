import * as vscode from "vscode";

export type FactsForDocumentAccessor<TFacts> = (document: vscode.TextDocument) => TFacts | undefined;
export type FactsForUriAccessor<TIndex, TFacts> = (uri: vscode.Uri, index: TIndex) => TFacts | undefined;
export type ParseFactsAccessor<TFacts> = (document: vscode.TextDocument) => TFacts;

export type FactsResolutionMode = "strict-accessor" | "fallback-parse";

export function resolveDocumentFacts<TIndex, TFacts>(
  document: vscode.TextDocument,
  index: TIndex,
  options: {
    getFactsForDocument?: FactsForDocumentAccessor<TFacts>;
    getFactsForUri?: FactsForUriAccessor<TIndex, TFacts>;
    parseFacts?: ParseFactsAccessor<TFacts>;
    mode?: FactsResolutionMode;
  }
): TFacts | undefined {
  const mode = options.mode ?? "strict-accessor";
  const parseFacts = options.parseFacts;

  if (options.getFactsForDocument) {
    const fromDocument = options.getFactsForDocument(document);
    if (fromDocument) {
      return fromDocument;
    }
    if (mode === "fallback-parse") {
      return parseFacts?.(document);
    }
    return undefined;
  }

  if (options.getFactsForUri) {
    const fromUri = options.getFactsForUri(document.uri, index);
    if (fromUri) {
      return fromUri;
    }
    if (mode === "fallback-parse") {
      return parseFacts?.(document);
    }
    return undefined;
  }

  return parseFacts?.(document);
}

