import * as vscode from "vscode";
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
  onPostSave?: (context: PostSaveContext) => Promise<void> | void;
}

export interface SavePerformanceEvent {
  cycleId: string;
  phase: "start" | "refresh" | "build-done" | "dependency-queued" | "done";
  document: vscode.TextDocument;
  elapsedMs: number;
  refresh?: IncrementalRefreshOutcome;
  dependency?: DependencyRevalidationStats;
}

export interface PostSaveContext {
  cycleId: string;
  document: vscode.TextDocument;
  refresh: IncrementalRefreshOutcome;
  affectedFormIdents: ReadonlySet<string>;
  dependency?: DependencyRevalidationStats;
}

export class UpdateOrchestrator {
  private saveCycleCounter = 0;
  private readonly saveTaskByUri = new Map<string, Promise<void>>();

  public constructor(private readonly hooks: UpdateOrchestratorHooks) {}

  public async waitForSaveIdle(): Promise<void> {
    while (true) {
      const pendingSaves = [...this.saveTaskByUri.values()];
      if (pendingSaves.length === 0) {
        return;
      }
      await Promise.all([...pendingSaves].map((task) => task.catch(() => undefined)));
    }
  }

  public async handleDocumentSave(document: vscode.TextDocument, hadContentChanges: boolean): Promise<void> {
    const key = document.uri.toString();
    const prev = this.saveTaskByUri.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.runDocumentSave(document, hadContentChanges);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.hooks.log(`save pipeline ERROR ${vscode.workspace.asRelativePath(document.uri, false)}: ${message}`);
        }
      })
      .finally(() => {
        if (this.saveTaskByUri.get(key) === next) {
          this.saveTaskByUri.delete(key);
        }
      });

    this.saveTaskByUri.set(key, next);
  }

  private async runDocumentSave(document: vscode.TextDocument, hadContentChanges: boolean): Promise<void> {
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

    let dependencyStats: DependencyRevalidationStats | undefined;
    if (affectedFormIdents.size > 0) {
      const sourceLabel = `${cycleId}:${refresh.rootKind}:${rel}`;
      const dependencyStartedAt = Date.now();
      const dependency = this.hooks.enqueueDependentValidationForFormIdents(affectedFormIdents, sourceLabel);
      dependencyStats = dependency;
      if (dependency) {
        this.hooks.log(
          `${cycleId} dependency validation queued forms=${dependency.forms}, files=${dependency.files}, immediateOpen=${dependency.immediateOpen}, low=${dependency.queuedLow}, in ${dependency.durationMs} ms`
        );
      }
      this.hooks.onSavePerformance?.({
        cycleId,
        phase: "dependency-queued",
        document,
        elapsedMs: Date.now() - cycleStartedAt,
        refresh,
        dependency: dependency ?? {
          forms: affectedFormIdents.size,
          files: 0,
          immediateOpen: 0,
          queuedLow: 0,
          durationMs: Date.now() - dependencyStartedAt
        }
      });
    }
    await this.hooks.onPostSave?.({
      cycleId,
      document,
      refresh,
      affectedFormIdents,
      ...(dependencyStats ? { dependency: dependencyStats } : {})
    });
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
}
