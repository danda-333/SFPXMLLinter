import * as vscode from "vscode";
import type { ParsedDocumentFacts } from "../../indexer/xmlFacts";
import type { WorkspaceIndex } from "../../indexer/types";
import { ComposedDocumentSnapshotRegistry } from "./composedDocumentSnapshotRegistry";

export interface ComposedSnapshotRefreshServiceDeps {
  registry: ComposedDocumentSnapshotRegistry;
  getTemplateIndex: () => WorkspaceIndex;
  getRuntimeIndex: () => WorkspaceIndex;
  getFactsForDocument: (document: vscode.TextDocument) => ParsedDocumentFacts | undefined;
  logIndex: (message: string) => void;
}

export class ComposedSnapshotRefreshService {
  public constructor(private readonly deps: ComposedSnapshotRefreshServiceDeps) {}

  public getSnapshotVersion(): number {
    return this.deps.registry.getVersion();
  }

  public refreshForDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file") {
      return;
    }

    const facts = this.deps.getFactsForDocument(document);
    if (!facts) {
      return;
    }

    const snapshotDeps = {
      templateIndex: this.deps.getTemplateIndex(),
      runtimeIndex: this.deps.getRuntimeIndex()
    };
    const owningFormIdent = this.getOwningFormIdent(facts);
    if (owningFormIdent) {
      this.deps.registry.refreshForFormIdents(new Set([owningFormIdent]), snapshotDeps);
    }
    this.deps.registry.refreshForUris([document.uri], snapshotDeps);
  }

  public refreshForSave(cycleId: string, document: vscode.TextDocument, affectedFormIdents: ReadonlySet<string>): void {
    const refreshStartedAt = Date.now();
    const snapshotDeps = {
      templateIndex: this.deps.getTemplateIndex(),
      runtimeIndex: this.deps.getRuntimeIndex()
    };
    let refreshed = 0;
    if (affectedFormIdents.size > 0) {
      refreshed += this.deps.registry.refreshForFormIdents(affectedFormIdents, snapshotDeps);
    }
    refreshed += this.deps.registry.refreshForUris([document.uri], snapshotDeps);
    const stats = this.deps.registry.getStats();
    this.deps.logIndex(
      `${cycleId} snapshot refresh docs=${refreshed} in ${Date.now() - refreshStartedAt} ms (total=${stats.snapshots}, forms=${stats.forms})`
    );
  }

  private getOwningFormIdent(facts: ParsedDocumentFacts): string | undefined {
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root === "form") {
      return facts.formIdent;
    }
    if (root === "workflow") {
      return facts.workflowFormIdent ?? facts.rootFormIdent;
    }
    if (root === "dataview") {
      return facts.rootFormIdent;
    }
    return undefined;
  }
}

