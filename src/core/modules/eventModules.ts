import * as vscode from "vscode";
import { PipelineModule, QueuedUpdateEvent } from "../pipeline/types";

export interface DocumentEventsModuleDeps {
  handleOpenDocument: (document: vscode.TextDocument) => Promise<void>;
  handleActiveEditorChanged: (editor: vscode.TextEditor | undefined) => Promise<void>;
  handleCloseDocument: (document: vscode.TextDocument) => Promise<void>;
  handleTextChanged: (event: vscode.TextDocumentChangeEvent) => Promise<void>;
  handleVisibleEditorsChanged: () => Promise<void>;
  handleTabsChanged: () => Promise<void>;
}

export class DocumentEventsModule implements PipelineModule {
  public readonly id = "document-events";
  public readonly phase = "collectChangesMs" as const;

  public constructor(private readonly deps: DocumentEventsModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<void> {
    if (token.isCancelled()) {
      return;
    }
    switch (event.payload.type) {
      case "open-document":
        await this.deps.handleOpenDocument(event.payload.document);
        break;
      case "active-editor-changed":
        await this.deps.handleActiveEditorChanged(event.payload.editor);
        break;
      case "close-document":
        await this.deps.handleCloseDocument(event.payload.document);
        break;
      case "text-changed":
        await this.deps.handleTextChanged(event.payload.event);
        break;
      case "visible-editors-changed":
        await this.deps.handleVisibleEditorsChanged();
        break;
      case "tabs-changed":
        await this.deps.handleTabsChanged();
        break;
    }
  }
}

export interface DiagnosticsEventsModuleDeps {
  handleOpenDocumentDiagnostics: (document: vscode.TextDocument) => Promise<void>;
  handleCloseDocumentDiagnostics: (document: vscode.TextDocument) => Promise<void>;
  handleTextChangedDiagnostics: (event: vscode.TextDocumentChangeEvent) => Promise<void>;
  handleVisibleEditorsChangedDiagnostics: () => Promise<void>;
  handleTabsChangedDiagnostics: () => Promise<void>;
}

export class DiagnosticsEventsModule implements PipelineModule {
  public readonly id = "diagnostics-events";
  public readonly phase = "validationMs" as const;

  public constructor(private readonly deps: DiagnosticsEventsModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<void> {
    if (token.isCancelled()) {
      return;
    }
    switch (event.payload.type) {
      case "open-document":
        await this.deps.handleOpenDocumentDiagnostics(event.payload.document);
        break;
      case "close-document":
        await this.deps.handleCloseDocumentDiagnostics(event.payload.document);
        break;
      case "text-changed":
        await this.deps.handleTextChangedDiagnostics(event.payload.event);
        break;
      case "visible-editors-changed":
        await this.deps.handleVisibleEditorsChangedDiagnostics();
        break;
      case "tabs-changed":
        await this.deps.handleTabsChangedDiagnostics();
        break;
    }
  }
}

export interface SaveBuildModuleDeps {
  handleSaveDocument: (document: vscode.TextDocument) => Promise<void>;
}

export class SaveBuildModule implements PipelineModule {
  public readonly id = "save-build-events";
  public readonly phase = "composeMs" as const;

  public constructor(private readonly deps: SaveBuildModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<void> {
    if (token.isCancelled()) {
      return;
    }
    if (event.payload.type === "save-document") {
      await this.deps.handleSaveDocument(event.payload.document);
    }
  }
}

export interface FilesystemEventsModuleDeps {
  handleFilesCreated: (files: readonly vscode.Uri[]) => Promise<void>;
  handleFilesDeleted: (files: readonly vscode.Uri[]) => Promise<void>;
  handleFilesRenamed: (files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]) => Promise<void>;
}

export class FilesystemEventsModule implements PipelineModule {
  public readonly id = "filesystem-events";
  public readonly phase = "collectChangesMs" as const;

  public constructor(private readonly deps: FilesystemEventsModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<void> {
    if (token.isCancelled()) {
      return;
    }
    switch (event.payload.type) {
      case "files-created":
        await this.deps.handleFilesCreated(event.payload.files);
        break;
      case "files-deleted":
        await this.deps.handleFilesDeleted(event.payload.files);
        break;
      case "files-renamed":
        await this.deps.handleFilesRenamed(event.payload.files);
        break;
    }
  }
}

export interface ConfigurationEventsModuleDeps {
  handleConfigurationChanged: (event: vscode.ConfigurationChangeEvent) => Promise<void>;
}

export class ConfigurationEventsModule implements PipelineModule {
  public readonly id = "configuration-events";
  public readonly phase = "collectChangesMs" as const;

  public constructor(private readonly deps: ConfigurationEventsModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<void> {
    if (token.isCancelled()) {
      return;
    }
    if (event.payload.type === "configuration-changed") {
      await this.deps.handleConfigurationChanged(event.payload.event);
    }
  }
}
