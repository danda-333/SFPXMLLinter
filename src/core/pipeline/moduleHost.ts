import { ModuleExecutionTiming, PipelineModule, QueuedUpdateEvent } from "./types";

export class ModuleHost {
  private readonly modules: PipelineModule[] = [];

  public register(module: PipelineModule): void {
    this.modules.push(module);
  }

  public async execute(
    event: QueuedUpdateEvent,
    token: { isCancelled: () => boolean }
  ): Promise<ModuleExecutionTiming[]> {
    const timings: ModuleExecutionTiming[] = [];
    for (const module of this.modules) {
      if (token.isCancelled()) {
        timings.push({
          moduleId: module.id,
          phase: module.phase,
          durationMs: 0,
          result: "cancelled"
        });
        continue;
      }

      const startedAt = Date.now();
      try {
        const result = await module.onUpdate(event, token);
        timings.push({
          moduleId: module.id,
          phase: module.phase,
          durationMs: Date.now() - startedAt,
          result: "ok",
          changedNodes: result?.changedNodes,
          diagnosticsProduced: result?.diagnosticsProduced,
          phaseMs: result?.phaseMs
        });
      } catch (error) {
        timings.push({
          moduleId: module.id,
          phase: module.phase,
          durationMs: Date.now() - startedAt,
          result: "error",
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return timings;
  }
}
