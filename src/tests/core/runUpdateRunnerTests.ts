import { ModuleHost } from "../../core/pipeline/moduleHost";
import { PipelineMetricsStore } from "../../core/pipeline/metrics";
import { UpdateRunner } from "../../core/pipeline/updateRunner";
import { PipelineModule, QueuedUpdateEvent } from "../../core/pipeline/types";

class RecordingModule implements PipelineModule {
  public readonly id = "recording";
  public readonly events: string[] = [];

  public async onUpdate(event: QueuedUpdateEvent): Promise<void> {
    this.events.push(`${event.type}:${event.key}`);
  }
}

class DelayModule implements PipelineModule {
  public readonly id = "delay";
  public constructor(private readonly delayMs: number) {}

  public async onUpdate(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}

async function run(): Promise<void> {
  await testCoalescingKeepsLatestByKey();
  await testHighPriorityWins();
  await testMetricsRecorded();
  console.log("\x1b[32mUpdateRunner core tests passed.\x1b[0m");
}

async function testCoalescingKeepsLatestByKey(): Promise<void> {
  const host = new ModuleHost();
  const metrics = new PipelineMetricsStore();
  const module = new RecordingModule();
  host.register(module);
  const runner = new UpdateRunner(host, metrics, () => {
    // no-op
  });

  runner.enqueue(
    { type: "text-changed", event: { document: { uri: { toString: () => "file://a.xml" } } } as never },
    "high",
    "change:file://a.xml"
  );
  runner.enqueue(
    { type: "text-changed", event: { document: { uri: { toString: () => "file://a.xml" } } } as never },
    "high",
    "change:file://a.xml"
  );

  await sleep(40);
  const count = module.events.filter((item) => item === "text-changed:change:file://a.xml").length;
  if (count !== 1) {
    throw new Error(`Expected coalesced count=1, got ${count}`);
  }
}

async function testHighPriorityWins(): Promise<void> {
  const host = new ModuleHost();
  const metrics = new PipelineMetricsStore();
  const recorder = new RecordingModule();
  host.register(new DelayModule(15));
  host.register(recorder);
  const runner = new UpdateRunner(host, metrics, () => {
    // no-op
  });

  runner.enqueue(
    { type: "visible-editors-changed" },
    "low",
    "visible-editors"
  );
  runner.enqueue(
    { type: "save-document", document: { uri: { toString: () => "file://b.xml" } } as never },
    "high",
    "save:file://b.xml"
  );

  await sleep(80);
  if (recorder.events.length < 2) {
    throw new Error(`Expected at least 2 events, got ${recorder.events.length}`);
  }
  const first = recorder.events[0];
  if (!first.startsWith("save-document:save:file://b.xml")) {
    throw new Error(`Expected high-priority save first, got '${first}'`);
  }
}

async function testMetricsRecorded(): Promise<void> {
  const host = new ModuleHost();
  const metrics = new PipelineMetricsStore();
  host.register(new RecordingModule());
  const runner = new UpdateRunner(host, metrics, () => {
    // no-op
  });

  runner.enqueue(
    { type: "tabs-changed" },
    "normal",
    "tabs"
  );
  await sleep(30);
  const trace = metrics.getTrace();
  if (trace.length === 0) {
    throw new Error("Expected non-empty trace.");
  }
  if (!trace[trace.length - 1].runId.startsWith("run-")) {
    throw new Error(`Unexpected runId: ${trace[trace.length - 1].runId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void run();
