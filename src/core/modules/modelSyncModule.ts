import * as vscode from "vscode";
import { PipelineModule, QueuedUpdateEvent } from "../pipeline/types";

export interface ModelSyncModuleDeps {
  upsertModelNodeFromDocument: (document: vscode.TextDocument) => void;
  upsertModelNodeFromUri: (uri: vscode.Uri, provider?: "file" | "generator" | "runtime") => void;
  removeModelNodeByUri: (uri: vscode.Uri) => void;
}

export class ModelSyncModule implements PipelineModule {
  public readonly id = "model-sync";
  public readonly phase = "affectedSubgraphMs" as const;

  public constructor(private readonly deps: ModelSyncModuleDeps) {}

  public async onUpdate(event: QueuedUpdateEvent): Promise<void> {
    switch (event.payload.type) {
      case "open-document":
        this.deps.upsertModelNodeFromDocument(event.payload.document);
        break;
      case "text-changed":
        this.deps.upsertModelNodeFromDocument(event.payload.event.document);
        break;
      case "save-document":
        this.deps.upsertModelNodeFromDocument(event.payload.document);
        break;
      case "close-document":
        this.deps.upsertModelNodeFromDocument(event.payload.document);
        break;
      case "files-created":
        for (const uri of event.payload.files) {
          this.deps.upsertModelNodeFromUri(uri, "file");
        }
        break;
      case "files-deleted":
        for (const uri of event.payload.files) {
          this.deps.removeModelNodeByUri(uri);
        }
        break;
      case "files-renamed":
        for (const item of event.payload.files) {
          this.deps.removeModelNodeByUri(item.oldUri);
          this.deps.upsertModelNodeFromUri(item.newUri, "file");
        }
        break;
    }
  }
}
