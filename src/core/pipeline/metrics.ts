import {
  ModuleExecutionTiming,
  PipelinePhaseBreakdown,
  PipelineTraceRecord,
  QueuedUpdateEvent,
  UpdateOutcome
} from "./types";

type ModuleAggregate = {
  runs: number;
  totalMs: number;
  maxMs: number;
  errors: number;
};

type OutcomeAggregate = {
  applied: number;
  partial: number;
  failed: number;
};

type PhaseAggregate = {
  totalMs: number;
  maxMs: number;
  runs: number;
};

type PhaseStats = {
  avgMs: number;
  p95Ms: number;
  maxMs: number;
};

export class PipelineMetricsStore {
  private readonly moduleAggregates = new Map<string, ModuleAggregate>();
  private readonly trace: PipelineTraceRecord[] = [];
  private readonly outcomes: OutcomeAggregate = { applied: 0, partial: 0, failed: 0 };
  private readonly phaseAggregates = createPhaseAggregateRecord();
  private readonly phaseSamples = createPhaseSamplesRecord();
  private version = 0;

  public constructor(private readonly maxTraceRecords = 500) {}

  public record(
    event: QueuedUpdateEvent,
    queueWaitMs: number,
    totalDurationMs: number,
    moduleTimings: ModuleExecutionTiming[],
    outcome: UpdateOutcome,
    errorCount: number,
    cancelledCount: number,
    phaseMs: PipelinePhaseBreakdown
  ): void {
    this.version++;
    const runId = `run-${String(this.version).padStart(5, "0")}`;
    this.outcomes[outcome]++;
    for (const timing of moduleTimings) {
      const aggregate = this.moduleAggregates.get(timing.moduleId) ?? {
        runs: 0,
        totalMs: 0,
        maxMs: 0,
        errors: 0
      };
      aggregate.runs++;
      aggregate.totalMs += timing.durationMs;
      aggregate.maxMs = Math.max(aggregate.maxMs, timing.durationMs);
      if (timing.result === "error") {
        aggregate.errors++;
      }
      this.moduleAggregates.set(timing.moduleId, aggregate);
    }

    this.trace.push({
      ts: new Date().toISOString(),
      runId,
      version: this.version,
      eventType: event.type,
      key: event.key,
      queueWaitMs,
      totalDurationMs,
      phaseMs,
      outcome,
      errorCount,
      cancelledCount,
      moduleTimings
    });
    for (const key of pipelinePhaseKeys) {
      const value = phaseMs[key];
      const aggregate = this.phaseAggregates[key];
      aggregate.totalMs += value;
      aggregate.maxMs = Math.max(aggregate.maxMs, value);
      aggregate.runs++;

      const samples = this.phaseSamples[key];
      samples.push(value);
      if (samples.length > this.maxTraceRecords) {
        samples.splice(0, samples.length - this.maxTraceRecords);
      }
    }
    if (this.trace.length > this.maxTraceRecords) {
      this.trace.splice(0, this.trace.length - this.maxTraceRecords);
    }
  }

  public getTrace(): readonly PipelineTraceRecord[] {
    return this.trace;
  }

  public getModuleStats(): Array<{ moduleId: string; runs: number; avgMs: number; maxMs: number; errors: number }> {
    return [...this.moduleAggregates.entries()]
      .map(([moduleId, aggregate]) => ({
        moduleId,
        runs: aggregate.runs,
        avgMs: aggregate.runs > 0 ? aggregate.totalMs / aggregate.runs : 0,
        maxMs: aggregate.maxMs,
        errors: aggregate.errors
      }))
      .sort((a, b) => b.avgMs - a.avgMs);
  }

  public getOutcomeStats(): OutcomeAggregate {
    return { ...this.outcomes };
  }

  public getPhaseStats(): Record<keyof PipelinePhaseBreakdown, PhaseStats> {
    return {
      collectChangesMs: this.createPhaseStats("collectChangesMs"),
      affectedSubgraphMs: this.createPhaseStats("affectedSubgraphMs"),
      factsMs: this.createPhaseStats("factsMs"),
      composeMs: this.createPhaseStats("composeMs"),
      symbolsMs: this.createPhaseStats("symbolsMs"),
      validationMs: this.createPhaseStats("validationMs"),
      publishMs: this.createPhaseStats("publishMs")
    };
  }

  private createPhaseStats(key: keyof PipelinePhaseBreakdown): PhaseStats {
    const aggregate = this.phaseAggregates[key];
    const samples = this.phaseSamples[key];
    return {
      avgMs: aggregate.runs > 0 ? aggregate.totalMs / aggregate.runs : 0,
      p95Ms: percentile(samples, 95),
      maxMs: aggregate.maxMs
    };
  }
}

const pipelinePhaseKeys: Array<keyof PipelinePhaseBreakdown> = [
  "collectChangesMs",
  "affectedSubgraphMs",
  "factsMs",
  "composeMs",
  "symbolsMs",
  "validationMs",
  "publishMs"
];

function createPhaseAggregateRecord(): Record<keyof PipelinePhaseBreakdown, PhaseAggregate> {
  return {
    collectChangesMs: { totalMs: 0, maxMs: 0, runs: 0 },
    affectedSubgraphMs: { totalMs: 0, maxMs: 0, runs: 0 },
    factsMs: { totalMs: 0, maxMs: 0, runs: 0 },
    composeMs: { totalMs: 0, maxMs: 0, runs: 0 },
    symbolsMs: { totalMs: 0, maxMs: 0, runs: 0 },
    validationMs: { totalMs: 0, maxMs: 0, runs: 0 },
    publishMs: { totalMs: 0, maxMs: 0, runs: 0 }
  };
}

function createPhaseSamplesRecord(): Record<keyof PipelinePhaseBreakdown, number[]> {
  return {
    collectChangesMs: [],
    affectedSubgraphMs: [],
    factsMs: [],
    composeMs: [],
    symbolsMs: [],
    validationMs: [],
    publishMs: []
  };
}

function percentile(samples: readonly number[], pct: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[index];
}
