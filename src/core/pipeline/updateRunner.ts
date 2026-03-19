import { ModuleHost } from "./moduleHost";
import { PipelineMetricsStore } from "./metrics";
import {
  PipelinePhaseBreakdown,
  QueuedUpdateEvent,
  UpdateEventPayload,
  UpdateOutcome,
  UpdatePriority,
  UpdateRunReport
} from "./types";

type PendingEvent = {
  event: QueuedUpdateEvent;
  sequence: number;
};

export class UpdateRunner {
  private readonly pendingByKey = new Map<string, PendingEvent>();
  private sequence = 0;
  private running = false;
  private drainScheduled = false;
  private cancelVersion = 0;
  private lastRunReport: UpdateRunReport | undefined;

  public constructor(
    private readonly host: ModuleHost,
    private readonly metrics: PipelineMetricsStore,
    private readonly log: (line: string) => void
  ) {}

  public enqueue(payload: UpdateEventPayload, priority: UpdatePriority, key: string): void {
    const id = `evt-${Date.now()}-${++this.sequence}`;
    const event: QueuedUpdateEvent = {
      id,
      type: payload.type,
      payload,
      priority,
      key,
      queuedAt: Date.now()
    };
    this.pendingByKey.set(key, {
      event,
      sequence: this.sequence
    });
    if (priority === "high") {
      this.cancelVersion++;
    }
    this.requestDrain();
  }

  private requestDrain(): void {
    if (this.running || this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (this.pendingByKey.size > 0) {
        const next = this.pickNext();
        if (!next) {
          break;
        }

        this.pendingByKey.delete(next.event.key);
        const runCancelVersion = this.cancelVersion;
        const startedAt = Date.now();
        const token = {
          isCancelled: () => runCancelVersion !== this.cancelVersion
        };

        const moduleTimings = await this.host.execute(next.event, token);
        const totalDurationMs = Date.now() - startedAt;
        const queueWaitMs = startedAt - next.event.queuedAt;
        const errorCount = moduleTimings.filter((timing) => timing.result === "error").length;
        const cancelledCount = moduleTimings.filter((timing) => timing.result === "cancelled").length;
        const okCount = moduleTimings.filter((timing) => timing.result === "ok").length;
        const outcome = deriveOutcome(okCount, errorCount, cancelledCount);
        const phaseMs = derivePhaseBreakdown(moduleTimings);
        this.metrics.record(next.event, queueWaitMs, totalDurationMs, moduleTimings, outcome, errorCount, cancelledCount, phaseMs);
        this.lastRunReport = {
          event: next.event,
          queueWaitMs,
          totalDurationMs,
          moduleTimings,
          phaseMs,
          outcome,
          errorCount,
          cancelledCount
        };
        this.log(
          `[runner] ${next.event.type} key=${next.event.key} outcome=${outcome} wait=${queueWaitMs}ms total=${totalDurationMs}ms modules=${moduleTimings.length} errors=${errorCount} cancelled=${cancelledCount}`
        );
      }
    } finally {
      this.running = false;
    }
  }

  public getLastRunReport(): UpdateRunReport | undefined {
    return this.lastRunReport;
  }

  private pickNext(): PendingEvent | undefined {
    if (this.pendingByKey.size === 0) {
      return undefined;
    }

    let selected: PendingEvent | undefined;
    for (const pending of this.pendingByKey.values()) {
      if (!selected) {
        selected = pending;
        continue;
      }

      const priorityCmp = comparePriority(pending.event.priority, selected.event.priority);
      if (priorityCmp < 0) {
        selected = pending;
        continue;
      }
      if (priorityCmp === 0 && pending.sequence < selected.sequence) {
        selected = pending;
      }
    }

    return selected;
  }
}

function deriveOutcome(okCount: number, errorCount: number, cancelledCount: number): UpdateOutcome {
  if (errorCount > 0) {
    return okCount > 0 ? "partial" : "failed";
  }
  if (cancelledCount > 0) {
    return "partial";
  }
  return "applied";
}

function derivePhaseBreakdown(
  moduleTimings: ReadonlyArray<{ moduleId: string; phase?: keyof PipelinePhaseBreakdown; durationMs: number; phaseMs?: Partial<PipelinePhaseBreakdown> }>
): PipelinePhaseBreakdown {
  const out: PipelinePhaseBreakdown = {
    collectChangesMs: 0,
    affectedSubgraphMs: 0,
    factsMs: 0,
    composeMs: 0,
    symbolsMs: 0,
    validationMs: 0,
    publishMs: 0
  };

  for (const timing of moduleTimings) {
    if (timing.phaseMs) {
      out.collectChangesMs += timing.phaseMs.collectChangesMs ?? 0;
      out.affectedSubgraphMs += timing.phaseMs.affectedSubgraphMs ?? 0;
      out.factsMs += timing.phaseMs.factsMs ?? 0;
      out.composeMs += timing.phaseMs.composeMs ?? 0;
      out.symbolsMs += timing.phaseMs.symbolsMs ?? 0;
      out.validationMs += timing.phaseMs.validationMs ?? 0;
      out.publishMs += timing.phaseMs.publishMs ?? 0;
      continue;
    }
    if (timing.phase) {
      out[timing.phase] += timing.durationMs;
      continue;
    }

    const id = timing.moduleId;
    if (id.endsWith("-events")) {
      out.collectChangesMs += timing.durationMs;
      continue;
    }
    if (id === "model-sync") {
      out.affectedSubgraphMs += timing.durationMs;
      continue;
    }
    if (id.includes("validation")) {
      out.validationMs += timing.durationMs;
      continue;
    }
    if (id.includes("compose") || id.includes("template")) {
      out.composeMs += timing.durationMs;
      continue;
    }
    if (id.includes("symbol")) {
      out.symbolsMs += timing.durationMs;
      continue;
    }
  }

  return out;
}

function comparePriority(a: UpdatePriority, b: UpdatePriority): number {
  const order: Record<UpdatePriority, number> = {
    high: 0,
    normal: 1,
    low: 2
  };
  return order[a] - order[b];
}
