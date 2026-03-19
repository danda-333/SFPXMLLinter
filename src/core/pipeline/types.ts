import * as vscode from "vscode";

export type UpdateEventType =
  | "open-document"
  | "active-editor-changed"
  | "close-document"
  | "text-changed"
  | "visible-editors-changed"
  | "tabs-changed"
  | "save-document"
  | "files-created"
  | "files-deleted"
  | "files-renamed"
  | "configuration-changed";

export type UpdateEventPayload =
  | { type: "open-document"; document: vscode.TextDocument }
  | { type: "active-editor-changed"; editor: vscode.TextEditor | undefined }
  | { type: "close-document"; document: vscode.TextDocument }
  | { type: "text-changed"; event: vscode.TextDocumentChangeEvent }
  | { type: "visible-editors-changed" }
  | { type: "tabs-changed" }
  | { type: "save-document"; document: vscode.TextDocument }
  | { type: "files-created"; files: readonly vscode.Uri[] }
  | { type: "files-deleted"; files: readonly vscode.Uri[] }
  | { type: "files-renamed"; files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[] }
  | { type: "configuration-changed"; event: vscode.ConfigurationChangeEvent };

export type UpdatePriority = "high" | "normal" | "low";

export interface QueuedUpdateEvent {
  id: string;
  type: UpdateEventType;
  priority: UpdatePriority;
  key: string;
  queuedAt: number;
  payload: UpdateEventPayload;
}

export interface ModuleRunResult {
  changedNodes?: number;
  diagnosticsProduced?: number;
  phaseMs?: Partial<PipelinePhaseBreakdown>;
}

export interface PipelineModule {
  readonly id: string;
  readonly phase?: keyof PipelinePhaseBreakdown;
  onUpdate(event: QueuedUpdateEvent, token: { isCancelled: () => boolean }): Promise<ModuleRunResult | void>;
}

export interface ModuleExecutionTiming {
  moduleId: string;
  phase?: keyof PipelinePhaseBreakdown;
  durationMs: number;
  result: "ok" | "cancelled" | "error";
  errorMessage?: string;
  changedNodes?: number;
  diagnosticsProduced?: number;
  phaseMs?: Partial<PipelinePhaseBreakdown>;
}

export interface PipelinePhaseBreakdown {
  collectChangesMs: number;
  affectedSubgraphMs: number;
  factsMs: number;
  composeMs: number;
  symbolsMs: number;
  validationMs: number;
  publishMs: number;
}

export type UpdateOutcome = "applied" | "partial" | "failed";

export interface UpdateRunReport {
  event: QueuedUpdateEvent;
  queueWaitMs: number;
  totalDurationMs: number;
  moduleTimings: ModuleExecutionTiming[];
  phaseMs: PipelinePhaseBreakdown;
  outcome: UpdateOutcome;
  errorCount: number;
  cancelledCount: number;
}

export interface PipelineTraceRecord {
  ts: string;
  runId: string;
  version: number;
  eventType: UpdateEventType;
  key: string;
  queueWaitMs: number;
  totalDurationMs: number;
  phaseMs: PipelinePhaseBreakdown;
  outcome: UpdateOutcome;
  errorCount: number;
  cancelledCount: number;
  moduleTimings: ModuleExecutionTiming[];
}
