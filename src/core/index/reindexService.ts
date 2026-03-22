import * as vscode from "vscode";
import { SfpXmlLinterSettings } from "../../config/settings";
import { WorkspaceIndexer, RebuildIndexProgressEvent } from "../../indexer/workspaceIndexer";

export type ReindexScope = "bootstrap" | "all";
type ReindexQueueScope = "none" | ReindexScope;

export interface ReindexServiceDeps {
  templateIndexer: WorkspaceIndexer;
  runtimeIndexer: WorkspaceIndexer;
  log: (message: string) => void;
  formatIndexProgress: (event: RebuildIndexProgressEvent) => string;
  mapIndexPhasePercent: (event: RebuildIndexProgressEvent) => number;
  rebuildFeatureRegistry: () => void;
  validateOpenDocuments: () => void;
  globConfiguredXmlFiles: () => Promise<readonly vscode.Uri[]>;
  enqueueWorkspaceValidation: (uris: readonly vscode.Uri[]) => void;
  queueProvenanceHydration: (activeUri?: vscode.Uri) => void;
  setHasInitialIndex: (value: boolean) => void;
  refreshComposedSnapshotsAll?: () => number;
  validateUri: (uri: vscode.Uri, options?: { respectProjectScope?: boolean; preferFsRead?: boolean }) => Promise<void>;
  getProjectKeyForUri: (uri: vscode.Uri) => string | undefined;
  getSettingsSnapshot: () => SfpXmlLinterSettings;
  sleep: (ms: number) => Promise<void>;
}

export class ReindexService implements vscode.Disposable {
  private hasShownInitialIndexReadyNotification = false;
  private hasCompletedInitialWorkspaceValidation = false;
  private isReindexRunning = false;
  private queuedReindexScope: ReindexQueueScope = "none";
  private deferredFullReindexTimer: NodeJS.Timeout | undefined;
  private reindexProgressState:
    | {
        progress: vscode.Progress<{ message?: string; increment?: number }>;
        reportedPercent: number;
      }
    | undefined;

  public constructor(private readonly deps: ReindexServiceDeps) {}

  public dispose(): void {
    if (this.deferredFullReindexTimer) {
      clearTimeout(this.deferredFullReindexTimer);
      this.deferredFullReindexTimer = undefined;
    }
  }

  public reportReindexProgress(domain: "template" | "runtime", event: RebuildIndexProgressEvent): void {
    const state = this.reindexProgressState;
    if (!state) {
      return;
    }

    const phasePercent = this.deps.mapIndexPhasePercent(event);
    const absolutePercent = domain === "template" ? Math.floor(phasePercent * 0.5) : 50 + Math.floor(phasePercent * 0.5);
    const increment = Math.max(0, absolutePercent - state.reportedPercent);
    state.progress.report({
      increment,
      message: `[${domain}] ${this.deps.formatIndexProgress(event)}`
    });
    state.reportedPercent = Math.max(state.reportedPercent, absolutePercent);
  }

  public async withReindexProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        const previous = this.reindexProgressState;
        this.reindexProgressState = {
          progress,
          reportedPercent: 0
        };

        try {
          const result = await fn();
          if (this.reindexProgressState.reportedPercent < 100) {
            progress.report({
              increment: 100 - this.reindexProgressState.reportedPercent,
              message: "done"
            });
            this.reindexProgressState.reportedPercent = 100;
          }
          return result;
        } finally {
          this.reindexProgressState = previous;
        }
      }
    );
  }

  public scheduleDeferredFullReindex(delayMs = 1000): void {
    if (this.deferredFullReindexTimer) {
      clearTimeout(this.deferredFullReindexTimer);
    }

    this.deferredFullReindexTimer = setTimeout(() => {
      this.deferredFullReindexTimer = undefined;
      if (!this.hasShownInitialIndexReadyNotification) {
        void this.withReindexProgress("SFP XML Linter: Initial Full Indexing", async () => {
          await this.queueReindex("all");
        });
        return;
      }

      void this.queueReindex("all");
    }, delayMs);
  }

  public async queueReindex(
    scope: ReindexScope,
    options?: { verboseProgress?: boolean; includeRuntimeForBootstrap?: boolean }
  ): Promise<void> {
    this.deps.log(`QUEUE reindex requested scope=${scope} running=${this.isReindexRunning}`);
    if (this.isReindexRunning) {
      this.queuedReindexScope = maxReindexScope(this.queuedReindexScope, scope);
      this.deps.log(`QUEUE reindex deferred scope=${this.queuedReindexScope}`);
      return;
    }

    this.isReindexRunning = true;
    const startedAt = Date.now();
    try {
      const verboseProgress = options?.verboseProgress ?? this.deps.getSettingsSnapshot().startupVerboseProgress;
      const includeRuntimeForBootstrap = options?.includeRuntimeForBootstrap;
      let pendingScope: ReindexScope = scope;
      do {
        this.queuedReindexScope = "none";
        const passStartedAt = Date.now();
        this.deps.log(`REINDEX pass START scope=${pendingScope}`);
        if (pendingScope === "bootstrap") {
          await this.rebuildBootstrapIndexAndValidateOpenDocs({
            verboseProgress,
            includeRuntime: includeRuntimeForBootstrap
          });
        } else {
          await this.rebuildIndexAndValidateOpenDocs({ verboseProgress });
        }
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        this.deps.queueProvenanceHydration(activeUri);
        this.deps.log(`REINDEX pass DONE scope=${pendingScope} in ${Date.now() - passStartedAt} ms`);

        const queued = this.queuedReindexScope;
        if (queued === "none") {
          break;
        }
        pendingScope = queued;
      } while (true);

      const durationMs = Date.now() - startedAt;
      this.deps.log(`REINDEX all passes DONE in ${durationMs} ms`);
      vscode.window.setStatusBarMessage(`SFP XML Linter: Indexace dokoncena (${durationMs} ms)`, 4000);

      if (!this.hasShownInitialIndexReadyNotification) {
        this.hasShownInitialIndexReadyNotification = true;
        vscode.window.showInformationMessage(`SFP XML Linter: Úvodní indexace dokoncena (${durationMs} ms).`);
      }
    } finally {
      this.isReindexRunning = false;
    }
  }

  public async revalidateWorkspaceFull(): Promise<void> {
    const startedAt = Date.now();
    this.deps.log("REVALIDATE START: full reindex + full validation");
    await this.withReindexProgress("SFP XML Linter: Revalidate - Indexing", async () => {
      await this.queueReindex("all");
    });

    const uris = (await this.deps.globConfiguredXmlFiles()).filter((uri) => uri.scheme === "file");
    await this.validateUrisWithProgress(uris, "SFP XML Linter: Revalidating workspace", { respectProjectScope: false });

    const durationMs = Date.now() - startedAt;
    this.deps.log(`REVALIDATE DONE: ${uris.length} files in ${durationMs} ms`);
    vscode.window.showInformationMessage(`SFP XML Linter: Revalidate done (${uris.length} files, ${durationMs} ms).`);
  }

  public async revalidateCurrentProject(): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== "file") {
      vscode.window.showInformationMessage("SFP XML Linter: Open a file from the target project first.");
      return;
    }

    const projectKey = this.deps.getProjectKeyForUri(activeUri);
    if (!projectKey) {
      vscode.window.showInformationMessage("SFP XML Linter: Active file is outside configured XML roots.");
      return;
    }

    const startedAt = Date.now();
    this.deps.log(`REVALIDATE PROJECT START: ${projectKey}`);
    await this.withReindexProgress("SFP XML Linter: Revalidate - Current Project Indexing", async () => {
      await this.queueReindex("all");
    });

    const uris = (await this.deps.globConfiguredXmlFiles())
      .filter((uri) => uri.scheme === "file")
      .filter((uri) => this.deps.getProjectKeyForUri(uri) === projectKey);
    await this.validateUrisWithProgress(uris, "SFP XML Linter: Revalidating current project", { preferFsRead: true });

    const durationMs = Date.now() - startedAt;
    this.deps.log(`REVALIDATE PROJECT DONE: ${uris.length} files in ${durationMs} ms`);
    vscode.window.showInformationMessage(`SFP XML Linter: Project revalidate done (${uris.length} files, ${durationMs} ms).`);
  }

  private async rebuildIndexAndValidateOpenDocs(options?: { verboseProgress?: boolean }): Promise<void> {
    const verbose = options?.verboseProgress === true;
    if (verbose) {
      this.deps.log("Initial indexing START");
    }

    await this.deps.templateIndexer.rebuildIndex({
      onProgress: verbose
        ? (event) => {
            this.deps.log(`[template] ${this.deps.formatIndexProgress(event)}`);
            this.reportReindexProgress("template", event);
          }
        : (event) => {
            this.reportReindexProgress("template", event);
          }
    });

    await this.deps.runtimeIndexer.rebuildIndex({
      onProgress: verbose
        ? (event) => {
            this.deps.log(`[runtime] ${this.deps.formatIndexProgress(event)}`);
            this.reportReindexProgress("runtime", event);
          }
        : (event) => {
            this.reportReindexProgress("runtime", event);
          }
    });

    if (verbose) {
      this.deps.log("Initial indexing DONE");
    }

    this.deps.rebuildFeatureRegistry();
    this.deps.setHasInitialIndex(true);
    const refreshed = this.deps.refreshComposedSnapshotsAll?.() ?? 0;
    this.deps.log(`REINDEX snapshot refresh docs=${refreshed}`);
    this.deps.validateOpenDocuments();

    if (!this.hasCompletedInitialWorkspaceValidation) {
      const uris = await this.deps.globConfiguredXmlFiles();
      this.deps.enqueueWorkspaceValidation(uris);
      this.hasCompletedInitialWorkspaceValidation = true;
      this.deps.log("Background workspace validation queued (first full index only).");
    }
  }

  private async rebuildBootstrapIndexAndValidateOpenDocs(options?: { verboseProgress?: boolean; includeRuntime?: boolean }): Promise<void> {
    const verbose = options?.verboseProgress === true;
    const includeRuntime = options?.includeRuntime !== false;
    if (verbose) {
      this.deps.log("Bootstrap indexing START (components + forms)");
    }

    await this.deps.templateIndexer.rebuildIndex({
      scope: "bootstrap",
      onProgress: verbose
        ? (event) => {
            this.deps.log(`[template] ${this.deps.formatIndexProgress(event)}`);
            this.reportReindexProgress("template", event);
          }
        : (event) => {
            this.reportReindexProgress("template", event);
          }
    });

    if (includeRuntime) {
      await this.deps.runtimeIndexer.rebuildIndex({
        scope: "bootstrap",
        onProgress: verbose
          ? (event) => {
              this.deps.log(`[runtime] ${this.deps.formatIndexProgress(event)}`);
              this.reportReindexProgress("runtime", event);
            }
          : (event) => {
              this.reportReindexProgress("runtime", event);
            }
      });
    } else if (verbose) {
      this.deps.log("Bootstrap indexing SKIP runtime (no runtime XML opened).");
    }

    if (verbose) {
      this.deps.log("Bootstrap indexing DONE (components + forms)");
    }

    this.deps.rebuildFeatureRegistry();
    this.deps.setHasInitialIndex(true);
    const refreshed = this.deps.refreshComposedSnapshotsAll?.() ?? 0;
    this.deps.log(`REINDEX snapshot refresh docs=${refreshed}`);
    this.deps.validateOpenDocuments();
  }

  private async validateUrisWithProgress(
    uris: readonly vscode.Uri[],
    title: string,
    validateOptions?: { respectProjectScope?: boolean; preferFsRead?: boolean }
  ): Promise<void> {
    const total = uris.length;
    let processed = 0;
    let reportedPercent = 0;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        for (const uri of uris) {
          await this.deps.validateUri(uri, validateOptions);
          processed++;
          if (processed % 25 === 0 || processed === total) {
            const nextPercent = total > 0 ? Math.floor((processed / total) * 100) : 100;
            progress.report({
              increment: Math.max(0, nextPercent - reportedPercent),
              message: `${processed}/${total}`
            });
            reportedPercent = nextPercent;
            await this.deps.sleep(1);
          }
        }
      }
    );
  }
}

function maxReindexScope(current: ReindexQueueScope, next: ReindexScope): ReindexScope {
  if (current === "all" || next === "all") {
    return "all";
  }
  return "bootstrap";
}
