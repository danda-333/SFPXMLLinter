import * as vscode from "vscode";
import { SfpXmlLinterSettings } from "../../config/settings";
import { SystemMetadata } from "../../config/systemMetadata";
import { IndexedValidationOutcome } from "./documentValidationService";

export interface ValidationQueueOrchestratorDeps {
  log: (message: string) => void;
  publishDiagnosticsBatch: (updates: ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]>) => void;
  computeIndexedValidationOutcome: (
    uri: vscode.Uri,
    options?: {
      respectProjectScope?: boolean;
      preferFsRead?: boolean;
      settingsSnapshot?: SfpXmlLinterSettings;
      metadataSnapshot?: SystemMetadata;
    }
  ) => Promise<IndexedValidationOutcome | undefined>;
  shouldValidateUriForActiveProjects: (uri: vscode.Uri) => boolean;
  getBackgroundSettingsSnapshot: () => SfpXmlLinterSettings;
  getBackgroundMetadataSnapshot: () => SystemMetadata;
  getIndexedValidationLogSignature: (uriKey: string) => string | undefined;
  setIndexedValidationLogSignature: (uriKey: string, signature: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export class ValidationQueueOrchestrator implements vscode.Disposable {
  private readonly highPriorityValidationQueue: string[] = [];
  private readonly highPriorityValidationSet = new Set<string>();
  private readonly lowPriorityValidationQueue: string[] = [];
  private readonly lowPriorityValidationSet = new Set<string>();
  private readonly validationGenerationByKey = new Map<string, number>();
  private isValidationWorkerRunning = false;
  private lowPriorityValidationStartTimer: NodeJS.Timeout | undefined;

  public constructor(private readonly deps: ValidationQueueOrchestratorDeps) {}

  public dispose(): void {
    if (this.lowPriorityValidationStartTimer) {
      clearTimeout(this.lowPriorityValidationStartTimer);
      this.lowPriorityValidationStartTimer = undefined;
    }
  }

  public enqueueValidation(uri: vscode.Uri, priority: "high" | "low", options?: { force?: boolean }): void {
    if (uri.scheme !== "file") {
      return;
    }

    const key = uri.toString();
    const hasQueuedHigh = this.highPriorityValidationSet.has(key);
    if (options?.force === true) {
      // Never allow low-priority force enqueue to cancel an already queued high-priority validation.
      // This preserves save-driven deterministic ordering (high first) and avoids stale diagnostics windows.
      if (!(priority === "low" && hasQueuedHigh)) {
        const nextGeneration = (this.validationGenerationByKey.get(key) ?? 0) + 1;
        this.validationGenerationByKey.set(key, nextGeneration);
        this.removeQueuedValidationByKey(key);
      }
    } else if (!this.validationGenerationByKey.has(key)) {
      this.validationGenerationByKey.set(key, 0);
    }
    if (priority === "high") {
      const nextGeneration = (this.validationGenerationByKey.get(key) ?? 0) + 1;
      this.validationGenerationByKey.set(key, nextGeneration);
      if (this.highPriorityValidationSet.has(key)) {
        return;
      }

      this.highPriorityValidationSet.add(key);
      this.highPriorityValidationQueue.push(key);
      if (this.lowPriorityValidationStartTimer) {
        clearTimeout(this.lowPriorityValidationStartTimer);
        this.lowPriorityValidationStartTimer = undefined;
      }
      void this.runValidationWorker();
      return;
    }

    if (this.highPriorityValidationSet.has(key) || this.lowPriorityValidationSet.has(key)) {
      return;
    }

    this.lowPriorityValidationSet.add(key);
    this.lowPriorityValidationQueue.push(key);
    this.scheduleLowPriorityValidationWorker();
  }

  public enqueueWorkspaceValidation(uris: readonly vscode.Uri[]): void {
    this.lowPriorityValidationQueue.length = 0;
    this.lowPriorityValidationSet.clear();

    const filtered = uris.filter((uri) => this.deps.shouldValidateUriForActiveProjects(uri));
    for (const uri of filtered) {
      this.enqueueValidation(uri, "low");
    }
  }

  private removeQueuedValidationByKey(key: string): void {
    this.highPriorityValidationSet.delete(key);
    this.lowPriorityValidationSet.delete(key);
    const highIndex = this.highPriorityValidationQueue.indexOf(key);
    if (highIndex >= 0) {
      this.highPriorityValidationQueue.splice(highIndex, 1);
    }
    const lowIndex = this.lowPriorityValidationQueue.indexOf(key);
    if (lowIndex >= 0) {
      this.lowPriorityValidationQueue.splice(lowIndex, 1);
    }
  }

  private scheduleLowPriorityValidationWorker(delayMs = 350): void {
    if (this.isValidationWorkerRunning || this.lowPriorityValidationStartTimer) {
      return;
    }

    this.lowPriorityValidationStartTimer = setTimeout(() => {
      this.lowPriorityValidationStartTimer = undefined;
      void this.runValidationWorker();
    }, delayMs);
  }

  private async runValidationWorker(): Promise<void> {
    if (this.isValidationWorkerRunning) {
      return;
    }

    const LOW_PRIORITY_CONCURRENCY = 8;
    const backgroundSettingsSnapshot = this.deps.getBackgroundSettingsSnapshot();
    const backgroundMetadataSnapshot = this.deps.getBackgroundMetadataSnapshot();
    this.isValidationWorkerRunning = true;
    try {
      let processed = 0;
      let processedLow = 0;
      let totalLowAtStart = this.lowPriorityValidationQueue.length;
      let lowComputeMs = 0;
      let lowPublishMs = 0;
      let lowFastPathCount = 0;
      let lowFsReadPathCount = 0;
      let lowOpenDocPathCount = 0;
      let lowCacheMissCount = 0;
      const lowSlowest: Array<{ relOrPath: string; totalMs: number; readMs: number; diagnosticsMs: number }> = [];

      while (this.highPriorityValidationQueue.length > 0 || this.lowPriorityValidationQueue.length > 0) {
        if (this.highPriorityValidationQueue.length > 0) {
          const key = this.highPriorityValidationQueue.shift();
          if (!key) {
            continue;
          }
          this.highPriorityValidationSet.delete(key);
          const uri = vscode.Uri.parse(key);
          const generation = this.validationGenerationByKey.get(key) ?? 0;
          const outcome = await this.deps.computeIndexedValidationOutcome(uri, {
            preferFsRead: true,
            settingsSnapshot: backgroundSettingsSnapshot,
            metadataSnapshot: backgroundMetadataSnapshot
          });
          if (generation !== (this.validationGenerationByKey.get(key) ?? 0)) {
            continue;
          }
          if (outcome) {
            this.deps.publishDiagnosticsBatch([[outcome.uri, outcome.diagnostics]]);
            if (outcome.shouldLog) {
              const outcomeKey = outcome.uri.toString();
              if (this.deps.getIndexedValidationLogSignature(outcomeKey) !== outcome.signature) {
                this.deps.setIndexedValidationLogSignature(outcomeKey, outcome.signature);
                this.deps.log(`validate indexed DONE: ${outcome.relOrPath} diagnostics=${outcome.diagnostics.length}`);
              }
            }
          }
          processed++;
          continue;
        }

        if (processedLow === 0) {
          totalLowAtStart = this.lowPriorityValidationQueue.length;
          if (totalLowAtStart > 0) {
            this.deps.log(`Background validation START files=${totalLowAtStart}`);
          }
        }

        const batch = this.lowPriorityValidationQueue.splice(0, LOW_PRIORITY_CONCURRENCY);
        if (batch.length === 0) {
          continue;
        }
        for (const key of batch) {
          this.lowPriorityValidationSet.delete(key);
        }

        const computeStartedAt = Date.now();
        const outcomes = await Promise.all(
          batch.map(async (key): Promise<{ key: string; generation: number; outcome: IndexedValidationOutcome | undefined }> => {
            const uri = vscode.Uri.parse(key);
            const generation = this.validationGenerationByKey.get(key) ?? 0;
            const outcome = await this.deps.computeIndexedValidationOutcome(uri, {
              preferFsRead: true,
              settingsSnapshot: backgroundSettingsSnapshot,
              metadataSnapshot: backgroundMetadataSnapshot
            });
            return { key, generation, outcome };
          })
        );
        lowComputeMs += Date.now() - computeStartedAt;

        const publishStartedAt = Date.now();
        const updates: Array<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]> = [];
        for (const item of outcomes) {
          const currentGeneration = this.validationGenerationByKey.get(item.key) ?? 0;
          if (currentGeneration !== item.generation) {
            continue;
          }

          const outcome = item.outcome;
          if (!outcome) {
            continue;
          }

          if (outcome.pathMode === "fast") {
            lowFastPathCount++;
          } else if (outcome.pathMode === "fs") {
            lowFsReadPathCount++;
          } else if (outcome.pathMode === "open") {
            lowOpenDocPathCount++;
          }
          if (outcome.cacheMiss) {
            lowCacheMissCount++;
          }

          if (outcome.totalMs >= 10) {
            lowSlowest.push({
              relOrPath: outcome.relOrPath,
              totalMs: outcome.totalMs,
              readMs: outcome.readMs,
              diagnosticsMs: outcome.diagnosticsMs
            });
          }

          updates.push([outcome.uri, outcome.diagnostics]);
          if (outcome.shouldLog) {
            const key = outcome.uri.toString();
            if (this.deps.getIndexedValidationLogSignature(key) !== outcome.signature) {
              this.deps.setIndexedValidationLogSignature(key, outcome.signature);
              this.deps.log(`validate indexed DONE: ${outcome.relOrPath} diagnostics=${outcome.diagnostics.length}`);
            }
          }
        }
        if (updates.length > 0) {
          this.deps.publishDiagnosticsBatch(updates);
        }
        lowPublishMs += Date.now() - publishStartedAt;

        processed += batch.length;
        processedLow += batch.length;
        if (processedLow % 100 === 0 || processedLow === totalLowAtStart) {
          this.deps.log(`Background validation progress ${processedLow}/${totalLowAtStart}`);
        }
        if (processed % 200 === 0) {
          await this.deps.sleep(1);
        }
      }

      if (processedLow > 0) {
        this.deps.log(
          `Background validation DONE files=${processedLow} (compute=${lowComputeMs} ms, publish=${lowPublishMs} ms)`
        );
        this.deps.log(
          `Background validation path stats: fast=${lowFastPathCount}, fs=${lowFsReadPathCount}, open=${lowOpenDocPathCount}, cacheMiss=${lowCacheMissCount}`
        );
        if (lowSlowest.length > 0) {
          lowSlowest.sort((a, b) => b.totalMs - a.totalMs);
          const top = lowSlowest.slice(0, 10);
          this.deps.log("Background validation slowest files (top 10):");
          for (const item of top) {
            this.deps.log(
              `  ${item.totalMs} ms (read=${item.readMs} ms, diagnostics=${item.diagnosticsMs} ms) ${item.relOrPath}`
            );
          }
        }
      }
    } finally {
      this.isValidationWorkerRunning = false;
    }
  }
}
