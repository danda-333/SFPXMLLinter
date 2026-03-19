import * as vscode from "vscode";

export type TemplateBuilderMode = "fast" | "debug" | "release";
export type TemplateBuildStatus = "update" | "nochange" | "error";

export interface TemplateBuildTelemetryCollector {
  entries: Map<string, unknown>;
  mutationsByTemplate: Map<string, unknown>;
  onTemplateEvaluated: (
    relativeTemplatePath: string,
    status: TemplateBuildStatus,
    templateText: string,
    debugLines: readonly string[]
  ) => void;
  onTemplateMutations: (
    relativeTemplatePath: string,
    outputRelativePath: string,
    outputFsPath: string,
    mutations: readonly any[]
  ) => void;
}

export interface TemplateBuildOrchestratorDeps {
  logBuild: (message: string) => void;
  logIndex: (message: string) => void;
  showError: (message: string) => void;
  toRelativePath: (pathOrUri: string | vscode.Uri) => string;
  getTemplateBuilderMode: () => TemplateBuilderMode;
  createBuildTelemetryCollector: () => TemplateBuildTelemetryCollector;
  createBuildRunOptions: (
    silent: boolean,
    mode: TemplateBuilderMode,
    onTemplateEvaluated: TemplateBuildTelemetryCollector["onTemplateEvaluated"],
    onTemplateMutations: TemplateBuildTelemetryCollector["onTemplateMutations"]
  ) => unknown;
  runBuildAll: (workspaceFolder: vscode.WorkspaceFolder, options: unknown) => Promise<unknown>;
  runBuildForPath: (workspaceFolder: vscode.WorkspaceFolder, targetPath: string, options: unknown) => Promise<unknown>;
  runBuildForPaths: (workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[], options: unknown) => Promise<unknown>;
  queueReindexAll: () => Promise<void>;
  refreshFormsFromTemplateTargets: (targetPaths: readonly string[]) => Promise<number>;
  refreshRuntimeIndexFromBuildOutputs: (mutationsByTemplate: ReadonlyMap<string, unknown>) => Promise<number>;
  applyBuildMutationTelemetry: (mutationsByTemplate: ReadonlyMap<string, unknown>) => void;
  logBuildCompositionSnapshot: (
    sourceLabel: string,
    evaluations: ReadonlyMap<string, unknown>,
    mode: TemplateBuilderMode
  ) => void;
  onAutoBuildPerformance?: (stats: TemplateBuildAutoPerformanceStats) => void;
}

export interface TemplateBuildAutoPerformanceStats {
  durationMs: number;
  executedFullBuild: boolean;
  builtTargetCount: number;
  summary: BuildSummaryLike;
  phases: {
    runBuildMs: number;
    postBuildReindexMs: number;
    postBuildFormRefreshMs: number;
    postBuildRuntimeRefreshMs: number;
    applyMutationTelemetryMs: number;
    compositionSnapshotMs: number;
  };
  refresh: {
    updatedTargetPathsCount: number;
    formRefreshedCount: number;
    runtimeRefreshedCount: number;
    runtimeRefreshDeferred: boolean;
  };
}

interface BuildSummaryLike {
  updated: number;
  skipped: number;
  errors: number;
}

export class TemplateBuildOrchestrator {
  private isTemplateBuildRunning = false;
  private queuedFullTemplateBuild = false;
  private readonly queuedTemplatePaths = new Set<string>();
  private readonly templateBuildIdleWaiters: Array<() => void> = [];

  public constructor(private readonly deps: TemplateBuildOrchestratorDeps) {}

  public waitForIdle(): Promise<void> {
    if (!this.isTemplateBuildRunning && !this.queuedFullTemplateBuild && this.queuedTemplatePaths.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.templateBuildIdleWaiters.push(resolve);
    });
  }

  public async queueBuild(workspaceFolder: vscode.WorkspaceFolder, targetPath?: string): Promise<void> {
    if (targetPath) {
      this.queuedTemplatePaths.add(targetPath);
      this.deps.logBuild(
        `QUEUE + target: ${this.deps.toRelativePath(targetPath)} (targets=${this.queuedTemplatePaths.size}, full=${this.queuedFullTemplateBuild})`
      );
    } else {
      this.queuedFullTemplateBuild = true;
      this.queuedTemplatePaths.clear();
      this.deps.logBuild("QUEUE + FULL build (target queue cleared)");
    }

    if (this.isTemplateBuildRunning) {
      this.deps.logBuild("Worker busy, request queued.");
      return;
    }

    await this.runWorker(workspaceFolder);
  }

  public async queueBuildBatch(workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[]): Promise<void> {
    if (targetPaths.length === 0) {
      return;
    }
    for (const targetPath of targetPaths) {
      this.queuedTemplatePaths.add(targetPath);
    }
    this.deps.logBuild(
      `QUEUE + target-batch: count=${targetPaths.length} (targets=${this.queuedTemplatePaths.size}, full=${this.queuedFullTemplateBuild})`
    );

    if (this.isTemplateBuildRunning) {
      this.deps.logBuild("Worker busy, batch request queued.");
      return;
    }

    await this.runWorker(workspaceFolder);
  }

  private async runWorker(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const workerStartedAt = Date.now();
    this.isTemplateBuildRunning = true;
    this.deps.logBuild("Worker START");
    const mode = this.deps.getTemplateBuilderMode();
    let executedBuild = false;
    let executedFullBuild = false;
    const aggregatedSummary: BuildSummaryLike = { updated: 0, skipped: 0, errors: 0 };
    const builtTargetPaths = new Set<string>();
    let runBuildMs = 0;
    let postBuildReindexMs = 0;
    let postBuildFormRefreshMs = 0;
    let postBuildRuntimeRefreshMs = 0;
    let applyMutationTelemetryMs = 0;
    let compositionSnapshotMs = 0;
    let updatedTargetPathsCount = 0;
    let formRefreshedCount = 0;
    let runtimeRefreshedCount = 0;
    let runtimeRefreshDeferred = false;
    const telemetry = this.deps.createBuildTelemetryCollector();
    try {
      do {
        if (this.queuedFullTemplateBuild) {
          this.queuedFullTemplateBuild = false;
          this.deps.logBuild("BUILD START full templates");
          const runStartedAt = Date.now();
          const result = await this.deps.runBuildAll(
            workspaceFolder,
            this.deps.createBuildRunOptions(true, mode, telemetry.onTemplateEvaluated, telemetry.onTemplateMutations)
          );
          runBuildMs += Date.now() - runStartedAt;
          mergeBuildSummary(aggregatedSummary, readBuildSummary(result));
          executedBuild = true;
          executedFullBuild = true;
          this.deps.logBuild("BUILD DONE full templates");
          continue;
        }

        if (this.queuedTemplatePaths.size === 0) {
          break;
        }

        const batchTargets = [...this.queuedTemplatePaths.values()].sort((a, b) => a.localeCompare(b));
        this.queuedTemplatePaths.clear();
        this.deps.logBuild(
          `BUILD START target-batch: count=${batchTargets.length}, first=${this.deps.toRelativePath(batchTargets[0])}`
        );
        const runStartedAt = Date.now();
        const result = await this.deps.runBuildForPaths(
          workspaceFolder,
          batchTargets,
          this.deps.createBuildRunOptions(true, mode, telemetry.onTemplateEvaluated, telemetry.onTemplateMutations)
        );
        runBuildMs += Date.now() - runStartedAt;
        mergeBuildSummary(aggregatedSummary, readBuildSummary(result));
        executedBuild = true;
        for (const target of batchTargets) {
          builtTargetPaths.add(target);
        }
        this.deps.logBuild(`BUILD DONE target-batch: count=${batchTargets.length}`);
      } while (this.queuedFullTemplateBuild || this.queuedTemplatePaths.size > 0);

      if (executedBuild) {
        const updatedTemplateKeys = collectUpdatedTemplateKeys(telemetry.entries);
        if (executedFullBuild) {
          this.deps.logIndex("POST-BUILD reindex scope=all");
          const reindexStartedAt = Date.now();
          await this.deps.queueReindexAll();
          postBuildReindexMs += Date.now() - reindexStartedAt;
        } else {
          if (aggregatedSummary.updated === 0) {
            this.deps.logIndex(
              `POST-BUILD incremental refresh skipped (no updated outputs; skipped=${aggregatedSummary.skipped}, errors=${aggregatedSummary.errors})`
            );
          } else {
            const updatedTargetPaths = [...builtTargetPaths].filter((targetPath) =>
              updatedTemplateKeys.has(toTemplateRelativeKey(this.deps.toRelativePath(targetPath)))
            );
            updatedTargetPathsCount = updatedTargetPaths.length;
            const refreshStartedAt = Date.now();
            formRefreshedCount = await this.deps.refreshFormsFromTemplateTargets(updatedTargetPaths);
            postBuildFormRefreshMs += Date.now() - refreshStartedAt;
            this.deps.logIndex(
              `POST-BUILD incremental form refresh count=${formRefreshedCount} targets=${updatedTargetPaths.length}/${builtTargetPaths.size} in ${Date.now() - refreshStartedAt} ms`
            );
            const runtimeRefreshStartedAt = Date.now();
            const updatedMutations = filterMutationTelemetryByTemplateKeys(telemetry.mutationsByTemplate, updatedTemplateKeys);
            runtimeRefreshDeferred = true;
            this.deps.logIndex(
              `POST-BUILD incremental runtime refresh deferred outputs=${updatedMutations.size}`
            );
            void this.deps
              .refreshRuntimeIndexFromBuildOutputs(updatedMutations)
              .then((count) => {
                const duration = Date.now() - runtimeRefreshStartedAt;
                if (count > 0) {
                  this.deps.logIndex(
                    `POST-BUILD incremental runtime refresh DONE count=${count} in ${duration} ms`
                  );
                } else {
                  this.deps.logIndex(
                    `POST-BUILD incremental runtime refresh DONE count=0 in ${duration} ms`
                  );
                }
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.deps.logIndex(`POST-BUILD incremental runtime refresh ERROR: ${message}`);
              });
          }
        }

        if (aggregatedSummary.updated > 0) {
          const applyStartedAt = Date.now();
          this.deps.applyBuildMutationTelemetry(
            filterMutationTelemetryByTemplateKeys(telemetry.mutationsByTemplate, collectUpdatedTemplateKeys(telemetry.entries))
          );
          applyMutationTelemetryMs += Date.now() - applyStartedAt;
        }
        // Auto-save path: skip composition snapshot logging to keep save critical path short.
        this.deps.onAutoBuildPerformance?.({
          durationMs: Date.now() - workerStartedAt,
          executedFullBuild,
          builtTargetCount: builtTargetPaths.size,
          summary: { ...aggregatedSummary },
          phases: {
            runBuildMs,
            postBuildReindexMs,
            postBuildFormRefreshMs,
            postBuildRuntimeRefreshMs,
            applyMutationTelemetryMs,
            compositionSnapshotMs
          },
          refresh: {
            updatedTargetPathsCount,
            formRefreshedCount,
            runtimeRefreshedCount,
            runtimeRefreshDeferred
          }
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.showError(`Auto BuildXmlTemplates failed: ${message}`);
      this.deps.logBuild(`BUILD ERROR: ${message}`);
    } finally {
      this.isTemplateBuildRunning = false;
      this.deps.logBuild("Worker IDLE");
      this.resolveIdleWaiters();
    }
  }

  private resolveIdleWaiters(): void {
    while (this.templateBuildIdleWaiters.length > 0) {
      const resolve = this.templateBuildIdleWaiters.shift();
      resolve?.();
    }
  }
}

function readBuildSummary(result: unknown): BuildSummaryLike | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const summaryUnknown = (result as { summary?: unknown }).summary;
  if (!summaryUnknown || typeof summaryUnknown !== "object") {
    return undefined;
  }
  const summary = summaryUnknown as { updated?: unknown; skipped?: unknown; errors?: unknown };
  const updated = Number(summary.updated ?? 0);
  const skipped = Number(summary.skipped ?? 0);
  const errors = Number(summary.errors ?? 0);
  if (!Number.isFinite(updated) || !Number.isFinite(skipped) || !Number.isFinite(errors)) {
    return undefined;
  }
  return {
    updated: Math.max(0, Math.trunc(updated)),
    skipped: Math.max(0, Math.trunc(skipped)),
    errors: Math.max(0, Math.trunc(errors))
  };
}

function mergeBuildSummary(target: BuildSummaryLike, value: BuildSummaryLike | undefined): void {
  if (!value) {
    return;
  }
  target.updated += value.updated;
  target.skipped += value.skipped;
  target.errors += value.errors;
}

function collectUpdatedTemplateKeys(entries: ReadonlyMap<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const [templateKey, value] of entries.entries()) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const status = String((value as { status?: unknown }).status ?? "").toLowerCase();
    if (status === "update") {
      out.add(toTemplateRelativeKey(templateKey));
    }
  }
  return out;
}

function filterMutationTelemetryByTemplateKeys(
  mutationsByTemplate: ReadonlyMap<string, unknown>,
  allowedTemplateKeys: ReadonlySet<string>
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [templateKey, mutation] of mutationsByTemplate.entries()) {
    if (allowedTemplateKeys.has(toTemplateRelativeKey(templateKey))) {
      out.set(templateKey, mutation);
    }
  }
  return out;
}

function toTemplateRelativeKey(value: string): string {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  const marker = "/xml_templates/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  if (normalized.startsWith("xml_templates/")) {
    return normalized.slice("xml_templates/".length);
  }
  return normalized;
}
