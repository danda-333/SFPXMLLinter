import * as vscode from "vscode";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import type { DependencyRevalidationStats } from "../core/validation/dependencyValidationService";

export type XmlStructuralKind = "form" | "workflow" | "dataview" | "component" | "feature" | "other";

export interface IncrementalRefreshOutcome {
  updated: boolean;
  reason: string;
  rootKind: XmlStructuralKind;
  formIdent?: string;
  componentKey?: string;
  owningFormIdent?: string;
}

export interface UpdateOrchestratorHooks {
  log: (message: string) => void;
  isReindexRelevantUri: (uri: vscode.Uri) => boolean;
  refreshIncremental: (document: vscode.TextDocument) => IncrementalRefreshOutcome;
  collectAffectedFormIdentsForComponent: (componentKey: string) => Set<string>;
  enqueueDependentValidationForFormIdents: (
    formIdents: ReadonlySet<string>,
    sourceLabel: string
  ) => DependencyRevalidationStats | undefined;
  triggerAutoBuild: (document: vscode.TextDocument, componentKeyHint?: string) => Promise<void>;
  queueFullReindex: () => void;
  onSavePerformance?: (event: SavePerformanceEvent) => void;
}

export interface SavePerformanceEvent {
  cycleId: string;
  phase: "start" | "refresh" | "build-done" | "dependency-queued" | "done";
  document: vscode.TextDocument;
  elapsedMs: number;
  refresh?: IncrementalRefreshOutcome;
  dependency?: DependencyRevalidationStats;
}

export class UpdateOrchestrator {
  private saveCycleCounter = 0;

  public constructor(private readonly hooks: UpdateOrchestratorHooks) {}

  public async handleDocumentSave(document: vscode.TextDocument, hadContentChanges: boolean): Promise<void> {
    if (!hadContentChanges) {
      return;
    }

    if (!this.hooks.isReindexRelevantUri(document.uri)) {
      await this.hooks.triggerAutoBuild(document);
      return;
    }

    const rel = vscode.workspace.asRelativePath(document.uri, false);
    const cycleId = `save#${++this.saveCycleCounter}`;
    const cycleStartedAt = Date.now();
    this.hooks.log(`${cycleId} START ${rel}`);
    this.hooks.onSavePerformance?.({
      cycleId,
      phase: "start",
      document,
      elapsedMs: 0
    });
    const refresh = this.hooks.refreshIncremental(document);
    this.hooks.log(
      `${cycleId} refresh ${refresh.updated ? "UPDATED" : "SKIPPED"} root=${refresh.rootKind} (${refresh.reason}) ${rel}`
    );
    this.hooks.onSavePerformance?.({
      cycleId,
      phase: "refresh",
      document,
      elapsedMs: Date.now() - cycleStartedAt,
      refresh
    });

    const affectedFormIdents = new Set<string>();
    if (refresh.formIdent) {
      affectedFormIdents.add(refresh.formIdent);
    }
    if (refresh.owningFormIdent) {
      affectedFormIdents.add(refresh.owningFormIdent);
    }
    if (refresh.componentKey) {
      for (const formIdent of this.hooks.collectAffectedFormIdentsForComponent(refresh.componentKey)) {
        affectedFormIdents.add(formIdent);
      }
    }

    // First rebuild/refresh any generated outputs so dependent validations
    // run against up-to-date indexed data.
    const buildStartedAt = Date.now();
    await this.hooks.triggerAutoBuild(document, refresh.componentKey);
    this.hooks.log(`${cycleId} build done in ${Date.now() - buildStartedAt} ms`);
    this.hooks.onSavePerformance?.({
      cycleId,
      phase: "build-done",
      document,
      elapsedMs: Date.now() - cycleStartedAt,
      refresh
    });

    if (affectedFormIdents.size > 0) {
      const sourceLabel = `${cycleId}:${refresh.rootKind}:${rel}`;
      const dependency = this.hooks.enqueueDependentValidationForFormIdents(affectedFormIdents, sourceLabel);
      this.hooks.onSavePerformance?.({
        cycleId,
        phase: "dependency-queued",
        document,
        elapsedMs: Date.now() - cycleStartedAt,
        refresh,
        dependency
      });
    }
    const totalMs = Date.now() - cycleStartedAt;
    this.hooks.log(`${cycleId} DONE total=${totalMs} ms affectedForms=${affectedFormIdents.size}`);
    this.hooks.onSavePerformance?.({
      cycleId,
      phase: "done",
      document,
      elapsedMs: totalMs,
      refresh
    });
  }

  public handleFilesCreated(uris: readonly vscode.Uri[]): void {
    const relevant = uris.some((uri) => this.hooks.isReindexRelevantUri(uri));
    if (relevant) {
      this.hooks.log("ORCH fs-create -> queue full reindex");
      this.hooks.queueFullReindex();
    }
  }

  public handleFilesDeleted(uris: readonly vscode.Uri[]): void {
    const relevant = uris.some((uri) => this.hooks.isReindexRelevantUri(uri));
    if (relevant) {
      this.hooks.log("ORCH fs-delete -> queue full reindex");
      this.hooks.queueFullReindex();
    }
  }

  public handleFilesRenamed(items: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): void {
    const relevant = items.some((item) => this.hooks.isReindexRelevantUri(item.oldUri) || this.hooks.isReindexRelevantUri(item.newUri));
    if (relevant) {
      this.hooks.log("ORCH fs-rename -> queue full reindex");
      this.hooks.queueFullReindex();
    }
  }

  public inferRootKind(document: vscode.TextDocument): XmlStructuralKind {
    const root = (parseDocumentFacts(document).rootTag ?? "").toLowerCase();
    if (root === "form" || root === "workflow" || root === "dataview" || root === "component" || root === "feature") {
      return root;
    }
    return "other";
  }
}
