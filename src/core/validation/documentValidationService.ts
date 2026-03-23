import * as vscode from "vscode";
import { SfpXmlLinterSettings } from "../../config/settings";
import { WorkspaceIndex } from "../../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import { SystemMetadata } from "../../config/systemMetadata";
import { resolveDocumentFacts } from "../model/factsResolution";

export interface IndexedValidationOutcome {
  uri: vscode.Uri;
  diagnostics: vscode.Diagnostic[];
  signature: string;
  shouldLog: boolean;
  relOrPath: string;
  totalMs: number;
  readMs: number;
  diagnosticsMs: number;
  pathMode: "fast" | "fs" | "open";
  cacheMiss: boolean;
}

export interface DocumentValidationServiceDeps {
  emptyIndex: WorkspaceIndex;
  clearDiagnostics: (uri: vscode.Uri) => void;
  setDiagnostics: (uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]) => void;
  getIndexForUri: (uri: vscode.Uri) => WorkspaceIndex;
  getFactsForUri?: (uri: vscode.Uri, index: WorkspaceIndex) => ReturnType<typeof parseDocumentFactsFromText> | undefined;
  buildDiagnosticsForDocument: (
    document: vscode.TextDocument,
    currentIndex: WorkspaceIndex,
    facts: ReturnType<typeof parseDocumentFactsFromText>,
    options?: { settingsSnapshot?: SfpXmlLinterSettings; metadataSnapshot?: SystemMetadata }
  ) => vscode.Diagnostic[];
  shouldValidateUriForActiveProjects: (uri: vscode.Uri) => boolean;
  documentInConfiguredRoots: (document: vscode.TextDocument) => boolean;
  isUserOpenDocument: (uri: vscode.Uri) => boolean;
  hasInitialIndex: () => boolean;
  openTextDocumentWithInternalFlag: (uri: vscode.Uri) => Promise<vscode.TextDocument | undefined>;
  readWorkspaceFileText: (uri: vscode.Uri) => Promise<string>;
  createVirtualXmlDocument: (uri: vscode.Uri, text: string) => vscode.TextDocument;
  getRelativePath: (uri: vscode.Uri) => string;
  logIndex: (message: string) => void;
  logSingleFile: (message: string) => void;
  referenceRuleFilter: (diagnostic: vscode.Diagnostic) => boolean;
}

export class DocumentValidationService {
  private readonly standaloneValidationVersionByUri = new Map<string, number>();
  private readonly indexedValidationLogSignatureByUri = new Map<string, string>();

  public constructor(private readonly deps: DocumentValidationServiceDeps) {}

  public clearValidationStateForUri(uri: vscode.Uri): void {
    const key = uri.toString();
    this.standaloneValidationVersionByUri.delete(key);
    this.indexedValidationLogSignatureByUri.delete(key);
  }

  public getIndexedValidationLogSignature(uriKey: string): string | undefined {
    return this.indexedValidationLogSignatureByUri.get(uriKey);
  }

  public setIndexedValidationLogSignature(uriKey: string, signature: string): void {
    this.indexedValidationLogSignatureByUri.set(uriKey, signature);
  }

  public validateDocument(document: vscode.TextDocument): void {
    this.validateDocumentInternal(document, { respectProjectScope: true });
  }

  private validateDocumentInternal(
    document: vscode.TextDocument,
    options?: { respectProjectScope?: boolean }
  ): void {
    const respectProjectScope = options?.respectProjectScope !== false;
    if (document.languageId !== "xml") {
      this.deps.clearDiagnostics(document.uri);
      return;
    }

    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      this.deps.clearDiagnostics(document.uri);
      return;
    }

    const relOrPath = document.uri.scheme === "file"
      ? this.deps.getRelativePath(document.uri)
      : document.uri.toString();

    if (!this.deps.documentInConfiguredRoots(document)) {
      const docKey = document.uri.toString();
      const alreadyValidatedVersion = this.standaloneValidationVersionByUri.get(docKey);
      if (alreadyValidatedVersion === document.version) {
        return;
      }

      this.deps.logSingleFile(`validate standalone START: ${relOrPath}`);
      const standaloneFacts = this.resolveFactsFromDocument(document, this.deps.emptyIndex, "fallback-parse");
      if (!standaloneFacts) {
        this.deps.clearDiagnostics(document.uri);
        return;
      }
      const standaloneDiagnostics = this.deps.buildDiagnosticsForDocument(
        document,
        this.deps.emptyIndex,
        standaloneFacts
      ).filter(this.deps.referenceRuleFilter);
      this.deps.setDiagnostics(document.uri, standaloneDiagnostics);
      this.standaloneValidationVersionByUri.set(docKey, document.version);
      this.deps.logSingleFile(`validate standalone DONE: ${relOrPath} diagnostics=${standaloneDiagnostics.length}`);
      return;
    }

    if (respectProjectScope && !this.deps.shouldValidateUriForActiveProjects(document.uri)) {
      this.deps.logIndex(`validate skipped by project scope: ${relOrPath}`);
      this.deps.clearDiagnostics(document.uri);
      return;
    }

    if (!this.deps.hasInitialIndex()) {
      this.deps.logIndex(`validate skipped before initial index: ${relOrPath}`);
      this.deps.clearDiagnostics(document.uri);
      return;
    }

    const currentIndex = this.deps.getIndexForUri(document.uri);
    if (!currentIndex.fullReady) {
      this.deps.logIndex(`validate skipped: index not fullReady for ${relOrPath}`);
      return;
    }
    const parsedFacts = this.resolveFactsForValidation(document, currentIndex, relOrPath);
    if (!parsedFacts) {
      this.deps.clearDiagnostics(document.uri);
      return;
    }
    const result = this.deps.buildDiagnosticsForDocument(document, currentIndex, parsedFacts);
    this.deps.setDiagnostics(document.uri, result);
    if (result.length > 0 || this.deps.isUserOpenDocument(document.uri)) {
      const key = document.uri.toString();
      const signature = `${document.version}:${result.length}`;
      if (this.indexedValidationLogSignatureByUri.get(key) !== signature) {
        this.indexedValidationLogSignatureByUri.set(key, signature);
        this.deps.logIndex(`validate indexed DONE: ${relOrPath} diagnostics=${result.length}`);
      }
    }
  }

  public async validateUri(
    uri: vscode.Uri,
    options?: { respectProjectScope?: boolean; preferFsRead?: boolean }
  ): Promise<void> {
    if (uri.scheme !== "file") {
      this.deps.clearDiagnostics(uri);
      return;
    }

    const respectProjectScope = options?.respectProjectScope !== false;
    if (respectProjectScope && !this.deps.shouldValidateUriForActiveProjects(uri)) {
      this.deps.clearDiagnostics(uri);
      return;
    }

    const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    try {
      let document = existing;
      if (!document && options?.preferFsRead) {
        const text = await this.deps.readWorkspaceFileText(uri);
        const virtualDocument = this.deps.createVirtualXmlDocument(uri, text);
        this.validateDocument(virtualDocument);
        return;
      }

      if (!document) {
        document = await this.deps.openTextDocumentWithInternalFlag(uri);
      }

      if (!document) {
        return;
      }

      this.validateDocumentInternal(document, { respectProjectScope });
    } catch (error) {
      const relOrPath = this.deps.getRelativePath(uri);
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logIndex(`validateUri ERROR: ${relOrPath} ${message}`);
      this.deps.clearDiagnostics(uri);
    }
  }

  public async computeIndexedValidationOutcome(
    uri: vscode.Uri,
    options?: {
      respectProjectScope?: boolean;
      preferFsRead?: boolean;
      settingsSnapshot?: SfpXmlLinterSettings;
      metadataSnapshot?: SystemMetadata;
    }
  ): Promise<IndexedValidationOutcome | undefined> {
    const totalStartedAt = Date.now();
    if (uri.scheme !== "file") {
      this.deps.clearDiagnostics(uri);
      return undefined;
    }

    const respectProjectScope = options?.respectProjectScope !== false;
    if (respectProjectScope && !this.deps.shouldValidateUriForActiveProjects(uri)) {
      this.deps.clearDiagnostics(uri);
      return undefined;
    }

    const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const readStartedAt = Date.now();
    const index = this.deps.getIndexForUri(uri);
    if (!index.fullReady) {
      return undefined;
    }
    const cachedFacts = this.deps.getFactsForUri?.(uri, index);
    const cacheMiss = options?.preferFsRead === true && !cachedFacts;

    let document = existing;
    let pathMode: "fast" | "fs" | "open" = "open";
    if (document && !options?.preferFsRead && cachedFacts) {
      pathMode = "fast";
    }
    if (!document && options?.preferFsRead) {
      const text = await this.deps.readWorkspaceFileText(uri);
      document = this.deps.createVirtualXmlDocument(uri, text);
      pathMode = "fs";
    }
    if (!document) {
      document = await this.deps.openTextDocumentWithInternalFlag(uri);
      pathMode = "open";
    }
    if (!document) {
      return undefined;
    }
    const readMs = Date.now() - readStartedAt;
    const diagnosticsStartedAt = Date.now();
    const relOrPath = this.deps.getRelativePath(uri);
    const effectiveFacts = this.resolveFactsForValidation(document, index, relOrPath);
    if (!effectiveFacts) {
      return undefined;
    }
    const computed = this.deps.buildDiagnosticsForDocument(document, index, effectiveFacts, {
      settingsSnapshot: options?.settingsSnapshot,
      metadataSnapshot: options?.metadataSnapshot
    });
    const diagnosticsMs = Date.now() - diagnosticsStartedAt;
    const signature = `${document.version}:${computed.length}`;
    return {
      uri,
      diagnostics: computed,
      signature,
      shouldLog: computed.length > 0 || this.deps.isUserOpenDocument(uri),
      relOrPath,
      totalMs: Date.now() - totalStartedAt,
      readMs,
      diagnosticsMs,
      pathMode,
      cacheMiss
    };
  }

  private resolveFactsFromDocument(
    document: vscode.TextDocument,
    index: WorkspaceIndex,
    mode: "strict-accessor" | "fallback-parse"
  ): ReturnType<typeof parseDocumentFactsFromText> | undefined {
    return resolveDocumentFacts(document, index, {
      getFactsForUri: this.deps.getFactsForUri,
      parseFacts: parseDocumentFacts,
      mode
    });
  }

  private resolveFactsForValidation(
    document: vscode.TextDocument,
    index: WorkspaceIndex,
    relOrPath: string
  ): ReturnType<typeof parseDocumentFactsFromText> | undefined {
    const normalized = relOrPath.replace(/\\/g, "/").toLowerCase();
    const isTemplateDomain =
      normalized.includes("/xml_templates/") ||
      normalized.startsWith("xml_templates/") ||
      normalized.includes("/xml_components/") ||
      normalized.startsWith("xml_components/") ||
      normalized.includes("/xml_primitives/") ||
      normalized.startsWith("xml_primitives/");

    if (isTemplateDomain) {
      const parsedFacts = parseFactsStandalone(document);
      if (parsedFacts) {
        this.deps.logIndex(`validate facts parse-first used: ${relOrPath}`);
        return parsedFacts;
      }
    }

    const strictFacts = this.resolveFactsFromDocument(document, index, "strict-accessor");
    if (strictFacts) {
      return strictFacts;
    }
    const fallbackFacts = parseFactsStandalone(document);
    if (fallbackFacts) {
      this.deps.logIndex(`validate facts fallback-parse used: ${relOrPath}`);
      return fallbackFacts;
    }
    return undefined;
  }
}

export function parseFactsStandalone(
  document: vscode.TextDocument
): ReturnType<typeof parseDocumentFactsFromText> {
  return parseDocumentFacts(document);
}

