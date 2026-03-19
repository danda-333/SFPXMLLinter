import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface PipelineUiCommandsServiceDeps {
  debugPrefix: string;
  buildOutput: vscode.OutputChannel;
  indexOutput: vscode.OutputChannel;
  compositionOutput: vscode.OutputChannel;
  logBuild: (message: string) => void;
  logIndex: (message: string) => void;
  logComposition: (message: string) => void;
  refreshCompositionView: () => void;
  getPipelineModuleStats: () => ReadonlyArray<{
    moduleId: string;
    runs: number;
    avgMs: number;
    maxMs: number;
    errors: number;
  }>;
  getPipelineOutcomeStats: () => {
    applied: number;
    partial: number;
    failed: number;
  };
  getPipelinePhaseStats: () => {
    collectChangesMs: { avgMs: number; p95Ms: number; maxMs: number };
    affectedSubgraphMs: { avgMs: number; p95Ms: number; maxMs: number };
    factsMs: { avgMs: number; p95Ms: number; maxMs: number };
    composeMs: { avgMs: number; p95Ms: number; maxMs: number };
    symbolsMs: { avgMs: number; p95Ms: number; maxMs: number };
    validationMs: { avgMs: number; p95Ms: number; maxMs: number };
    publishMs: { avgMs: number; p95Ms: number; maxMs: number };
  };
  getModelStats: () => {
    version: number;
    nodes: number;
    indexedUris: number;
  };
  getSymbolStats: () => {
    nodes: number;
    defs: number;
    refs: number;
    resolvers: number;
  };
  getFactStats: () => ReadonlyArray<{
    factKind: string;
    hits: number;
    misses: number;
  }>;
  getDeadFactKinds: () => readonly string[];
  getFactConsumerUsage: () => ReadonlyArray<{
    consumerId: string;
    factKinds: readonly string[];
  }>;
  getDisabledValidationModules?: () => readonly string[];
  getPipelineTrace: () => unknown;
}

export class PipelineUiCommandsService {
  public constructor(private readonly deps: PipelineUiCommandsServiceDeps) {}

  public showBuildQueueLog(): void {
    this.deps.buildOutput.show(true);
    this.deps.logBuild("Opened build queue log");
  }

  public showIndexLog(): void {
    this.deps.indexOutput.show(true);
    this.deps.logIndex("Opened index log");
  }

  public showCompositionLog(): void {
    this.deps.compositionOutput.show(true);
    this.deps.logComposition("Opened composition log");
  }

  public showPipelineStats(): void {
    const stats = this.deps.getPipelineModuleStats();
    const outcomes = this.deps.getPipelineOutcomeStats();
    const phases = this.deps.getPipelinePhaseStats();
    this.appendIndexLine(
      `[pipeline] outcomes: applied=${outcomes.applied}, partial=${outcomes.partial}, failed=${outcomes.failed}`
    );
    this.appendIndexLine("[pipeline] phase split (avg/p95/max):");
    this.appendIndexLine(
      `[pipeline]   collectChanges=${phases.collectChangesMs.avgMs.toFixed(1)}/${phases.collectChangesMs.p95Ms.toFixed(1)}/${phases.collectChangesMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   affectedSubgraph=${phases.affectedSubgraphMs.avgMs.toFixed(1)}/${phases.affectedSubgraphMs.p95Ms.toFixed(1)}/${phases.affectedSubgraphMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   facts=${phases.factsMs.avgMs.toFixed(1)}/${phases.factsMs.p95Ms.toFixed(1)}/${phases.factsMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   compose=${phases.composeMs.avgMs.toFixed(1)}/${phases.composeMs.p95Ms.toFixed(1)}/${phases.composeMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   symbols=${phases.symbolsMs.avgMs.toFixed(1)}/${phases.symbolsMs.p95Ms.toFixed(1)}/${phases.symbolsMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   validation=${phases.validationMs.avgMs.toFixed(1)}/${phases.validationMs.p95Ms.toFixed(1)}/${phases.validationMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(
      `[pipeline]   publish=${phases.publishMs.avgMs.toFixed(1)}/${phases.publishMs.p95Ms.toFixed(1)}/${phases.publishMs.maxMs.toFixed(1)} ms`
    );
    this.appendIndexLine(`[pipeline] module stats:`);
    for (const stat of stats) {
      this.appendIndexLine(
        `[pipeline]   ${stat.moduleId}: runs=${stat.runs}, avg=${stat.avgMs.toFixed(1)} ms, max=${stat.maxMs} ms, errors=${stat.errors}`
      );
    }
    const modelStats = this.deps.getModelStats();
    this.appendIndexLine(
      `[pipeline] model: version=${modelStats.version}, nodes=${modelStats.nodes}, indexedUris=${modelStats.indexedUris}`
    );
    const symbolStats = this.deps.getSymbolStats();
    this.appendIndexLine(
      `[pipeline] symbols: nodes=${symbolStats.nodes}, defs=${symbolStats.defs}, refs=${symbolStats.refs}, resolvers=${symbolStats.resolvers}`
    );
    const factStats = this.deps.getFactStats();
    this.appendIndexLine("[pipeline] facts:");
    for (const item of factStats.slice(0, 20)) {
      this.appendIndexLine(`[pipeline]   ${item.factKind}: hits=${item.hits}, misses=${item.misses}`);
    }
    const deadFacts = this.deps.getDeadFactKinds();
    if (deadFacts.length > 0) {
      this.appendIndexLine(`[pipeline] dead facts: ${deadFacts.join(", ")}`);
    }
    const consumerUsage = this.deps.getFactConsumerUsage();
    if (consumerUsage.length > 0) {
      this.appendIndexLine("[pipeline] fact consumers:");
      for (const item of consumerUsage.slice(0, 30)) {
        this.appendIndexLine(`[pipeline]   ${item.consumerId}: ${item.factKinds.join(", ")}`);
      }
    }
    const disabledValidationModules = this.deps.getDisabledValidationModules?.() ?? [];
    if (disabledValidationModules.length > 0) {
      this.appendIndexLine(`[pipeline] disabled validation modules: ${disabledValidationModules.join(", ")}`);
    }
    this.deps.indexOutput.show(true);
  }

  public async exportTrace(): Promise<void> {
    const trace = this.deps.getPipelineTrace();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showInformationMessage("SFP XML Linter: No workspace folder is open.");
      return;
    }

    const target = vscode.Uri.joinPath(workspaceFolder.uri, "Docs", "pipeline-trace.json");
    await fs.mkdir(path.dirname(target.fsPath), { recursive: true });
    await fs.writeFile(target.fsPath, JSON.stringify(trace, null, 2), "utf8");
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc, { preview: false });
    const records = Array.isArray(trace) ? trace.length : 0;
    vscode.window.showInformationMessage(`SFP XML Linter: Pipeline trace exported (${records} records).`);
  }

  public refreshCompositionView(): void {
    this.deps.refreshCompositionView();
    this.deps.logComposition("Composition view refreshed");
  }

  public async compositionCopySummary(payload?: { text?: string }): Promise<void> {
    const text = payload?.text?.trim();
    if (!text) {
      vscode.window.showInformationMessage("SFP XML Linter: No composition summary available for current selection.");
      return;
    }

    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage("SFP XML Linter: Composition summary copied to clipboard.");
  }

  public compositionLogNonEffectiveUsings(payload?: { title?: string; lines?: string[] }): void {
    const lines = payload?.lines ?? [];
    if (lines.length === 0) {
      vscode.window.showInformationMessage("SFP XML Linter: No non-effective usings for current document.");
      return;
    }

    this.deps.logComposition(payload?.title ? `${payload.title}:` : "Non-effective usings:");
    for (const line of lines) {
      this.deps.logComposition(`  ${line}`);
    }
    this.deps.compositionOutput.show(true);
  }

  private appendIndexLine(message: string): void {
    this.deps.indexOutput.appendLine(`[${new Date().toLocaleTimeString()}] ${this.deps.debugPrefix} ${message}`);
  }
}
