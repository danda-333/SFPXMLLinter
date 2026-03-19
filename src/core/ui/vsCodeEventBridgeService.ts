import * as vscode from "vscode";
import { UpdateEventPayload, UpdatePriority } from "../pipeline/types";

export interface VsCodeEventBridgeServiceDeps {
  enqueue: (payload: UpdateEventPayload, priority: UpdatePriority, key: string) => void;
}

export class VsCodeEventBridgeService {
  public constructor(private readonly deps: VsCodeEventBridgeServiceDeps) {}

  public register(context: vscode.ExtensionContext): void {
    const isXmlDocumentEvent = (document: vscode.TextDocument): boolean =>
      document.languageId === "xml" && (document.uri.scheme === "file" || document.uri.scheme === "untitled");
    const isFileOrUntitledDocument = (document: vscode.TextDocument): boolean =>
      document.uri.scheme === "file" || document.uri.scheme === "untitled";

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (!isXmlDocumentEvent(document)) {
          return;
        }
        this.deps.enqueue(
          { type: "open-document", document },
          "normal",
          `open:${document.uri.toString()}`
        );
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const document = editor?.document;
        if (!document || !isXmlDocumentEvent(document)) {
          return;
        }
        this.deps.enqueue(
          { type: "active-editor-changed", editor },
          "normal",
          `active:${editor?.document.uri.toString() ?? "none"}`
        );
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!isXmlDocumentEvent(document)) {
          return;
        }
        this.deps.enqueue(
          { type: "close-document", document },
          "normal",
          `close:${document.uri.toString()}`
        );
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isXmlDocumentEvent(event.document)) {
          return;
        }
        this.deps.enqueue(
          { type: "text-changed", event },
          "high",
          `change:${event.document.uri.toString()}`
        );
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.deps.enqueue(
          { type: "visible-editors-changed" },
          "low",
          "visible-editors"
        );
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.deps.enqueue(
          { type: "tabs-changed" },
          "low",
          "tabs"
        );
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!isFileOrUntitledDocument(document)) {
          return;
        }
        this.deps.enqueue(
          { type: "save-document", document },
          "high",
          `save:${document.uri.toString()}`
        );
      }),
      vscode.workspace.onDidCreateFiles((event) => {
        this.deps.enqueue(
          { type: "files-created", files: event.files },
          "high",
          `create:${event.files.map((f) => f.toString()).sort().join("|")}`
        );
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        this.deps.enqueue(
          { type: "files-deleted", files: event.files },
          "high",
          `delete:${event.files.map((f) => f.toString()).sort().join("|")}`
        );
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        this.deps.enqueue(
          { type: "files-renamed", files: event.files },
          "high",
          `rename:${event.files.map((f) => `${f.oldUri.toString()}=>${f.newUri.toString()}`).sort().join("|")}`
        );
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        this.deps.enqueue(
          { type: "configuration-changed", event },
          "high",
          "configuration"
        );
      })
    );
  }
}
