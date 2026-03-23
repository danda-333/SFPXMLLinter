import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { WorkspaceIndexer, RebuildIndexProgressEvent } from "./indexer/workspaceIndexer";
import { DiagnosticsEngine } from "./diagnostics/engine";
import { documentInConfiguredRoots, getXmlIndexDomainByUri, XmlIndexDomain } from "./utils/paths";
import { invalidateSystemMetadataCache } from "./config/systemMetadata";
import { DocumentationHoverResolver } from "./providers/hoverRegistry";
import {
  BuildRunPerformanceStats,
  BuildXmlTemplatesService,
  TemplateInheritedUsingEntry
} from "./template/buildXmlTemplatesService";
import { TemplateMutationRecord } from "./template/buildXmlTemplatesCore";
import { globConfiguredXmlFiles } from "./utils/paths";
import { getSettings, SfpXmlLinterSettings } from "./config/settings";
import { parseDocumentFacts, parseDocumentFactsFromText } from "./indexer/xmlFacts";
import { formatXmlTolerant } from "./formatter";
import { WorkspaceIndex, IndexedForm, IndexedSymbolProvenanceProvider } from "./indexer/types";
import { SystemMetadata, getSystemMetadata } from "./config/systemMetadata";
import { FeatureRegistryStore } from "./composition/registry";
import { CompositionTreeProvider } from "./composition/treeView";
import { createSavePipelineOrchestration } from "./core/orchestration/savePipelineOrchestrationService";
import type { SavePerformanceEvent } from "./orchestrator/updateOrchestrator";
import { HoverDocsWatcherService } from "./core/docs/hoverDocsWatcherService";
import { ModuleHost } from "./core/pipeline/moduleHost";
import { PipelineMetricsStore } from "./core/pipeline/metrics";
import { UpdateRunner } from "./core/pipeline/updateRunner";
import { ModelCore } from "./core/model/modelCore";
import { ComposedDocumentSnapshotRegistry } from "./core/model/composedDocumentSnapshotRegistry";
import { ComposedSnapshotRefreshService } from "./core/model/composedSnapshotRefreshService";
import { FactRegistry } from "./core/facts/factRegistry";
import { registerDefaultFactsAndSymbols } from "./core/facts/registerDefaultFactsAndSymbols";
import { SymbolRegistry } from "./core/symbols/symbolRegistry";
import { ModelWriteGateway } from "./core/model/modelWriteGateway";
import {
  getIndexedFormByIdent,
  getParsedFactsByUri as getParsedFactsByUriFromIndexAccess,
  getParsedFactsEntries
} from "./core/model/indexAccess";
import { parseIndexUriKey } from "./core/model/indexUriParser";
import { resolveDocumentFacts } from "./core/model/factsResolution";
import { ValidationHost } from "./core/validation/validationHost";
import { COMPOSED_REFERENCE_RULE_IDS, createValidationModules } from "./core/validation/validationModules";
import { ValidationRequest } from "./core/validation/types";
import { ValidationQueueOrchestrator } from "./core/validation/validationQueueOrchestrator";
import { DocumentValidationService, parseFactsStandalone } from "./core/validation/documentValidationService";
import { DependencyValidationService } from "./core/validation/dependencyValidationService";
import { DiagnosticsPublisherService } from "./core/validation/diagnosticsPublisherService";
import { ReindexService } from "./core/index/reindexService";
import { ProjectScopeService } from "./core/scope/projectScopeService";
import { TemplateBuildOrchestrator } from "./core/template/templateBuildOrchestrator";
import { TemplateBuildPlannerService } from "./core/template/templateBuildPlannerService";
import { collectDependentTemplatePathsFromIndex } from "./core/template/dependentTemplateCollector";
import { ProvenanceHydrationService } from "./core/template/provenanceHydrationService";
import { TemplateBuildRunMode, TemplateBuildRunOptionsFactory } from "./core/template/templateBuildRunOptionsFactory";
import { GeneratorTemplateScaffoldService } from "./core/template/generatorTemplateScaffoldService";
import { ManualTemplateBuildCommandsService } from "./core/template/manualTemplateBuildCommandsService";
import { LegacyTemplateAliasMigrationCommandsService } from "./core/template/legacyTemplateAliasMigrationCommandsService";
import { PipelineUiCommandsService } from "./core/ui/pipelineUiCommandsService";
import { VsCodeEventBridgeService } from "./core/ui/vsCodeEventBridgeService";
import { LanguageProvidersRegistrarService } from "./core/ui/languageProvidersRegistrarService";
import { CompositionCommandsRegistrarService } from "./core/ui/compositionCommandsRegistrarService";
import { WorkspaceMaintenanceCommandsRegistrarService } from "./core/ui/workspaceMaintenanceCommandsRegistrarService";
import { CoreCommandsRegistrarService } from "./core/ui/coreCommandsRegistrarService";
import { StartupBootstrapService } from "./core/startup/startupBootstrapService";
import { sleep } from "./core/utils/sleep";
import { createFormatterOptions, createFormatterOptionsFromFormattingOptions, formatRangeLikeDocument } from "./core/utils/formatterUtils";
import { getUserOpenUris, isUserOpenDocument } from "./core/utils/editorVisibilityUtils";
import { shouldAutoTriggerSqlSuggest } from "./core/utils/sqlBlockUtils";
import { createVirtualXmlDocument, readWorkspaceFileText } from "./core/utils/virtualXmlUtils";
import {
  getProjectKeyForUri as getProjectKeyForUriFromSettings,
  isReindexRelevantUri as isReindexRelevantUriFromSettings,
  isSfpSettingsUri
} from "./core/utils/workspaceScopeUtils";
import {
  BuildTemplateEvaluation,
  BuildTemplateMutationTelemetry,
  CompositionTelemetryService
} from "./core/template/compositionTelemetryService";
import { ModelSyncModule } from "./core/modules/modelSyncModule";
import { ConfigurationEventsModule, DiagnosticsEventsModule, DocumentEventsModule, FilesystemEventsModule, SaveBuildModule } from "./core/modules/eventModules";

const REFERENCE_REQUIRED_RULES = new Set<string>(COMPOSED_REFERENCE_RULE_IDS);

function getDiagnosticCodeValue(code: unknown): string | undefined {
  return typeof code === "string" ? code : undefined;
}

function isComposedReferenceRule(code: unknown): boolean {
  const value = getDiagnosticCodeValue(code);
  return !!value && REFERENCE_REQUIRED_RULES.has(value);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const DEBUG_PREFIX = "[SFP-DBG]";
  const diagnostics = vscode.languages.createDiagnosticCollection("sfpXmlLinter");
  const unifiedOutput = vscode.window.createOutputChannel("SFP XML Linter");
  const buildOutput = unifiedOutput;
  const indexOutput = unifiedOutput;
  const formatterOutput = unifiedOutput;
  const compositionOutput = unifiedOutput;
  const performanceOutput = unifiedOutput;
  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components", "XML_Primitives"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);
  const featureRegistryStore = new FeatureRegistryStore();
  const composedSnapshotRegistry = new ComposedDocumentSnapshotRegistry();
  let composedSnapshotRefreshService: ComposedSnapshotRefreshService | undefined;
  let getModelVersionForTree = () => 0;
  const compositionTreeProvider = new CompositionTreeProvider(
    () => vscode.window.activeTextEditor?.document,
    (uri) => getIndexForUri(uri),
    () => featureRegistryStore.getRegistry(),
    (formIdent, preferredIndex) => resolveOwningFormForDiagnostics(formIdent, preferredIndex),
    composedSnapshotRegistry,
    (document) => refreshComposedSnapshotsForDocument(document),
    () => getModelVersionForTree()
  );
  const compositionTreeView = vscode.window.createTreeView("sfpXmlLinter.compositionView", {
    treeDataProvider: compositionTreeProvider,
    showCollapseAll: true
  });
  const diagnosticsPublisher = new DiagnosticsPublisherService({
    diagnostics,
    onChanged: () => compositionTreeProvider.refresh()
  });
  const engine = new DiagnosticsEngine();
  const factRegistry = new FactRegistry();
  const symbolRegistry = new SymbolRegistry();
  composedSnapshotRefreshService = new ComposedSnapshotRefreshService({
    registry: composedSnapshotRegistry,
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRuntimeIndex: () => runtimeIndexer.getIndex(),
    getFactsForDocument: (document) =>
      resolveDocumentFacts(document, getIndexForUri(document.uri), {
        getFactsForUri: (uri, index) =>
          getParsedFactsByUriFromIndexAccess(
            index,
            uri,
            (targetUri) =>
              factRegistry.getFact(targetUri.toString(), "fact.parsedDocument", "snapshot:refresh") as ReturnType<typeof parseDocumentFactsFromText> | undefined
          ),
        parseFacts: parseDocumentFacts,
        mode: "strict-accessor"
      }),
    logIndex: (message) => logIndex(message)
  });
  const validationHost = new ValidationHost({
    hasFactKind: (kind) => factRegistry.hasProvider(kind),
    hasSymbolKind: (kind) => symbolRegistry.hasResolver(kind),
    log: (message) => logIndex(message)
  });
  const buildService = new BuildXmlTemplatesService();
  const generatorTemplateScaffoldService = new GeneratorTemplateScaffoldService({
    getWorkspaceFolder: () => vscode.workspace.workspaceFolders?.[0],
    logBuild: (message) => logBuild(message)
  });
  const manualTemplateBuildCommandsService = new ManualTemplateBuildCommandsService({
    buildService,
    getTemplateBuilderMode: () => getTemplateBuilderMode(),
    createBuildTelemetryCollector: () => createBuildTelemetryCollector(),
    createBuildRunOptions: (silent, mode, onTemplateEvaluated, onTemplateMutations) =>
      createBuildRunOptions(silent, mode, onTemplateEvaluated, onTemplateMutations),
    queueReindexAll: () => queueReindex("all"),
    applyBuildMutationTelemetry: (mutationsByTemplate) =>
      applyBuildMutationTelemetry(mutationsByTemplate as ReadonlyMap<string, BuildTemplateMutationTelemetry>),
    logBuildCompositionSnapshot: (sourceLabel, evaluations, mode) =>
      logBuildCompositionSnapshot(sourceLabel, evaluations as ReadonlyMap<string, BuildTemplateEvaluation>, mode),
    logBuild: (message) => logBuild(message),
    isInFolder: (uri, folderName) => isInFolder(uri, folderName),
    toRelativePath: (uriOrPath) => {
      if (typeof uriOrPath === "string") {
        return vscode.workspace.asRelativePath(uriOrPath, false);
      }
      return vscode.workspace.asRelativePath(uriOrPath, false);
    },
    onBuildOutputsReady: (stats) => {
      compositionTreeProvider.setLastBuildSummary({
        scope: stats.executedFullBuild ? "full" : "targeted",
        totalMs: stats.durationMs,
        targets: stats.builtTargetCount,
        updated: stats.summary.updated,
        skipped: stats.summary.skipped,
        errors: stats.summary.errors,
        updatedTemplatePaths: stats.updatedTemplatePaths,
        updatedOutputPaths: stats.updatedOutputPaths
      });
    },
    onBuildStateChanged: (state) => {
      compositionTreeProvider.setBuildState(state === "running" ? "building" : "ready");
    }
  });
  const pipelineUiCommandsService = new PipelineUiCommandsService({
    debugPrefix: DEBUG_PREFIX,
    buildOutput,
    indexOutput,
    compositionOutput,
    logBuild: (message) => logBuild(message),
    logIndex: (message) => logIndex(message),
    logComposition: (message) => logComposition(message),
    refreshCompositionView: () => compositionTreeProvider.refresh(),
    getPipelineModuleStats: () => pipelineMetrics.getModuleStats(),
    getPipelineOutcomeStats: () => pipelineMetrics.getOutcomeStats(),
    getPipelinePhaseStats: () => pipelineMetrics.getPhaseStats(),
    getModelStats: () => modelCore.getStats(),
    getSymbolStats: () => symbolRegistry.getStats(),
    getSymbolResolverUsageStats: () => symbolRegistry.getResolverUsageStats(),
    getDeadSymbolResolverKinds: () => symbolRegistry.getDeadResolverKinds(),
    getFactStats: () => factRegistry.getStats(),
    getDeadFactKinds: () => factRegistry.getDeadFactKinds(),
    getFactConsumerUsage: () => factRegistry.getConsumerUsage(),
    getValidationModuleUsageStats: () => validationHost.getModuleUsageStats(),
    getDeadValidationModuleIds: () => validationHost.getDeadModuleIds(),
    getDisabledValidationModules: () => validationHost.getDisabledModuleIds(),
    getPipelineTrace: () => pipelineMetrics.getTrace(),
    getWorkspaceFolder: () => vscode.workspace.workspaceFolders?.[0]
  });
  const legacyTemplateAliasMigrationCommandsService = new LegacyTemplateAliasMigrationCommandsService({
    logBuild: (message) => logBuild(message)
  });
  const vsCodeEventBridgeService = new VsCodeEventBridgeService({
    enqueue: (payload, priority, key) => {
      updateRunner.enqueue(payload, priority, key);
    }
  });
  const emptyIndex: WorkspaceIndex = {
    formsByIdent: new Map(),
    formIdentByUri: new Map(),
    componentsByKey: new Map(),
    componentKeyByUri: new Map(),
    componentKeysByBaseName: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: false,
    componentsReady: false,
    fullReady: false
  };
  const documentationHoverResolver = new DocumentationHoverResolver();
  const hoverDocsWatcherService = new HoverDocsWatcherService({
    getWorkspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
    getHoverDocsFiles: () => getSettings().hoverDocsFiles,
    markDirty: () => documentationHoverResolver.markDirty()
  });
  const languageProvidersRegistrarService = new LanguageProvidersRegistrarService({
    diagnostics,
    documentationHoverResolver,
    getIndexForUri: (uri) => getIndexForUri(uri),
    getFactsForDocument: (document) => {
      const uriKey = document.uri.toString();
      const fromRegistry = factRegistry.getFact(uriKey, "fact.parsedDocument", "provider:language") as ReturnType<typeof parseDocumentFactsFromText> | undefined;
      return fromRegistry;
    },
    getFactsForUri: (uri) => {
      const fromRegistry = factRegistry.getFact(uri.toString(), "fact.parsedDocument", "provider:language");
      return fromRegistry as ReturnType<typeof parseDocumentFactsFromText> | undefined;
    },
    getModelVersion: () => modelCore.getVersion(),
    getSymbolIdentsForUriKind: (uri, kind) => {
      const defs = symbolRegistry.getDefsByKind(uri.toString(), kind);
      return defs.map((def) => def.ident);
    },
    getSymbolReferenceLocationsByKindIdent: (kind, ident) => {
      const refs = symbolRegistry.getRefsForKind(kind).get(ident) ?? [];
      const out: vscode.Location[] = [];
      for (const ref of refs) {
        if (!ref.range) {
          continue;
        }
        try {
          out.push(new vscode.Location(vscode.Uri.parse(ref.nodeId), ref.range));
        } catch {
          // Ignore invalid node ids that are not URI-like.
        }
      }
      return out;
    },
    resolveOwningFormForDiagnostics: (formIdent, preferredIndex) => resolveOwningFormForDiagnostics(formIdent, preferredIndex),
    createFormatterOptionsFromFormattingOptions: (options, document) =>
      createFormatterOptionsFromFormattingOptions(options, document, getSettings()),
    formatDocument: (text, options) => formatXmlTolerant(text, options),
    formatRangeLikeDocument: (document, range, options) => formatRangeLikeDocument(document, range, options),
    logFormatter: (message) => logFormatter(message)
  });
  const compositionCommandsRegistrarService = new CompositionCommandsRegistrarService({
    logComposition: (message) => logComposition(message),
    refreshCompositionView: () => compositionTreeProvider.refresh(),
    validateDocument: (document) => validateDocument(document)
  });
  const workspaceMaintenanceCommandsRegistrarService = new WorkspaceMaintenanceCommandsRegistrarService({
    queueReindexAll: () => queueReindex("all"),
    revalidateWorkspace: () => revalidateWorkspaceFull(),
    revalidateProject: () => revalidateCurrentProject(),
    switchProjectScopeToUri: (uri) => switchActiveProjectScopeToUri(uri),
    rebuildTemplateIndex: async () => {
      await templateIndexer.rebuildIndex();
    },
    rebuildRuntimeIndex: async () => {
      await runtimeIndexer.rebuildIndex();
    },
    globConfiguredXmlFiles: () => globConfiguredXmlFiles(),
    getIndexForUri: (uri) => getIndexerForUri(uri).getIndex(),
    getFactsForUri: (uri) =>
      factRegistry.getFact(uri.toString(), "fact.parsedDocument", "command:workspaceMaintenance"),
    parseFacts: parseDocumentFacts,
    buildDiagnosticsForDocument: (document, index, facts) =>
      buildDiagnosticsForDocument(
        document,
        index,
        facts as ReturnType<typeof parseDocumentFacts>,
        undefined
      ),
    createFormatterOptions: (editorOptions, document) => createFormatterOptions(editorOptions, document, getSettings()),
    formatDocument: (source, options) => formatXmlTolerant(source, options),
    formatRangeLikeDocument: (document, range, options) => formatRangeLikeDocument(document, range, options),
    logFormatter: (message) => logFormatter(message),
    getPublishedDiagnostics: () => diagnosticsPublisher.getEntries()
  });
  const coreCommandsRegistrarService = new CoreCommandsRegistrarService({
    suppressNextSqlSuggest: () => {
      suppressSqlSuggestUntil = Date.now() + 600;
    },
    runBuildCurrentOrSelection: (uri, uris) => manualTemplateBuildCommandsService.runBuildCurrentOrSelection(uri, uris),
    runBuildAll: () => manualTemplateBuildCommandsService.runBuildAll(),
    compareTemplateWithBuiltXml: () => manualTemplateBuildCommandsService.compareTemplateWithBuiltXml(),
    createDocumentGeneratorTemplate: () => generatorTemplateScaffoldService.createGeneratorTemplateFile("document"),
    createSnippetGeneratorTemplate: () => generatorTemplateScaffoldService.createGeneratorTemplateFile("snippet"),
    showBuildQueueLog: () => pipelineUiCommandsService.showBuildQueueLog(),
    showIndexLog: () => pipelineUiCommandsService.showIndexLog(),
    showCompositionLog: () => pipelineUiCommandsService.showCompositionLog(),
    showPipelineStats: () => pipelineUiCommandsService.showPipelineStats(),
    exportTrace: () => pipelineUiCommandsService.exportTrace(),
    exportUsageSnapshot: () => pipelineUiCommandsService.exportUsageSnapshot(),
    refreshCompositionView: () => pipelineUiCommandsService.refreshCompositionView(),
    compositionCopySummary: (payload) => pipelineUiCommandsService.compositionCopySummary(payload),
    compositionLogNonEffectiveUsings: (payload) => pipelineUiCommandsService.compositionLogNonEffectiveUsings(payload),
    migrateLegacyTemplateAliases: () => legacyTemplateAliasMigrationCommandsService.runInteractiveMigration()
  });
  let hasInitialIndex = false;
  type SavePerfAggregate = {
    rel: string;
    refreshElapsedMs?: number;
    refreshRoot?: string;
    refreshReason?: string;
    buildDoneElapsedMs?: number;
    dependencyElapsedMs?: number;
    depForms?: number;
    depFiles?: number;
    depImmediate?: number;
    depLow?: number;
    depDurationMs?: number;
    buildRunCount: number;
    buildRunTemplates: number;
    buildRunDurationMs: number;
    buildRunUpdated: number;
    buildRunSkipped: number;
    buildRunErrors: number;
    buildRunReadMs: number;
    buildRunWriteMs: number;
    buildRunStatMs: number;
    buildRunReadPeakMs: number;
    buildRunWritePeakMs: number;
    buildRunStatPeakMs: number;
    buildRunFastHit: number;
    buildRunFastTotal: number;
    buildRunTraceHit: number;
    buildRunTraceTotal: number;
    buildRunComponentLibraryHit: number;
    buildRunComponentLibraryMiss: number;
    autoRunBuildMs?: number;
    autoPostReindexMs?: number;
    autoPostFormsMs?: number;
    autoPostRuntimeMs?: number;
  };
  let currentSavePerformanceCycleId: string | undefined;
  const savePerfByCycle = new Map<string, SavePerfAggregate>();
  const internalValidationOpens = new Set<string>();
  const pendingContentChangesSinceLastSave = new Set<string>();
  let sqlSuggestTriggerTimer: NodeJS.Timeout | undefined;
  let suppressSqlSuggestUntil = 0;
  const missingComposedRuntimeFactsLogged = new Set<string>();
  const visibleSweepValidatedVersionByUri = new Map<string, number>();
  let lastCompositionSelection:
    | {
        id: string;
        at: number;
      }
    | undefined;
  let reindexService: ReindexService;
  let projectScopeService: ProjectScopeService;
  let templateBuildOrchestrator: TemplateBuildOrchestrator;
  let templateBuildPlanner: TemplateBuildPlannerService;
  let provenanceHydrationService: ProvenanceHydrationService;
  let dependencyValidationService: DependencyValidationService;
  let compositionTelemetryService: CompositionTelemetryService;
  let templateBuildRunOptionsFactory: TemplateBuildRunOptionsFactory;
  const isReindexRelevantUri = (uri: vscode.Uri): boolean => isReindexRelevantUriFromSettings(uri, getSettings());
  const getProjectKeyForUri = (uri: vscode.Uri): string | undefined => getProjectKeyForUriFromSettings(uri, getSettings());

  context.subscriptions.push(diagnostics);
  context.subscriptions.push(unifiedOutput);
  context.subscriptions.push(compositionTreeView);
  context.subscriptions.push(
    compositionTreeView.onDidExpandElement((event) => {
      compositionTreeProvider.setExpanded((event.element as { id?: string }).id, true);
    })
  );
  context.subscriptions.push(
    compositionTreeView.onDidCollapseElement((event) => {
      compositionTreeProvider.setExpanded((event.element as { id?: string }).id, false);
    })
  );
  context.subscriptions.push(
    compositionTreeView.onDidChangeSelection(async (event) => {
      if (event.selection.length !== 1) {
        return;
      }

      const selected = event.selection[0] as { id?: string; type?: string; sourceLocation?: vscode.Location; resourceUri?: vscode.Uri };
      if (!selected?.id || selected.type === "detail" || (!selected.sourceLocation && !selected.resourceUri)) {
        lastCompositionSelection = undefined;
        return;
      }

      const now = Date.now();
      const isDoubleClick = lastCompositionSelection?.id === selected.id && now - lastCompositionSelection.at <= 450;
      lastCompositionSelection = {
        id: selected.id,
        at: now
      };

      if (!isDoubleClick) {
        return;
      }

      await vscode.commands.executeCommand("sfpXmlLinter.compositionOpenSource", selected);
    })
  );

  function appendUnifiedLog(message: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`;
    unifiedOutput.appendLine(line);
    console.log(line);
  }

  function isReadyLogMessage(message: string): boolean {
    if (message.startsWith("REINDEX all passes DONE")) {
      return true;
    }
    if (message.startsWith("REINDEX snapshot refresh")) {
      return true;
    }
    if (message.startsWith("REVALIDATE ")) {
      return true;
    }
    if (
      message.startsWith("validate indexed DONE:") ||
      message.startsWith("validateUri ERROR:") ||
      (message.startsWith("validate facts ") && message.includes(" used:"))
    ) {
      return true;
    }
    return false;
  }

  function logBuild(message: string): void {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (/^ERROR\b/i.test(trimmed) || /^\[generator\]\[warning\]/i.test(trimmed)) {
      appendUnifiedLog(`build: ${trimmed}`);
    }
  }

  function logIndex(message: string): void {
    if (!isReadyLogMessage(message)) {
      return;
    }
    appendUnifiedLog(`linter ready: ${message}`);
  }

  function logFormatter(_message: string): void {
    // Formatter diagnostics are intentionally suppressed in unified concise mode.
  }

  function logSingleFile(message: string): void {
    logIndex(`[single-file] ${message}`);
  }

  function logComposition(_message: string): void {
    // Composition diagnostics are intentionally suppressed in unified concise mode.
  }

  function logPerformance(message: string): void {
    appendUnifiedLog(message);
  }

  function formatIndexProgress(event: RebuildIndexProgressEvent): string {
    const rel = event.uri ? vscode.workspace.asRelativePath(event.uri, false) : undefined;
    switch (event.phase) {
      case "discover-start":
        return "PHASE discover: searching XML files...";
      case "discover-done":
        return event.message ?? `PHASE discover: found ${event.total ?? 0} files`;
      case "parse-start":
        return event.message ?? `PHASE parse: start (${event.total ?? 0})`;
      case "parse-progress":
        return `PHASE parse: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "parse-done":
        return event.message ?? `PHASE parse: done (${event.current ?? 0}/${event.total ?? 0})`;
      case "components-start":
        return `PHASE components: start (${event.total ?? 0})`;
      case "components-progress":
        return `PHASE components: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "components-done":
        return event.message ?? `PHASE components: done (${event.total ?? 0})`;
      case "forms-start":
        return `PHASE forms: start (${event.total ?? 0})`;
      case "forms-progress":
        return `PHASE forms: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "forms-done":
        return event.message ?? `PHASE forms: done (${event.total ?? 0})`;
      case "references-start":
        return event.message ?? `PHASE references: start (${event.total ?? 0})`;
      case "references-progress":
        return `PHASE references: ${event.current ?? 0}/${event.total ?? 0}`;
      case "references-done":
        return event.message ?? `PHASE references: done (${event.total ?? 0})`;
      case "done":
        return `PHASE done: ${event.message ?? "index ready"}`;
      default:
        return event.message ?? event.phase;
    }
  }

  function mapIndexPhasePercent(event: RebuildIndexProgressEvent): number {
    switch (event.phase) {
      case "discover-start":
        return 0;
      case "discover-done":
        return 5;
      case "parse-start":
        return 5;
      case "parse-progress":
        return event.total && event.total > 0 ? 5 + Math.floor((event.current ?? 0) / event.total * 30) : 5;
      case "parse-done":
        return 35;
      case "components-start":
        return 35;
      case "components-progress":
        return event.total && event.total > 0 ? 35 + Math.floor((event.current ?? 0) / event.total * 25) : 35;
      case "components-done":
        return 60;
      case "forms-start":
        return 60;
      case "forms-progress":
        return event.total && event.total > 0 ? 60 + Math.floor((event.current ?? 0) / event.total * 35) : 60;
      case "forms-done":
        return 90;
      case "references-start":
        return 90;
      case "references-progress":
        return event.total && event.total > 0 ? 90 + Math.floor((event.current ?? 0) / event.total * 10) : 90;
      case "references-done":
        return 95;
      case "done":
        return 100;
      default:
        return 0;
    }
  }

  async function withReindexProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return reindexService.withReindexProgress(title, fn);
  }

  function getIndexerByDomain(domain: XmlIndexDomain): WorkspaceIndexer {
    return domain === "runtime" ? runtimeIndexer : templateIndexer;
  }

  function getIndexerForUri(uri: vscode.Uri): WorkspaceIndexer {
    const domain = getXmlIndexDomainByUri(uri);
    return getIndexerByDomain(domain === "other" ? "template" : domain);
  }

  function getIndexForUri(uri?: vscode.Uri): ReturnType<WorkspaceIndexer["getIndex"]> {
    if (!uri) {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (active) {
        return getIndexerForUri(active).getIndex();
      }

      return templateIndexer.getIndex();
    }

    return getIndexerForUri(uri).getIndex();
  }

  function resolveOwningFormForDiagnostics(
    formIdent: string,
    preferredIndex: WorkspaceIndex,
    contextUri?: vscode.Uri
  ): { form: IndexedForm; index: WorkspaceIndex } | undefined {
    const domain = contextUri ? getXmlIndexDomainByUri(contextUri) : "other";

    // For template validation we want diagnostics to reflect the composed/built reality.
    // Prefer runtime form symbols first so template Form/WorkFlow/DataView immediately
    // react to component/feature changes that affect generated XML.
    if (domain === "template") {
      const runtimeIndex = runtimeIndexer.getIndex();
      const runtimeForm = getIndexedFormByIdent(runtimeIndex, formIdent);
      if (runtimeForm) {
        return { form: runtimeForm, index: runtimeIndex };
      }
    }

    const preferredForm = getIndexedFormByIdent(preferredIndex, formIdent);
    if (preferredForm) {
      return { form: preferredForm, index: preferredIndex };
    }

    const runtimeIndex = runtimeIndexer.getIndex();
    const runtimeForm = getIndexedFormByIdent(runtimeIndex, formIdent);
    if (runtimeForm) {
      return { form: runtimeForm, index: runtimeIndex };
    }

    const templateIndex = templateIndexer.getIndex();
    const templateForm = getIndexedFormByIdent(templateIndex, formIdent);
    if (templateForm) {
      return { form: templateForm, index: templateIndex };
    }

    return undefined;
  }

  function rebuildFeatureRegistry(): void {
    const roots = (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri.fsPath)
      .filter((value) => !!value);
    if (roots.length === 0) {
      featureRegistryStore.rebuildMany([]);
      return;
    }

    const registry = featureRegistryStore.rebuildMany(roots);
    logComposition(
      `Registry rebuilt: features=${registry.manifestsByFeature.size}, sources=${registry.manifestsBySource.size}, issues=${registry.issues.length}`
    );
    for (const issue of registry.issues) {
      logComposition(`ISSUE ${issue.source}: ${issue.message}`);
    }
    for (const [feature, model] of registry.effectiveModelsByFeature.entries()) {
      const total = model.contributions.length;
      const effective = model.contributions.filter((item) => item.usage === "effective").length;
      const partial = model.contributions.filter((item) => item.usage === "partial").length;
      const unused = model.contributions.filter((item) => item.usage === "unused").length;
      logComposition(
        `Feature ${feature}: items=${model.items.length}, contributions=${total}, effective=${effective}, partial=${partial}, unused=${unused}, conflicts=${model.conflicts.length}`
      );

      for (const contribution of model.contributions.filter((item) => item.usage !== "effective")) {
        const label = contribution.name ?? contribution.contributionId;
        const missingBits = [
          ...contribution.missingExpectationKeys.map((item) => `expect ${item}`),
          ...contribution.missingExpectedXPaths.map((item) => `xpath ${item}`)
        ];
        const suffix = missingBits.length > 0 ? ` missing=[${missingBits.join(", ")}]` : "";
        logComposition(`  ${feature}/${contribution.partId}/${label}: ${contribution.usage}${suffix}`);
      }
    }
    compositionTreeProvider.refresh();
  }

  function createBuildTelemetryCollector() {
    return compositionTelemetryService.createBuildTelemetryCollector();
  }

  function getTemplateBuilderMode(): "fast" | "debug" | "release" {
    return getSettings().templateBuilderMode;
  }

  function logBuildCompositionSnapshot(
    sourceLabel: string,
    evaluations: ReadonlyMap<string, BuildTemplateEvaluation>,
    mode: "fast" | "debug" | "release"
  ): void {
    compositionTelemetryService.logBuildCompositionSnapshot(sourceLabel, evaluations, mode);
  }

  function applyBuildMutationTelemetry(mutationsByTemplate: ReadonlyMap<string, BuildTemplateMutationTelemetry>): void {
    for (const telemetry of mutationsByTemplate.values()) {
      const outputUri = vscode.Uri.file(telemetry.outputFsPath);
      const providersBySymbolKey = buildProvidersBySymbolKeyFromMutations(telemetry.mutations);
      runtimeIndexer.setBuiltSymbolProvidersForUri(outputUri, providersBySymbolKey);
    }

    if (mutationsByTemplate.size > 0) {
      logComposition(`[build:provenance] applied symbol providers for ${mutationsByTemplate.size} template outputs`);
      compositionTreeProvider.refresh();
    }
  }

  async function hydrateRuntimeProvenanceFromTemplates(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return;
    }

    const startedAt = Date.now();
    let templateCount = 0;
    let outputCount = 0;
    const inheritedUsingsByFormIdent = buildInheritedUsingsSnapshotFromIndex();
    for (const folder of folders) {
      const entries = await buildService.collectTemplateMutationTelemetry(
        folder,
        {
          mode: "release",
          inheritedUsingsByFormIdent
        }
      );
      templateCount += entries.length;
      for (const entry of entries) {
        const outputUri = vscode.Uri.file(entry.outputFsPath);
        const providersBySymbolKey = buildProvidersBySymbolKeyFromMutations(entry.mutations);
        runtimeIndexer.setBuiltSymbolProvidersForUri(outputUri, providersBySymbolKey);
        outputCount++;
      }
    }

    if (templateCount > 0) {
      logComposition(
        `[build:provenance] hydrated from templates=${templateCount}, outputs=${outputCount} in ${Date.now() - startedAt} ms`
      );
      compositionTreeProvider.refresh();
    }
  }

  function runtimeXmlToTemplatePath(runtimeFsPath: string): string {
    return runtimeFsPath.replace(/[\\/]XML([\\/])/i, `${path.sep}XML_Templates$1`);
  }

  function templateXmlToRuntimePath(templateFsPath: string): string {
    return templateFsPath.replace(/[\\/]XML_Templates([\\/])/i, `${path.sep}XML$1`);
  }

  function getTemplateComposedFallbackRange(facts: ReturnType<typeof parseDocumentFactsFromText>): vscode.Range {
    return (
      facts.workflowFormIdentRange ??
      facts.rootFormIdentRange ??
      facts.rootIdentRange ??
      facts.usingReferences[0]?.componentValueRange ??
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1))
    );
  }

  function remapComposedDiagnosticsToTemplate(
    diagnostics: readonly vscode.Diagnostic[],
    facts: ReturnType<typeof parseDocumentFactsFromText>
  ): vscode.Diagnostic[] {
    const fallbackRange = getTemplateComposedFallbackRange(facts);
    return diagnostics.map((item) => {
      const mapped = new vscode.Diagnostic(fallbackRange, item.message, item.severity);
      mapped.source = item.source;
      mapped.code = item.code;
      mapped.tags = item.tags;
      mapped.relatedInformation = item.relatedInformation;
      return mapped;
    });
  }

  function dedupeDiagnostics(diagnostics: readonly vscode.Diagnostic[]): vscode.Diagnostic[] {
    const seen = new Set<string>();
    const out: vscode.Diagnostic[] = [];
    for (const diagnostic of diagnostics) {
      const code = getDiagnosticCodeValue(diagnostic.code) ?? "";
      const key = `${code}|${diagnostic.message}|${diagnostic.severity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(diagnostic);
    }
    return out;
  }

  function buildComposedReferenceDiagnosticsForTemplate(
    templateUri: vscode.Uri,
    templateFacts: ReturnType<typeof parseDocumentFactsFromText>,
    options?: { settingsSnapshot?: SfpXmlLinterSettings; metadataSnapshot?: SystemMetadata }
  ): vscode.Diagnostic[] {
    if (templateUri.scheme !== "file") {
      return [];
    }

    const runtimePath = templateXmlToRuntimePath(templateUri.fsPath);
    if (runtimePath.toLowerCase() === templateUri.fsPath.toLowerCase()) {
      return [];
    }

    const runtimeUri = vscode.Uri.file(runtimePath);
    const runtimeIndex = runtimeIndexer.getIndex();
    const runtimeFacts = getParsedFactsByUri(runtimeIndex, runtimeUri);
    if (!runtimeFacts) {
      const key = `${templateUri.toString()}=>${runtimeUri.toString()}`;
      if (!missingComposedRuntimeFactsLogged.has(key)) {
        missingComposedRuntimeFactsLogged.add(key);
        logIndex(
          `[composed-ref] missing runtime facts for template '${vscode.workspace.asRelativePath(templateUri, false)}' -> '${vscode.workspace.asRelativePath(runtimeUri, false)}'`
        );
      }
      return [];
    }

    const runtimeDoc = createVirtualXmlDocument(runtimeUri, "");
    const composedDiagnostics = validationHost.runMode({
      document: runtimeDoc,
      index: runtimeIndex,
      facts: runtimeFacts,
      domain: getXmlIndexDomainByUri(runtimeUri),
      settingsSnapshot: options?.settingsSnapshot,
      metadataSnapshot: options?.metadataSnapshot,
      skipConfiguredRootsCheck: true
    }, "composed-reference");
    const referenceDiagnostics = composedDiagnostics.filter((item) => isComposedReferenceRule(item.code));
    return remapComposedDiagnosticsToTemplate(referenceDiagnostics, templateFacts);
  }

  function getParsedFactsByUri(
    index: WorkspaceIndex,
    uri: vscode.Uri
  ): ReturnType<typeof parseDocumentFactsFromText> | undefined {
    return getParsedFactsByUriFromIndexAccess(
      index,
      uri,
      (targetUri) =>
        factRegistry.getFact(targetUri.toString(), "fact.parsedDocument", "extension:getParsedFactsByUri") as ReturnType<typeof parseDocumentFactsFromText> | undefined
    );
  }

  function buildDiagnosticsForDocument(
    document: vscode.TextDocument,
    currentIndex: WorkspaceIndex,
    facts: ReturnType<typeof parseDocumentFactsFromText>,
    options?: { settingsSnapshot?: SfpXmlLinterSettings; metadataSnapshot?: SystemMetadata }
  ): vscode.Diagnostic[] {
    // Keep composed snapshots hot for the currently validated document/form so all
    // cross-document checks (ExpectedXPath, related usings) read a fresh single source.
    const owningFormIdent = (() => {
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root === "form") {
        return facts.formIdent;
      }
      if (root === "workflow") {
        return facts.workflowFormIdent ?? facts.rootFormIdent;
      }
      if (root === "dataview") {
        return facts.rootFormIdent;
      }
      return undefined;
    })();
    const refreshUris: vscode.Uri[] = [document.uri];
    if (owningFormIdent) {
      const templateIndex = templateIndexer.getIndex();
      const runtimeIndex = runtimeIndexer.getIndex();
      for (const entry of getParsedFactsEntries(
        templateIndex,
        (uri, idx) =>
          getParsedFactsByUriFromIndexAccess(
            idx,
            uri,
            (targetUri) =>
              factRegistry.getFact(targetUri.toString(), "fact.parsedDocument", "extension:buildDiagnosticsRefresh") as ReturnType<typeof parseDocumentFactsFromText> | undefined
          ),
        parseIndexUriKey
      )) {
        const uri = entry.uri;
        const parsedFacts = entry.facts;
        const parsedRoot = (parsedFacts.rootTag ?? "").toLowerCase();
        const parsedOwning =
          parsedRoot === "form"
            ? parsedFacts.formIdent
            : parsedRoot === "workflow"
              ? (parsedFacts.workflowFormIdent ?? parsedFacts.rootFormIdent)
              : parsedRoot === "dataview"
                ? parsedFacts.rootFormIdent
                : undefined;
        if (!parsedOwning || parsedOwning !== owningFormIdent) {
          continue;
        }
        refreshUris.push(uri);
      }
      composedSnapshotRegistry.refreshForFormIdents(new Set([owningFormIdent]), {
        templateIndex,
        runtimeIndex,
        readFileText: (uri) => {
          try {
            return fs.readFileSync(uri.fsPath, "utf8");
          } catch {
            return undefined;
          }
        }
      });
    }
    composedSnapshotRegistry.refreshForUris(refreshUris, {
      templateIndex: templateIndexer.getIndex(),
      runtimeIndex: runtimeIndexer.getIndex(),
      readFileText: (uri) => {
        try {
          return fs.readFileSync(uri.fsPath, "utf8");
        } catch {
          return undefined;
        }
      }
    });

    const request: ValidationRequest = {
      document,
      index: currentIndex,
      facts,
      domain: getXmlIndexDomainByUri(document.uri),
      settingsSnapshot: options?.settingsSnapshot,
      metadataSnapshot: options?.metadataSnapshot
    };

    const base = validationHost.runMode(request, "source");
    if (request.domain !== "template") {
      return base;
    }

    const composedOnly = validationHost.runMode(request, "composed-reference");
    return dedupeDiagnostics([...base, ...composedOnly]);
  }

  function queueProvenanceHydration(targetRuntimeUri?: vscode.Uri): void {
    provenanceHydrationService?.queueHydration(targetRuntimeUri);
  }

  function createBuildRunOptions(
    silent: boolean,
    mode: TemplateBuildRunMode,
    onTemplateEvaluated?: (
      relativeTemplatePath: string,
      status: "update" | "nochange" | "error",
      templateText: string,
      debugLines: readonly string[]
    ) => void,
    onTemplateMutations?: (
      relativeTemplatePath: string,
      outputRelativePath: string,
      outputFsPath: string,
      mutations: readonly TemplateMutationRecord[],
      renderedOutputText?: string
    ) => void
  ) {
    return templateBuildRunOptionsFactory.createBuildRunOptions(
      silent,
      mode,
      onTemplateEvaluated,
      onTemplateMutations
    );
  }

  async function refreshRuntimeIndexFromBuildOutputs(
    mutationsByTemplate: ReadonlyMap<string, BuildTemplateMutationTelemetry>
  ): Promise<number> {
    const documentsByUri = new Map<string, vscode.TextDocument>();
    const readFromFsUris = new Map<string, vscode.Uri>();
    let openedCount = 0;
    let inMemoryCount = 0;
    for (const telemetry of mutationsByTemplate.values()) {
      const outputUri = vscode.Uri.file(telemetry.outputFsPath);
      if (!isInFolder(outputUri, "XML")) {
        continue;
      }
      const uriKey = outputUri.toString();
      const opened = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriKey);
      if (opened) {
        documentsByUri.set(uriKey, opened);
        openedCount++;
        continue;
      }
      if (typeof telemetry.renderedOutputText === "string") {
        documentsByUri.set(uriKey, createVirtualXmlDocument(outputUri, telemetry.renderedOutputText));
        inMemoryCount++;
        continue;
      }
      readFromFsUris.set(uriKey, outputUri);
    }

    const fsReadStartedAt = Date.now();
    await forEachWithConcurrency([...readFromFsUris.values()], 6, async (uri) => {
      try {
        const text = await readWorkspaceFileText(uri);
        documentsByUri.set(uri.toString(), createVirtualXmlDocument(uri, text));
      } catch {
        // Ignore transient race conditions (file locked/deleted while build is in progress).
      }
    });
    const fsReadMs = Date.now() - fsReadStartedAt;

    if (documentsByUri.size === 0) {
      return 0;
    }

    const batchResult = runtimeIndexer.refreshXmlDocumentsBatch([...documentsByUri.values()], {
      composedOutput: true,
      skipUsingTrace: true,
      lightweightFormSymbols: true,
      skipIgnoreDirectiveScan: true
    });
    const rootProfile = batchResult.profile.perRootMs;
    logPerformance(
      `build runtime-refresh | docs=${documentsByUri.size} | opened=${openedCount} | inMem=${inMemoryCount} | fs=${readFromFsUris.size} (${fsReadMs}ms) | ` +
      `index=${batchResult.profile.totalMs}ms(form=${rootProfile.form}ms,wf=${rootProfile.workflow}ms,dv=${rootProfile.dataview}ms,other=${rootProfile.other}ms)`
    );
    return batchResult.updatedCount;
  }

  async function openTextDocumentWithInternalFlag(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    const key = uri.toString();
    internalValidationOpens.add(key);
    try {
      return await vscode.workspace.openTextDocument(uri);
    } finally {
      internalValidationOpens.delete(key);
    }
  }

  function buildProvidersBySymbolKeyFromMutations(
    mutations: readonly TemplateMutationRecord[]
  ): Map<string, IndexedSymbolProvenanceProvider[]> {
    const out = new Map<string, IndexedSymbolProvenanceProvider[]>();
    const dedupe = new Set<string>();
    for (const mutation of mutations) {
      const provider: IndexedSymbolProvenanceProvider = {
        sourceKind: mutation.source.kind,
        featureKey: mutation.source.featureKey,
        contributionName: mutation.source.contributionName,
        primitiveKey: mutation.source.primitiveKey,
        templateName: mutation.source.templateName,
        confidence: "exact"
      };
      const providerSignature = `${provider.sourceKind}|${provider.featureKey ?? ""}|${provider.contributionName ?? ""}|${provider.primitiveKey ?? ""}|${provider.templateName ?? ""}`;
      for (const symbol of mutation.insertedSymbols) {
        const key = `${symbol.kind}:${symbol.ident}`.toLowerCase();
        const dedupeKey = `${key}|${providerSignature}`;
        if (dedupe.has(dedupeKey)) {
          continue;
        }
        dedupe.add(dedupeKey);
        const bucket = out.get(key) ?? [];
        bucket.push(provider);
        out.set(key, bucket);
      }
    }
    return out;
  }

  const documentValidationService = new DocumentValidationService({
    emptyIndex,
    clearDiagnostics: (uri) => diagnosticsPublisher.delete(uri),
    setDiagnostics: (uri, result) => diagnosticsPublisher.set(uri, result),
    getIndexForUri: (uri) => getIndexerForUri(uri).getIndex(),
    getFactsForUri: (uri) => {
      const fromRegistry = factRegistry.getFact(uri.toString(), "fact.parsedDocument", "validation:document");
      return fromRegistry as ReturnType<typeof parseDocumentFactsFromText> | undefined;
    },
    buildDiagnosticsForDocument: (document, currentIndex, facts, options) =>
      buildDiagnosticsForDocument(document, currentIndex, facts, options),
    shouldValidateUriForActiveProjects: (uri) => shouldValidateUriForActiveProjects(uri),
    documentInConfiguredRoots: (document) => documentInConfiguredRoots(document),
    isUserOpenDocument: (uri) => isUserOpenDocument(uri),
    hasInitialIndex: () => hasInitialIndex,
    openTextDocumentWithInternalFlag,
    readWorkspaceFileText: (uri) => readWorkspaceFileText(uri),
    createVirtualXmlDocument: (uri, text) => createVirtualXmlDocument(uri, text),
    getRelativePath: (uri) => vscode.workspace.asRelativePath(uri, false),
    logIndex: (message) => logIndex(message),
    logSingleFile: (message) => logSingleFile(message),
    referenceRuleFilter: (diagnostic) => {
      const code = typeof diagnostic.code === "string" ? diagnostic.code : "";
      return !REFERENCE_REQUIRED_RULES.has(code);
    }
  });

  const validationQueue = new ValidationQueueOrchestrator({
    log: (message) => logIndex(message),
    publishDiagnosticsBatch: (updates) => diagnosticsPublisher.setBatch(updates),
    onDiagnosticsPublished: () => compositionTreeProvider.refresh(),
    computeIndexedValidationOutcome: (uri, options) => computeIndexedValidationOutcome(uri, options),
    shouldValidateUriForActiveProjects: (uri) => shouldValidateUriForActiveProjects(uri),
    getBackgroundSettingsSnapshot: () => getSettings(),
    getBackgroundMetadataSnapshot: () => getSystemMetadata(),
    getIndexedValidationLogSignature: (uriKey) => documentValidationService.getIndexedValidationLogSignature(uriKey),
    setIndexedValidationLogSignature: (uriKey, signature) => documentValidationService.setIndexedValidationLogSignature(uriKey, signature),
    sleep: (ms) => sleep(ms)
  });
  context.subscriptions.push(validationQueue);

  reindexService = new ReindexService({
    templateIndexer,
    runtimeIndexer,
    log: (message) => logIndex(message),
    formatIndexProgress: (event) => formatIndexProgress(event),
    mapIndexPhasePercent: (event) => mapIndexPhasePercent(event),
    rebuildFeatureRegistry: () => rebuildFeatureRegistry(),
    validateOpenDocuments: () => validateOpenDocuments(),
    globConfiguredXmlFiles: () => globConfiguredXmlFiles(),
    enqueueWorkspaceValidation: (uris) => enqueueWorkspaceValidation(uris),
    queueProvenanceHydration: (activeUri) => queueProvenanceHydration(activeUri),
    setHasInitialIndex: (value) => {
      hasInitialIndex = value;
    },
    refreshComposedSnapshotsAll: () => composedSnapshotRefreshService?.refreshAll() ?? 0,
    validateUri: (uri, options) => validateUri(uri, options),
    getProjectKeyForUri: (uri) => getProjectKeyForUri(uri),
    getSettingsSnapshot: () => getSettings(),
    sleep: (ms) => sleep(ms)
  });
  context.subscriptions.push(reindexService);

  projectScopeService = new ProjectScopeService({
    log: (message) => logIndex(message),
    getProjectKeyForUri: (uri) => getProjectKeyForUri(uri),
    isReindexRelevantUri: (uri) => isReindexRelevantUri(uri),
    isUserOpenDocument: (uri) => isUserOpenDocument(uri),
    getUserOpenUris: () => getUserOpenUris(),
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRuntimeIndex: () => runtimeIndexer.getIndex(),
    diagnosticsForEach: (callback) => diagnosticsPublisher.forEach((uri) => callback(uri)),
    deleteDiagnostics: (uri) => diagnosticsPublisher.delete(uri),
    globConfiguredXmlFiles: () => globConfiguredXmlFiles(),
    enqueueWorkspaceValidation: (uris) => enqueueWorkspaceValidation(uris)
  });

  compositionTelemetryService = new CompositionTelemetryService({
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRegistry: () => featureRegistryStore.getRegistry(),
    logComposition: (message) => logComposition(message)
  });
  templateBuildRunOptionsFactory = new TemplateBuildRunOptionsFactory({
    getSettings: () => getSettings(),
    getExtensionVersion: () => context.extension.packageJSON.version as string | undefined,
    buildInheritedUsingsSnapshotFromIndex: () => buildInheritedUsingsSnapshotFromIndex(),
    logBuild: (message) => logBuild(message),
    onBuildRunPerformance: (stats: BuildRunPerformanceStats) => {
      if (!currentSavePerformanceCycleId) {
        return;
      }
      const aggregate = savePerfByCycle.get(currentSavePerformanceCycleId);
      if (!aggregate) {
        return;
      }
      aggregate.buildRunCount += 1;
      aggregate.buildRunTemplates += stats.templates;
      aggregate.buildRunDurationMs += stats.durationMs;
      aggregate.buildRunUpdated += stats.summary.updated;
      aggregate.buildRunSkipped += stats.summary.skipped;
      aggregate.buildRunErrors += stats.summary.errors;
      aggregate.buildRunReadMs += stats.io.readMs;
      aggregate.buildRunWriteMs += stats.io.writeMs;
      aggregate.buildRunStatMs += stats.io.statMs;
      aggregate.buildRunReadPeakMs = Math.max(aggregate.buildRunReadPeakMs, stats.io.readWallMs);
      aggregate.buildRunWritePeakMs = Math.max(aggregate.buildRunWritePeakMs, stats.io.writeWallMs);
      aggregate.buildRunStatPeakMs = Math.max(aggregate.buildRunStatPeakMs, stats.io.statWallMs);
      aggregate.buildRunFastHit += stats.cache.fastHit;
      aggregate.buildRunFastTotal += stats.cache.fastHit + stats.cache.fastMiss;
      aggregate.buildRunTraceHit += stats.cache.traceHit;
      aggregate.buildRunTraceTotal += stats.cache.traceHit + stats.cache.traceMiss;
      if (stats.cache.componentLibrary === "hit") {
        aggregate.buildRunComponentLibraryHit += 1;
      } else {
        aggregate.buildRunComponentLibraryMiss += 1;
      }
    }
  });

  templateBuildOrchestrator = new TemplateBuildOrchestrator({
    logBuild: (message) => logBuild(message),
    logIndex: (message) => logIndex(message),
    showError: (message) => vscode.window.showErrorMessage(message),
    toRelativePath: (pathOrUri) => {
      if (typeof pathOrUri === "string") {
        return vscode.workspace.asRelativePath(pathOrUri, false);
      }
      return vscode.workspace.asRelativePath(pathOrUri, false);
    },
    getTemplateBuilderMode: () => getTemplateBuilderMode(),
    createBuildTelemetryCollector: () => createBuildTelemetryCollector(),
    createBuildRunOptions: (silent, mode, onTemplateEvaluated, onTemplateMutations) =>
      createBuildRunOptions(silent, mode, onTemplateEvaluated, onTemplateMutations),
    runBuildAll: (workspaceFolder, options) => buildService.run(workspaceFolder, options as never),
    runBuildForPath: (workspaceFolder, targetPath, options) =>
      buildService.runForPath(workspaceFolder, targetPath, options as never),
    runBuildForPaths: (workspaceFolder, targetPaths, options) =>
      buildService.runForPaths(workspaceFolder, targetPaths, options as never),
    queueReindexAll: () => queueReindex("all"),
    refreshFormsFromTemplateTargets: (targetPaths) => refreshFormsFromTemplateTargets(targetPaths),
    refreshRuntimeIndexFromBuildOutputs: (mutationsByTemplate) =>
      refreshRuntimeIndexFromBuildOutputs(mutationsByTemplate as ReadonlyMap<string, BuildTemplateMutationTelemetry>),
    applyBuildMutationTelemetry: (mutationsByTemplate) =>
      applyBuildMutationTelemetry(mutationsByTemplate as ReadonlyMap<string, BuildTemplateMutationTelemetry>),
    logBuildCompositionSnapshot: (sourceLabel, evaluations, mode) =>
      logBuildCompositionSnapshot(sourceLabel, evaluations as ReadonlyMap<string, BuildTemplateEvaluation>, mode),
    onAutoBuildPerformance: (stats) => {
      if (!currentSavePerformanceCycleId) {
        return;
      }
      const aggregate = savePerfByCycle.get(currentSavePerformanceCycleId);
      if (!aggregate) {
        return;
      }
      aggregate.autoRunBuildMs = stats.phases.runBuildMs;
      aggregate.autoPostReindexMs = stats.phases.postBuildReindexMs;
      aggregate.autoPostFormsMs = stats.phases.postBuildFormRefreshMs;
      aggregate.autoPostRuntimeMs = stats.phases.postBuildRuntimeRefreshMs;
    },
    onBuildOutputsReady: (stats) => {
      compositionTreeProvider.setLastBuildSummary({
        scope: stats.executedFullBuild ? "full" : "targeted",
        totalMs: stats.durationMs,
        targets: stats.builtTargetCount,
        updated: stats.summary.updated,
        skipped: stats.summary.skipped,
        errors: stats.summary.errors,
        updatedTemplatePaths: stats.updatedTemplatePaths,
        updatedOutputPaths: stats.updatedOutputPaths
      });
      logPerformance(
        `build ready | scope=${stats.executedFullBuild ? "full" : "targeted"} | total=${stats.durationMs}ms | ` +
        `targets=${stats.builtTargetCount} | updated=${stats.summary.updated} | skipped=${stats.summary.skipped} | errors=${stats.summary.errors}`
      );
    },
    onBuildWorkerStateChanged: (state) => {
      compositionTreeProvider.setBuildState(state === "running" ? "building" : "ready");
    }
  });

  templateBuildPlanner = new TemplateBuildPlannerService({
    getSettings: () => getSettings(),
    getWorkspaceFolderForUri: (uri) => vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0],
    isInFolder: (uri, folderName) => isInFolder(uri, folderName),
    toRelativePath: (uri) => vscode.workspace.asRelativePath(uri, false),
    logBuild: (message) => logBuild(message),
    queueTemplateBuild: (workspaceFolder, targetPath) => queueTemplateBuild(workspaceFolder, targetPath),
    queueTemplateBuildBatch: (workspaceFolder, targetPaths) => queueTemplateBuildBatch(workspaceFolder, targetPaths),
    queueTemplateBuildBatchDeferred: async (workspaceFolder, targetPaths) => {
      await queueTemplateBuildBatch(workspaceFolder, targetPaths);
    },
    waitForTemplateBuildIdle: () => waitForTemplateBuildIdle(),
    getOpenTemplatePaths: (workspaceFolder) => {
      const out = new Set<string>();
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId !== "xml") {
          continue;
        }
        const docWorkspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!docWorkspaceFolder || docWorkspaceFolder.uri.toString() !== workspaceFolder.uri.toString()) {
          continue;
        }
        if (!isInFolder(doc.uri, "XML_Templates")) {
          continue;
        }
        out.add(vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, "/").toLowerCase());
      }
      return out;
    },
    collectTemplatePathsForFormIdentFromIndex: (formIdent) => collectTemplatePathsForFormIdentFromIndex(formIdent),
    collectDependentTemplatesFromIndex: (componentKey) => collectDependentTemplatesFromIndex(componentKey),
    findTemplatesUsingComponent: (workspaceFolder, componentPath) =>
      buildService.findTemplatesUsingComponent(
        workspaceFolder,
        componentPath,
        getSettings().templateBuilderLegacyComponentSectionSupport
      ),
    getIndexForUri: (uri) => getIndexForUri(uri),
    getFactsForDocument: (document) => {
      const fromRegistry = factRegistry.getFact(document.uri.toString(), "fact.parsedDocument", "template:planner");
      return fromRegistry as ReturnType<typeof parseDocumentFactsFromText> | undefined;
    },
    getFactsForUri: (uri, index) =>
      getParsedFactsByUriFromIndexAccess(
        index,
        uri,
        (targetUri) =>
          factRegistry.getFact(targetUri.toString(), "fact.parsedDocument", "template:planner") as ReturnType<typeof parseDocumentFactsFromText> | undefined
      )
  });

  provenanceHydrationService = new ProvenanceHydrationService({
    logComposition: (message) => logComposition(message),
    getWorkspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
    getWorkspaceFolderForPath: (fsPath) => vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath)),
    collectTemplateMutationTelemetry: (folder, options, targetTemplatePath) =>
      buildService.collectTemplateMutationTelemetry(folder, options, targetTemplatePath),
    buildInheritedUsingsSnapshotFromIndex: () => buildInheritedUsingsSnapshotFromIndex(),
    setBuiltSymbolProvidersForUri: (outputUri, providersBySymbolKey) =>
      runtimeIndexer.setBuiltSymbolProvidersForUri(outputUri, providersBySymbolKey),
    runtimeXmlToTemplatePath: (runtimeFsPath) => runtimeXmlToTemplatePath(runtimeFsPath),
    isRuntimeXmlUri: (uri) => isInFolder(uri, "XML"),
    refreshCompositionTree: () => compositionTreeProvider.refresh(),
    sleep: (ms) => sleep(ms)
  });

  function enqueueValidation(
    uri: vscode.Uri,
    priority: "high" | "low",
    options?: { force?: boolean; sourceLabel?: string; snapshotVersion?: number }
  ): void {
    validationQueue.enqueueValidation(uri, priority, options);
  }

  function enqueueWorkspaceValidation(uris: readonly vscode.Uri[]): void {
    validationQueue.enqueueWorkspaceValidation(uris);
  }

  function scheduleSqlSuggestOnTyping(event: vscode.TextDocumentChangeEvent): void {
    if (Date.now() < suppressSqlSuggestUntil) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }

    if (editor.document.languageId !== "xml") {
      return;
    }

    if (event.contentChanges.length !== 1) {
      return;
    }

    const change = event.contentChanges[0];
    if (!change.text || /[\r\n]/.test(change.text)) {
      return;
    }

    if (!/[@=A-Za-z0-9_]/.test(change.text)) {
      return;
    }

    const startOffset = event.document.offsetAt(change.range.start);
    const cursorOffset = startOffset + change.text.length;
    const cursorPos = event.document.positionAt(cursorOffset);
    if (!shouldAutoTriggerSqlSuggest(event.document, cursorPos)) {
      return;
    }

    if (sqlSuggestTriggerTimer) {
      clearTimeout(sqlSuggestTriggerTimer);
    }

    sqlSuggestTriggerTimer = setTimeout(() => {
      sqlSuggestTriggerTimer = undefined;
      void vscode.commands.executeCommand("editor.action.triggerSuggest");
    }, 35);
  }

  async function validateUri(
    uri: vscode.Uri,
    options?: { respectProjectScope?: boolean; preferFsRead?: boolean }
  ): Promise<void> {
    await documentValidationService.validateUri(uri, options);
  }

  async function computeIndexedValidationOutcome(
    uri: vscode.Uri,
    options?: {
      respectProjectScope?: boolean;
      preferFsRead?: boolean;
      settingsSnapshot?: SfpXmlLinterSettings;
      metadataSnapshot?: SystemMetadata;
    }
  ): Promise<
    | {
        uri: vscode.Uri;
        diagnostics: vscode.Diagnostic[];
        signature: string;
        shouldLog: boolean;
        relOrPath: string;
        totalMs: number;
        readMs: number;
        diagnosticsMs: number;
        pathMode: "fast" | "fs" | "open";
        cacheMiss: boolean;
      }
    | undefined
  > {
    return documentValidationService.computeIndexedValidationOutcome(uri, options);
  }

  function validateOpenDocuments(): void {
    ensureActiveProjectScopeInitialized();
    clearDiagnosticsOutsideActiveProjects();
    const targetUris = getUserOpenUris().filter((uri) => uri.scheme === "file");
    if (targetUris.length === 0) {
      return;
    }

    for (const uri of targetUris) {
      // Route startup/open-doc validation through the same queued pipeline as save/revalidate.
      // This avoids stale ordering between direct validation and composed snapshot refresh.
      enqueueValidation(uri, "high", {
        force: true,
        sourceLabel: "open-doc-reindex"
      });
    }

    // Second forced pass: the first pass may validate Form before its related
    // WorkFlow/DataView snapshot is refreshed. This pass converges diagnostics
    // to the same steady state as explicit revalidate without requiring manual save.
    setTimeout(() => {
      for (const uri of targetUris) {
        enqueueValidation(uri, "high", {
          force: true,
          sourceLabel: "open-doc-reindex-pass2"
        });
      }
    }, 200);
  }

  async function queueReindex(
    scope: "bootstrap" | "all",
    options?: { verboseProgress?: boolean; includeRuntimeForBootstrap?: boolean }
  ): Promise<void> {
    await reindexService.queueReindex(scope, options);
    dependencyValidationService.markDependentUrisDirty();
  }

  async function revalidateWorkspaceFull(): Promise<void> {
    await reindexService.revalidateWorkspaceFull();
    const refreshed = composedSnapshotRefreshService?.refreshAll() ?? 0;
    if (refreshed > 0) {
      const uris = (await globConfiguredXmlFiles()).filter((uri) => uri.scheme === "file");
      const startedAt = Date.now();
      await forEachWithConcurrency(uris, 8, async (uri) => {
        await validateUri(uri, { respectProjectScope: false, preferFsRead: true });
      });
      logIndex(`REVALIDATE snapshot pass DONE files=${uris.length} in ${Date.now() - startedAt} ms`);
    }
  }

  async function revalidateCurrentProject(): Promise<void> {
    await reindexService.revalidateCurrentProject();
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== "file") {
      return;
    }
    const projectKey = getProjectKeyForUri(activeUri);
    if (!projectKey) {
      return;
    }
    const refreshed = composedSnapshotRefreshService?.refreshAll() ?? 0;
    if (refreshed > 0) {
      const uris = (await globConfiguredXmlFiles())
        .filter((uri) => uri.scheme === "file")
        .filter((uri) => getProjectKeyForUri(uri) === projectKey);
      const startedAt = Date.now();
      await forEachWithConcurrency(uris, 8, async (uri) => {
        await validateUri(uri, { respectProjectScope: false, preferFsRead: true });
      });
      logIndex(`REVALIDATE project snapshot pass DONE files=${uris.length} in ${Date.now() - startedAt} ms`);
    }
  }

  function shouldValidateUriForActiveProjects(uri: vscode.Uri): boolean {
    return projectScopeService.shouldValidateUriForActiveProjects(uri);
  }

  function clearDiagnosticsOutsideActiveProjects(): void {
    projectScopeService.clearDiagnosticsOutsideActiveProjects();
  }

  function clearClosedStandaloneDiagnostics(): void {
    diagnosticsPublisher.forEach((uri) => {
      if (uri.scheme !== "file") {
        return;
      }

      const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
      if (!rel.endsWith(".xml")) {
        return;
      }

      if (isReindexRelevantUri(uri)) {
        return;
      }

      if (isUserOpenDocument(uri)) {
        return;
      }

      diagnosticsPublisher.delete(uri);
      documentValidationService.clearValidationStateForUri(uri);
      logSingleFile(`cleanup removed closed standalone diagnostics: ${vscode.workspace.asRelativePath(uri, false)}`);
    });
  }

  function ensureActiveProjectScopeInitialized(): void {
    projectScopeService.ensureInitialized();
  }

  async function switchActiveProjectScopeToUri(uri: vscode.Uri): Promise<void> {
    await projectScopeService.switchToUri(uri);
  }

  function isWorkspaceMultiProject(): boolean {
    return projectScopeService.isWorkspaceMultiProject();
  }

  function scheduleDeferredFullReindex(delayMs = 1000): void {
    reindexService.scheduleDeferredFullReindex(delayMs);
  }

  function waitForTemplateBuildIdle(): Promise<void> {
    return templateBuildOrchestrator.waitForIdle();
  }

  async function queueTemplateBuild(workspaceFolder: vscode.WorkspaceFolder, targetPath?: string): Promise<void> {
    await templateBuildOrchestrator.queueBuild(workspaceFolder, targetPath);
  }

  async function queueTemplateBuildBatch(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPaths: readonly string[]
  ): Promise<void> {
    await templateBuildOrchestrator.queueBuildBatch(workspaceFolder, targetPaths);
  }

  async function refreshFormsFromTemplateTargets(targetPaths: readonly string[]): Promise<number> {
    const targetDocs = new Map<string, vscode.TextDocument>();
    await forEachWithConcurrency(targetPaths, 6, async (targetPath) => {
      const uri = vscode.Uri.file(targetPath);
      try {
        let doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (!doc) {
          const text = await readWorkspaceFileText(uri);
          doc = createVirtualXmlDocument(uri, text);
        }

      const facts = resolveDocumentFacts(doc, getIndexForUri(uri), {
        getFactsForUri: (targetUri, index) =>
          getParsedFactsByUriFromIndexAccess(
            index,
            targetUri,
              (factsUri) =>
                factRegistry.getFact(factsUri.toString(), "fact.parsedDocument", "build:refreshForms") as ReturnType<typeof parseDocumentFactsFromText> | undefined
            ),
        parseFacts: parseDocumentFacts,
        mode: "strict-accessor"
      }) ?? parseFactsStandalone(doc);
        const root = (facts?.rootTag ?? "").toLowerCase();
        if (root !== "form") {
          return;
        }

        targetDocs.set(uri.toString(), doc);
      } catch {
        // Ignore transient file states during/after build.
      }
    });

    if (targetDocs.size === 0) {
      return 0;
    }

    const docs = [...targetDocs.values()];
    const batchResult = templateIndexer.refreshXmlDocumentsBatch(docs, {
      lightweightFormSymbols: true
    });

    for (const doc of docs) {
      const openedDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === doc.uri.toString());
      if (openedDoc) {
        validateDocument(openedDoc);
        if (isUserOpenDocument(openedDoc.uri)) {
          enqueueValidation(openedDoc.uri, "high");
        }
      }
    }

    return batchResult.updatedCount;
  }

  function isInFolder(uri: vscode.Uri, folderName: string): boolean {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
    const token = `${folderName.toLowerCase()}/`;
    return rel.startsWith(token) || rel.includes(`/${token}`);
  }

  async function maybeAutoBuildTemplates(document: vscode.TextDocument, componentKeyHint?: string): Promise<void> {
    await templateBuildPlanner.maybeAutoBuildTemplates(document, componentKeyHint);
  }

  async function forEachWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const limit = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;
    const runners: Promise<void>[] = [];
    for (let i = 0; i < limit; i++) {
      runners.push((async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) {
            break;
          }
          await worker(items[index], index);
        }
      })());
    }
    await Promise.all(runners);
  }

  function collectDependentTemplatesFromIndex(componentKey: string): string[] {
    return collectDependentTemplatePathsFromIndex(templateIndexer.getIndex(), componentKey, {
      isTemplatePath: (fsPath) => isInFolder(vscode.Uri.file(fsPath), "XML_Templates")
    });
  }

  function buildInheritedUsingsSnapshotFromIndex(): ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]> {
    const idx = templateIndexer.getIndex();
    const out = new Map<string, TemplateInheritedUsingEntry[]>();
    for (const entry of getParsedFactsEntries(idx, undefined, parseIndexUriKey)) {
      const facts = entry.facts;
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root !== "form" || !facts.formIdent) {
        continue;
      }

      const uri = entry.uri;
      if (!isInFolder(uri, "XML_Templates")) {
        continue;
      }

      if (!facts.usingReferences || facts.usingReferences.length === 0) {
        out.set(facts.formIdent, []);
        continue;
      }

      const entries: TemplateInheritedUsingEntry[] = facts.usingReferences.map((ref) => ({
        featureKey: ref.componentKey,
        contributionKey: ref.sectionValue,
        suppressInheritance: ref.suppressInheritance === true,
        rawComponentValue: ref.rawComponentValue,
        attributes: ref.attributes
      }));
      out.set(facts.formIdent, entries);
    }

    return out;
  }

  function collectTemplatePathsForFormIdentFromIndex(formIdent: string): string[] {
    const idx = templateIndexer.getIndex();
    const result = new Set<string>();
    for (const entry of getParsedFactsEntries(idx, undefined, parseIndexUriKey)) {
      const facts = entry.facts;
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root !== "form" && root !== "workflow" && root !== "dataview") {
        continue;
      }

      const owningFormIdent =
        root === "form"
          ? facts.formIdent
          : root === "workflow"
            ? (facts.workflowFormIdent ?? facts.rootFormIdent)
            : facts.rootFormIdent;
      if (!owningFormIdent || owningFormIdent !== formIdent) {
        continue;
      }

      const uri = entry.uri;
      if (!isInFolder(uri, "XML_Templates")) {
        continue;
      }

      result.add(uri.fsPath);
    }

    return [...result].sort((a, b) => a.localeCompare(b));
  }

  function validateDocument(document: vscode.TextDocument): void {
    documentValidationService.validateDocument(document);
  }

  function refreshComposedSnapshotsForDocument(document: vscode.TextDocument): void {
    composedSnapshotRefreshService?.refreshForDocument(document);
  }

  function refreshComposedSnapshotsForSave(
    cycleId: string,
    document: vscode.TextDocument,
    affectedFormIdents: ReadonlySet<string>
  ): void {
    composedSnapshotRefreshService?.refreshForSave(cycleId, document, affectedFormIdents);
  }

  hoverDocsWatcherService.refresh();
  context.subscriptions.push(hoverDocsWatcherService);

  const handleSavePerformanceEvent = (event: SavePerformanceEvent): void => {
    const rel = vscode.workspace.asRelativePath(event.document.uri, false);
    if (event.phase === "start") {
      currentSavePerformanceCycleId = event.cycleId;
      savePerfByCycle.set(event.cycleId, {
        rel,
        buildRunCount: 0,
        buildRunTemplates: 0,
        buildRunDurationMs: 0,
        buildRunUpdated: 0,
        buildRunSkipped: 0,
        buildRunErrors: 0,
        buildRunReadMs: 0,
        buildRunWriteMs: 0,
        buildRunStatMs: 0,
        buildRunReadPeakMs: 0,
        buildRunWritePeakMs: 0,
        buildRunStatPeakMs: 0,
        buildRunFastHit: 0,
        buildRunFastTotal: 0,
        buildRunTraceHit: 0,
        buildRunTraceTotal: 0,
        buildRunComponentLibraryHit: 0,
        buildRunComponentLibraryMiss: 0
      });
      return;
    }
    const aggregate = savePerfByCycle.get(event.cycleId);
    if (!aggregate) {
      return;
    }
    if (event.phase === "refresh") {
      const refresh = event.refresh;
      aggregate.refreshElapsedMs = event.elapsedMs;
      aggregate.refreshRoot = refresh?.rootKind;
      aggregate.refreshReason = refresh?.reason;
      return;
    }
    if (event.phase === "build-done") {
      aggregate.buildDoneElapsedMs = event.elapsedMs;
      return;
    }
    if (event.phase === "dependency-queued") {
      const dep = event.dependency;
      aggregate.dependencyElapsedMs = event.elapsedMs;
      aggregate.depForms = dep?.forms;
      aggregate.depFiles = dep?.files;
      aggregate.depImmediate = dep?.immediateOpen;
      aggregate.depLow = dep?.queuedLow;
      aggregate.depDurationMs = dep?.durationMs;
      return;
    }
    if (event.phase === "done") {
      const parts: string[] = [
        `build run=${event.cycleId}`,
        `file=${aggregate.rel}`,
        `total=${event.elapsedMs}ms`,
        `refresh=${aggregate.refreshElapsedMs ?? 0}ms(${aggregate.refreshRoot ?? "n/a"}/${aggregate.refreshReason ?? "n/a"})`,
        `build=${aggregate.buildDoneElapsedMs ?? 0}ms`,
        `dep=${aggregate.dependencyElapsedMs ?? 0}ms(forms=${aggregate.depForms ?? 0},files=${aggregate.depFiles ?? 0},imm=${aggregate.depImmediate ?? 0},low=${aggregate.depLow ?? 0},queue=${aggregate.depDurationMs ?? 0}ms)`,
        `runs=${aggregate.buildRunCount}`,
        `runTpl=${aggregate.buildRunTemplates}`,
        `runMs=${aggregate.buildRunDurationMs}ms`,
        `sum=upd:${aggregate.buildRunUpdated}/skip:${aggregate.buildRunSkipped}/err:${aggregate.buildRunErrors}`,
        `ioSum=read:${aggregate.buildRunReadMs}ms,write:${aggregate.buildRunWriteMs}ms,stat:${aggregate.buildRunStatMs}ms`,
        `ioPeak=read:${aggregate.buildRunReadPeakMs}ms,write:${aggregate.buildRunWritePeakMs}ms,stat:${aggregate.buildRunStatPeakMs}ms`,
        `cache=fast:${aggregate.buildRunFastHit}/${aggregate.buildRunFastTotal},trace:${aggregate.buildRunTraceHit}/${aggregate.buildRunTraceTotal},lib:h${aggregate.buildRunComponentLibraryHit}/m${aggregate.buildRunComponentLibraryMiss}`
      ];
      if (
        aggregate.autoRunBuildMs !== undefined
        || aggregate.autoPostReindexMs !== undefined
        || aggregate.autoPostFormsMs !== undefined
        || aggregate.autoPostRuntimeMs !== undefined
      ) {
        parts.push(
          `phases=run:${aggregate.autoRunBuildMs ?? 0}ms,reindex:${aggregate.autoPostReindexMs ?? 0}ms,forms:${aggregate.autoPostFormsMs ?? 0}ms,runtime:${aggregate.autoPostRuntimeMs ?? 0}ms`
        );
      }
      logPerformance(parts.join(" | "));
      currentSavePerformanceCycleId = undefined;
      savePerfByCycle.delete(event.cycleId);
    }
  };

  let dependencyServiceRef: DependencyValidationService | undefined;
  const orchestration = createSavePipelineOrchestration({
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRuntimeIndex: () => runtimeIndexer.getIndex(),
    getFactsForUri: (uri) =>
      factRegistry.getFact(uri.toString(), "fact.parsedDocument", "validation:dependency") as ReturnType<typeof parseDocumentFactsFromText> | undefined,
    isReindexRelevantUri: (uri) => isReindexRelevantUri(uri),
    shouldValidateUriForActiveProjects: (uri) => shouldValidateUriForActiveProjects(uri),
    enqueueValidationHigh: (uri, options) => enqueueValidation(uri, "high", options),
    enqueueValidationLow: (uri, options) => enqueueValidation(uri, "low", options),
    logIndex: (message) => logIndex(message),
    getIndexerForUri: (uri) => getIndexerForUri(uri),
    onStructureUpdated: () => dependencyServiceRef?.markDependentUrisDirty(),
    triggerAutoBuild: async (document, componentKeyHint) => maybeAutoBuildTemplates(document, componentKeyHint),
    queueFullReindex: () => {
      void queueReindex("all");
    },
    getCurrentSnapshotVersion: () => composedSnapshotRefreshService?.getSnapshotVersion() ?? composedSnapshotRegistry.getVersion(),
    onSavePerformance: (event) => handleSavePerformanceEvent(event),
    onPostSave: (context) => {
      refreshComposedSnapshotsForSave(context.cycleId, context.document, context.affectedFormIdents);
    }
  });
  dependencyValidationService = orchestration.dependencyValidationService;
  dependencyServiceRef = dependencyValidationService;
  const updateOrchestrator = orchestration.updateOrchestrator;

  const pipelineModuleHost = new ModuleHost();
  const pipelineMetrics = new PipelineMetricsStore(600);
  const updateRunner = new UpdateRunner(pipelineModuleHost, pipelineMetrics, (line) => logIndex(line));
  const modelCore = new ModelCore();
  getModelVersionForTree = () => modelCore.getVersion() + composedSnapshotRegistry.getVersion();
  const modelWriteGateway = new ModelWriteGateway({
    modelCore,
    factRegistry,
    symbolRegistry
  });
  const resolveParsedFacts = (nodeId: string): ReturnType<typeof parseDocumentFactsFromText> | undefined => {
    const uri = vscode.Uri.parse(nodeId);
    const opened = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (opened) {
      return resolveDocumentFacts(opened, getIndexForUri(uri), {
        getFactsForUri: (targetUri, index) =>
          getParsedFactsByUriFromIndexAccess(
            index,
            targetUri,
            undefined
          ),
        parseFacts: parseDocumentFacts,
        mode: "strict-accessor"
      });
    }

    const indexer = getIndexerForUri(uri);
    return getParsedFactsByUriFromIndexAccess(
      indexer.getIndex(),
      uri
    );
  };

  registerDefaultFactsAndSymbols({
    factRegistry,
    symbolRegistry,
    resolveParsedFacts
  });
  const factDependencyIssues = factRegistry.getMissingDependencies();
  for (const issue of factDependencyIssues) {
    logIndex(`[facts] provider dependency issue: ${issue.factKind} missing=[${issue.missing.join(", ")}]`);
  }

  function simpleHash(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function upsertModelNodeFromDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return;
    }

    const uriKey = document.uri.toString();
    const nodeKind = document.languageId === "xml" ? "document" : "virtual";
    modelWriteGateway.upsertNode({
      id: uriKey,
      kind: nodeKind,
      source: {
        uri: uriKey,
        provider: document.uri.scheme === "file" ? "file" : "runtime",
        identityKey: uriKey
      },
      content: {
        normalizedHash: simpleHash(document.getText()),
        versionToken: `${document.version}`
      }
    });
  }

  function upsertModelNodeFromUri(uri: vscode.Uri, provider: "file" | "generator" | "runtime" = "file"): void {
    if (uri.scheme !== "file") {
      return;
    }
    const uriKey = uri.toString();
    modelWriteGateway.upsertNode({
      id: uriKey,
      kind: "document",
      source: {
        uri: uriKey,
        provider,
        identityKey: uriKey
      }
    });
  }

  pipelineModuleHost.register(new ModelSyncModule({
    upsertModelNodeFromDocument,
    upsertModelNodeFromUri,
    removeModelNodeByUri: (uri) => modelWriteGateway.removeNode(uri.toString())
  }));

  for (const module of createValidationModules({
    runSource: (request) =>
      engine.buildDiagnostics(request.document, request.index, {
        parsedFacts: request.facts,
        settingsOverride: request.settingsSnapshot,
        metadataOverride: request.metadataSnapshot,
        standaloneMode: request.standaloneMode,
        skipConfiguredRootsCheck: request.skipConfiguredRootsCheck,
        featureRegistry: featureRegistryStore.getRegistry(),
        composedSnapshotRegistry,
        resolveOwningForm: (formIdent) =>
          resolveOwningFormForDiagnostics(formIdent, request.index, request.document.uri),
        workflowReferenceMode: "local"
      }),
    runComposed: (request) => {
      if (request.domain !== "template") {
        return [];
      }
      const localComposed = engine
        .buildDiagnostics(request.document, request.index, {
          parsedFacts: request.facts,
          settingsOverride: request.settingsSnapshot,
          metadataOverride: request.metadataSnapshot,
          standaloneMode: request.standaloneMode,
          skipConfiguredRootsCheck: request.skipConfiguredRootsCheck,
          featureRegistry: featureRegistryStore.getRegistry(),
          composedSnapshotRegistry,
          resolveOwningForm: (formIdent) =>
            resolveOwningFormForDiagnostics(formIdent, request.index, request.document.uri),
          workflowReferenceMode: "local"
        })
        .filter((item) => isComposedReferenceRule(item.code));

      const runtimeComposed = buildComposedReferenceDiagnosticsForTemplate(request.document.uri, request.facts, {
        settingsSnapshot: request.settingsSnapshot,
        metadataSnapshot: request.metadataSnapshot
      });

      return dedupeDiagnostics([...localComposed, ...runtimeComposed]);
    }
  })) {
    validationHost.register(module);
  }

  async function handleOpenDocument(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    if (internalValidationOpens.has(key)) {
      return;
    }

    if (document.languageId === "xml" && (document.uri.scheme === "file" || document.uri.scheme === "untitled")) {
      const relOrPath = document.uri.scheme === "file"
        ? vscode.workspace.asRelativePath(document.uri, false)
        : document.uri.toString();
      logIndex(`onDidOpenTextDocument xml: ${relOrPath}`);
    }
    compositionTreeProvider.refresh();
    if (document.uri.scheme === "file" && isInFolder(document.uri, "XML")) {
      queueProvenanceHydration(document.uri);
    }
  }

  async function handleActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
    compositionTreeProvider.refresh();
    const document = editor?.document;
    if (document?.languageId === "xml" && document.uri.scheme === "file" && isInFolder(document.uri, "XML")) {
      queueProvenanceHydration(document.uri);
    }
  }

  async function handleCloseDocument(document: vscode.TextDocument): Promise<void> {
    compositionTreeProvider.refresh();
  }

  async function handleTextChanged(event: vscode.TextDocumentChangeEvent): Promise<void> {
    scheduleSqlSuggestOnTyping(event);
    pendingContentChangesSinceLastSave.add(event.document.uri.toString());
    compositionTreeProvider.refresh();
  }

  async function handleVisibleEditorsChanged(): Promise<void> {
    compositionTreeProvider.refresh();
  }

  async function handleTabsChanged(): Promise<void> {
    compositionTreeProvider.refresh();
  }

  async function handleOpenDocumentDiagnostics(document: vscode.TextDocument): Promise<void> {
    if (!documentInConfiguredRoots(document)) {
      validateDocument(document);
    }
    if (isUserOpenDocument(document.uri) && documentInConfiguredRoots(document)) {
      enqueueValidation(document.uri, "high");
    }
  }

  async function handleCloseDocumentDiagnostics(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== "xml") {
      return;
    }

    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return;
    }

    if (!documentInConfiguredRoots(document)) {
      const relOrPath = document.uri.scheme === "file"
        ? vscode.workspace.asRelativePath(document.uri, false)
        : document.uri.toString();
      logSingleFile(`onDidCloseTextDocument: ${relOrPath}`);
      diagnosticsPublisher.delete(document.uri);
      visibleSweepValidatedVersionByUri.delete(document.uri.toString());
      documentValidationService.clearValidationStateForUri(document.uri);
      logSingleFile(`closed standalone file, diagnostics cleared: ${relOrPath}`);
    }
  }

  async function handleTextChangedDiagnostics(event: vscode.TextDocumentChangeEvent): Promise<void> {
    validateDocument(event.document);
  }

  async function handleVisibleEditorsChangedDiagnostics(): Promise<void> {
    clearClosedStandaloneDiagnostics();
    const document = vscode.window.activeTextEditor?.document;
    if (document && document.languageId === "xml") {
      const key = document.uri.toString();
      if (visibleSweepValidatedVersionByUri.get(key) !== document.version) {
        visibleSweepValidatedVersionByUri.set(key, document.version);
        if (!documentInConfiguredRoots(document)) {
          validateDocument(document);
        } else if (document.uri.scheme === "file") {
          const isDirty = document.isDirty || pendingContentChangesSinceLastSave.has(key);
          if (isDirty) {
            validateDocument(document);
          } else {
            enqueueValidation(document.uri, "high");
          }
        }
      }
    }
  }

  async function handleTabsChangedDiagnostics(): Promise<void> {
    clearClosedStandaloneDiagnostics();
    enqueueActiveEditorValidation("high");
  }

  async function handleSaveDocument(document: vscode.TextDocument): Promise<void> {
    if (isSfpSettingsUri(document.uri)) {
      invalidateSystemMetadataCache();
      logIndex(`SETTINGS changed: ${vscode.workspace.asRelativePath(document.uri, false)} -> metadata cache invalidated`);
      await queueReindex("all");
      return;
    }

    const saveKey = document.uri.toString();
    const hadContentChanges = pendingContentChangesSinceLastSave.has(saveKey);
    pendingContentChangesSinceLastSave.delete(saveKey);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const isComponentLikeSave = isInFolder(document.uri, "XML_Components") || isInFolder(document.uri, "XML_Primitives");
    if (workspaceFolder && isComponentLikeSave) {
      // Keep template build source cache coherent even when save arrives without editor-detected content diff
      // (e.g. external file edits or edge cases in change tracking).
      buildService.invalidateComponentLibraryCache(workspaceFolder, document.uri.fsPath);
    }

    if (!documentInConfiguredRoots(document)) {
      validateDocument(document);
    }
    compositionTreeProvider.refresh();
    if (isUserOpenDocument(document.uri) && documentInConfiguredRoots(document)) {
      enqueueValidation(document.uri, "high");
    }

    if (!hadContentChanges) {
      logIndex(`SAVE skip unchanged: ${vscode.workspace.asRelativePath(document.uri, false)}`);
      return;
    }
    await updateOrchestrator.handleDocumentSave(document, hadContentChanges);
  }

  async function handleFilesCreated(files: readonly vscode.Uri[]): Promise<void> {
    if (files.some((uri) => isSfpSettingsUri(uri))) {
      invalidateSystemMetadataCache();
      logIndex("SETTINGS created -> metadata cache invalidated");
    }
    updateOrchestrator.handleFilesCreated(files);
    for (const uri of files) {
      if (isInFolder(uri, "XML_Components") || isInFolder(uri, "XML_Primitives")) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
          buildService.invalidateComponentLibraryCache(workspaceFolder, uri.fsPath);
        }
      }
    }
    compositionTreeProvider.refresh();
  }

  async function handleFilesDeleted(files: readonly vscode.Uri[]): Promise<void> {
    if (files.some((uri) => isSfpSettingsUri(uri))) {
      invalidateSystemMetadataCache();
      logIndex("SETTINGS deleted -> metadata cache invalidated");
    }
    for (const uri of files) {
      diagnosticsPublisher.delete(uri);
    }

    updateOrchestrator.handleFilesDeleted(files);
    for (const uri of files) {
      if (isInFolder(uri, "XML_Components") || isInFolder(uri, "XML_Primitives")) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
          buildService.invalidateComponentLibraryCache(workspaceFolder, uri.fsPath);
        }
      }
    }
    compositionTreeProvider.refresh();
  }

  async function handleFilesRenamed(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
    if (files.some((item) => isSfpSettingsUri(item.oldUri) || isSfpSettingsUri(item.newUri))) {
      invalidateSystemMetadataCache();
      logIndex("SETTINGS renamed -> metadata cache invalidated");
    }
    for (const item of files) {
      diagnosticsPublisher.delete(item.oldUri);
    }

    updateOrchestrator.handleFilesRenamed(files);
    for (const item of files) {
      const targets = [item.oldUri, item.newUri];
      for (const uri of targets) {
        if (isInFolder(uri, "XML_Components") || isInFolder(uri, "XML_Primitives")) {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
          if (workspaceFolder) {
            buildService.invalidateComponentLibraryCache(workspaceFolder, uri.fsPath);
          }
        }
      }
    }
    compositionTreeProvider.refresh();
  }

  async function handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (event.affectsConfiguration("sfpXmlLinter")) {
      invalidateSystemMetadataCache();
      documentationHoverResolver.markDirty();
      hoverDocsWatcherService.refresh();
      validateOpenDocuments();
      compositionTreeProvider.refresh();
      await queueReindex("all");
    }
  }

  pipelineModuleHost.register(new DocumentEventsModule({
    handleOpenDocument,
    handleActiveEditorChanged,
    handleCloseDocument,
    handleTextChanged,
    handleVisibleEditorsChanged,
    handleTabsChanged
  }));

  pipelineModuleHost.register(new DiagnosticsEventsModule({
    handleOpenDocumentDiagnostics,
    handleCloseDocumentDiagnostics,
    handleTextChangedDiagnostics,
    handleVisibleEditorsChangedDiagnostics,
    handleTabsChangedDiagnostics
  }));

  pipelineModuleHost.register(new SaveBuildModule({
    handleSaveDocument
  }));

  pipelineModuleHost.register(new FilesystemEventsModule({
    handleFilesCreated,
    handleFilesDeleted,
    handleFilesRenamed
  }));

  pipelineModuleHost.register(new ConfigurationEventsModule({
    handleConfigurationChanged
  }));

  vsCodeEventBridgeService.register(context);

  languageProvidersRegistrarService.register(context);

  // Catch already-open XML editors (including files outside configured roots/workspace folders).
  const openXmlCountAtActivate = vscode.workspace.textDocuments.filter((d) => d.languageId === "xml").length;
  logIndex(`Activation warmup: open xml docs=${openXmlCountAtActivate}`);
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === "xml") {
      const relOrPath = doc.uri.scheme === "file"
        ? vscode.workspace.asRelativePath(doc.uri, false)
        : doc.uri.toString();
      logIndex(`Activation warmup validating: ${relOrPath}`);
      validateDocument(doc);
    }
  }

  function enqueueActiveEditorValidation(priority: "high" | "low"): void {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!document || document.languageId !== "xml" || document.uri.scheme !== "file") {
      return;
    }
    if (!documentInConfiguredRoots(document)) {
      return;
    }
    const key = document.uri.toString();
    const isDirty = document.isDirty || pendingContentChangesSinceLastSave.has(key);
    if (isDirty) {
      validateDocument(document);
      return;
    }
    enqueueValidation(document.uri, priority);
  }
  compositionTreeProvider.refresh();

  coreCommandsRegistrarService.register(context);
  compositionCommandsRegistrarService.register(context);
  workspaceMaintenanceCommandsRegistrarService.register(context);

  const startupBootstrapService = new StartupBootstrapService({
    ensureActiveProjectScopeInitialized: () => ensureActiveProjectScopeInitialized(),
    hasRuntimeOpenAtStartup: () => getUserOpenUris().some((uri) => getXmlIndexDomainByUri(uri) === "runtime"),
    withReindexProgress: (title, operation) => withReindexProgress(title, operation),
    queueBootstrapReindex: async (includeRuntimeForBootstrap) => {
      await queueReindex("bootstrap", {
        verboseProgress: getSettings().startupVerboseProgress,
        includeRuntimeForBootstrap
      });
    },
    scheduleDeferredFullReindex: () => scheduleDeferredFullReindex(getSettings().startupFullReindexDelayMs)
  });
  startupBootstrapService.start();
}

export function deactivate(): void {
  // No-op
}


