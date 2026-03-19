import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import { SfpXmlLinterSettings } from "../../config/settings";
import { SystemMetadata } from "../../config/systemMetadata";

export type ValidationDomain = "template" | "runtime" | "other";
export type ValidationMode = "source" | "composed-reference";

export interface ValidationRequest {
  document: vscode.TextDocument;
  index: WorkspaceIndex;
  facts: ReturnType<typeof parseDocumentFactsFromText>;
  domain: ValidationDomain;
  settingsSnapshot?: SfpXmlLinterSettings;
  metadataSnapshot?: SystemMetadata;
  standaloneMode?: boolean;
  skipConfiguredRootsCheck?: boolean;
}

export interface ValidationModule {
  readonly id: string;
  readonly mode: ValidationMode;
  readonly needsFacts?: readonly string[];
  readonly needsSymbols?: readonly string[];
  readonly enabled?: boolean;
  run(request: ValidationRequest): vscode.Diagnostic[];
}
