import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorkspaceIndexer, RebuildIndexProgressEvent } from "./indexer/workspaceIndexer";
import { DiagnosticsEngine } from "./diagnostics/engine";
import { documentInConfiguredRoots, getXmlIndexDomainByUri, XmlIndexDomain } from "./utils/paths";
import { invalidateSystemMetadataCache } from "./config/systemMetadata";
import { DiagnosticsHoverProvider } from "./providers/diagnosticsHoverProvider";
import { HoverRegistry, DocumentationHoverResolver } from "./providers/hoverRegistry";
import { BuildXmlTemplatesService } from "./template/buildXmlTemplatesService";
import { SfpXmlCompletionProvider } from "./providers/completionProvider";
import { SfpXmlDefinitionProvider } from "./providers/definitionProvider";
import { SfpXmlIgnoreCodeActionProvider } from "./providers/ignoreCodeActionProvider";
import { SfpXmlRenameProvider } from "./providers/renameProvider";
import { SfpXmlReferencesProvider } from "./providers/referencesProvider";
import { SfpSqlPlaceholderSemanticProvider } from "./providers/sqlPlaceholderSemanticProvider";
import { SfpXmlColorProvider } from "./providers/colorProvider";
import { globConfiguredXmlFiles } from "./utils/paths";
import { getSettings, SfpXmlLinterSettings } from "./config/settings";
import { parseDocumentFacts, parseDocumentFactsFromText } from "./indexer/xmlFacts";
import { formatXmlTolerant } from "./formatter";
import { formatXmlSelectionWithContext } from "./formatter/selection";
import { FormatterOptions } from "./formatter/types";
import { WorkspaceIndex } from "./indexer/types";
import { SystemMetadata, getSystemMetadata } from "./config/systemMetadata";
import { FeatureRegistryStore } from "./composition/registry";
import { CompositionTreeProvider } from "./composition/treeView";
import { buildBootstrapManifestDraft } from "./composition/bootstrapManifest";
import { populateUsingInsertTraceFromText } from "./composition/usingImpact";
import { buildDocumentCompositionModel } from "./composition/documentModel";
import { applyCompositionPrimitiveQuickFix, CompositionPrimitiveQuickFixPayload } from "./composition/primitiveQuickFix";

const REFERENCE_REQUIRED_RULES = new Set<string>([
  "unknown-form-ident",
  "unknown-form-control-ident",
  "unknown-form-button-ident",
  "unknown-workflow-button-share-code-ident",
  "unknown-form-section-ident",
  "unknown-mapping-ident",
  "unknown-mapping-form-ident",
  "unknown-required-action-ident",
  "unknown-workflow-action-value-control-ident",
  "unknown-workflow-show-hide-control-ident",
  "unknown-html-template-control-ident",
  "unknown-using-feature",
  "unknown-using-contribution",
  "contribution-mismatch",
  "ident-convention-lookup-control"
]);

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const DEBUG_PREFIX = "[SFP-DBG]";
  const diagnostics = vscode.languages.createDiagnosticCollection("sfpXmlLinter");
  const buildOutput = vscode.window.createOutputChannel("SFP XML Linter Build");
  const indexOutput = vscode.window.createOutputChannel("SFP XML Linter Index");
  const formatterOutput = vscode.window.createOutputChannel("SFP XML Linter Formatter");
  const compositionOutput = vscode.window.createOutputChannel("SFP XML Linter Composition");
  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components", "XML_Primitives"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);
  const featureRegistryStore = new FeatureRegistryStore();
  const compositionTreeProvider = new CompositionTreeProvider(
    () => vscode.window.activeTextEditor?.document,
    (uri) => getIndexForUri(uri),
    () => featureRegistryStore.getRegistry()
  );
  const compositionTreeView = vscode.window.createTreeView("sfpXmlLinter.compositionView", {
    treeDataProvider: compositionTreeProvider,
    showCollapseAll: true
  });
  const engine = new DiagnosticsEngine();
  const buildService = new BuildXmlTemplatesService();
  const emptyIndex: WorkspaceIndex = {
    formsByIdent: new Map(),
    componentsByKey: new Map(),
    componentKeysByBaseName: new Map(),
    formIdentReferenceLocations: new Map(),
    mappingFormIdentReferenceLocations: new Map(),
    controlReferenceLocationsByFormIdent: new Map(),
    buttonReferenceLocationsByFormIdent: new Map(),
    sectionReferenceLocationsByFormIdent: new Map(),
    componentReferenceLocationsByKey: new Map(),
    componentContributionReferenceLocationsByKey: new Map(),
    componentUsageFormIdentsByKey: new Map(),
    componentContributionUsageFormIdentsByKey: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: false,
    componentsReady: false,
    fullReady: false
  };
  const documentationHoverResolver = new DocumentationHoverResolver();
  const hoverDocsWatchers: vscode.Disposable[] = [];
  let hasInitialIndex = false;
  let hasShownInitialIndexReadyNotification = false;
  let hasCompletedInitialWorkspaceValidation = false;
  let isReindexRunning = false;
  let queuedReindexScope: "none" | "bootstrap" | "all" = "none";
  let deferredFullReindexTimer: NodeJS.Timeout | undefined;
  let isValidationWorkerRunning = false;
  let isTemplateBuildRunning = false;
  const internalValidationOpens = new Set<string>();
  let lowPriorityValidationStartTimer: NodeJS.Timeout | undefined;
  let queuedFullTemplateBuild = false;
  const queuedTemplatePaths = new Set<string>();
  const pendingContentChangesSinceLastSave = new Set<string>();
  const highPriorityValidationQueue: string[] = [];
  const highPriorityValidationSet = new Set<string>();
  const lowPriorityValidationQueue: string[] = [];
  const lowPriorityValidationSet = new Set<string>();
  let sqlSuggestTriggerTimer: NodeJS.Timeout | undefined;
  let suppressSqlSuggestUntil = 0;
  let activeProjectScopeKey: string | undefined;
  const standaloneValidationVersionByUri = new Map<string, number>();
  const visibleSweepValidatedVersionByUri = new Map<string, number>();
  const indexedValidationLogSignatureByUri = new Map<string, string>();
  let lastCompositionSelection:
    | {
        id: string;
        at: number;
      }
    | undefined;
  let reindexProgressState:
    | {
        progress: vscode.Progress<{ message?: string; increment?: number }>;
        reportedPercent: number;
      }
    | undefined;

  context.subscriptions.push(diagnostics);
  context.subscriptions.push(buildOutput);
  context.subscriptions.push(indexOutput);
  context.subscriptions.push(formatterOutput);
  context.subscriptions.push(compositionOutput);
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

  function logBuild(message: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`;
    buildOutput.appendLine(line);
    console.log(line);
  }

  function logIndex(message: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`;
    indexOutput.appendLine(line);
    console.log(line);
  }

  function logFormatter(message: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`;
    formatterOutput.appendLine(line);
    console.log(line);
  }

  function logSingleFile(message: string): void {
    logIndex(`[single-file] ${message}`);
  }

  function logComposition(message: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`;
    compositionOutput.appendLine(line);
    console.log(line);
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

  function reportReindexProgress(domain: "template" | "runtime", event: RebuildIndexProgressEvent): void {
    const state = reindexProgressState;
    if (!state) {
      return;
    }

    // Map each domain to 50% of total progress.
    const phasePercent = mapIndexPhasePercent(event);
    const absolutePercent = domain === "template" ? Math.floor(phasePercent * 0.5) : 50 + Math.floor(phasePercent * 0.5);
    const increment = Math.max(0, absolutePercent - state.reportedPercent);
    state.progress.report({
      increment,
      message: `[${domain}] ${formatIndexProgress(event)}`
    });
    state.reportedPercent = Math.max(state.reportedPercent, absolutePercent);
  }

  async function withReindexProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        const previous = reindexProgressState;
        reindexProgressState = {
          progress,
          reportedPercent: 0
        };

        try {
          const result = await fn();
          if (reindexProgressState.reportedPercent < 100) {
            progress.report({
              increment: 100 - reindexProgressState.reportedPercent,
              message: "done"
            });
            reindexProgressState.reportedPercent = 100;
          }
          return result;
        } finally {
          reindexProgressState = previous;
        }
      }
    );
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

  type BuildTemplateEvaluation = {
    status: "update" | "nochange" | "error";
    templateText: string;
    debugLines: readonly string[];
  };

  function createBuildTelemetryCollector(): {
    entries: Map<string, BuildTemplateEvaluation>;
    onTemplateEvaluated: (
      relativeTemplatePath: string,
      status: "update" | "nochange" | "error",
      templateText: string,
      debugLines: readonly string[]
    ) => void;
  } {
    const entries = new Map<string, BuildTemplateEvaluation>();
    return {
      entries,
      onTemplateEvaluated: (
        relativeTemplatePath: string,
        status: "update" | "nochange" | "error",
        templateText: string,
        debugLines: readonly string[]
      ) => {
        entries.set(relativeTemplatePath, {
          status,
          templateText,
          debugLines
        });
      }
    };
  }

  function getTemplateBuilderMode(): "fast" | "debug" | "release" {
    return getSettings().templateBuilderMode;
  }

  function logBuildCompositionSnapshot(
    sourceLabel: string,
    evaluations: ReadonlyMap<string, BuildTemplateEvaluation>,
    mode: "fast" | "debug" | "release"
  ): void {
    if (mode === "release") {
      return;
    }

    if (evaluations.size === 0) {
      return;
    }

    const index = templateIndexer.getIndex();
    const sorted = [...evaluations.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxLogged = mode === "debug" ? 30 : 0;
    let withUsings = 0;
    let totalEffective = 0;
    let totalPartial = 0;
    let totalUnused = 0;
    let totalXPathDebug = 0;
    let logged = 0;

    for (const [relativeTemplatePath, evaluation] of sorted) {
      const facts = parseDocumentFactsFromText(evaluation.templateText);
      populateUsingInsertTraceFromText(facts, evaluation.templateText, index);
      const model = buildDocumentCompositionModel(facts, index);
      if (model.usings.length === 0) {
        continue;
      }

      withUsings++;
      const effective = model.usings.filter((item) => item.impact.kind === "effective").length;
      const partial = model.usings.filter((item) => item.impact.kind === "partial").length;
      const unused = model.usings.filter((item) => item.impact.kind === "unused").length;
      totalEffective += effective;
      totalPartial += partial;
      totalUnused += unused;
      const xpathDebugCount = evaluation.debugLines.filter((line) => line.includes("[TargetXPath]")).length;
      totalXPathDebug += xpathDebugCount;

      if (logged < maxLogged) {
        logComposition(
          `[build:${sourceLabel}] ${relativeTemplatePath} status=${evaluation.status} usings=${model.usings.length} effective=${effective} partial=${partial} unused=${unused} xpathDebug=${xpathDebugCount}`
        );
        for (const usingItem of model.usings.filter((item) => item.impact.kind !== "effective")) {
          const usingLabel = usingItem.sectionValue
            ? `${usingItem.rawComponentValue}#${usingItem.sectionValue}`
            : usingItem.rawComponentValue;
          logComposition(
            `  using ${usingLabel}: ${usingItem.impact.kind} (${usingItem.impact.successfulCount}/${usingItem.impact.relevantCount})`
          );
          if (mode === "debug") {
            for (const contribution of usingItem.contributions) {
              const trace = contribution.insertTrace;
              const traceLabel = trace
                ? `insert=${trace.finalInsertCount}, strategy=${trace.strategy}, placeholder=${trace.placeholderCount}, xpath=${trace.targetXPathMatchCount}, clamp=${trace.targetXPathClampedCount}, fallback=${trace.fallbackSymbolCount}`
                : "trace=missing";
              logComposition(
                `    contribution ${contribution.contribution.contributionName}: usage=${contribution.usage}, rootRelevant=${contribution.rootRelevant}, ${traceLabel}`
              );
            }
          }
        }
        logged++;
      }
    }

    if (withUsings === 0) {
      logComposition(`[build:${sourceLabel}] evaluated templates=${evaluations.size}, withUsings=0`);
      if (mode === "debug") {
        logFeatureOrderingSnapshot(sourceLabel);
      }
      return;
    }

    const suppressed = Math.max(0, withUsings - logged);
    logComposition(
      `[build:${sourceLabel}] summary templates=${evaluations.size}, withUsings=${withUsings}, effective=${totalEffective}, partial=${totalPartial}, unused=${totalUnused}, xpathDebug=${totalXPathDebug}${suppressed > 0 ? `, suppressed=${suppressed}` : ""}`
    );
    if (mode === "debug") {
      logFeatureOrderingSnapshot(sourceLabel);
    }
  }

  function logFeatureOrderingSnapshot(sourceLabel: string): void {
    const registry = featureRegistryStore.getRegistry();
    for (const [featureName, manifest] of registry.manifestsByFeature.entries()) {
      const orderingParts = manifest.parts.filter((part) => part.ordering && ((part.ordering.before.length > 0) || (part.ordering.after.length > 0) || !!part.ordering.group));
      if (orderingParts.length === 0) {
        continue;
      }

      const edges = new Map<string, Set<string>>();
      const indegree = new Map<string, number>();
      const partIds = new Set(manifest.parts.map((part) => part.id));
      const addEdge = (from: string, to: string): void => {
        const bucket = edges.get(from) ?? new Set<string>();
        if (!bucket.has(to)) {
          bucket.add(to);
          edges.set(from, bucket);
          indegree.set(to, (indegree.get(to) ?? 0) + 1);
          indegree.set(from, indegree.get(from) ?? 0);
        }
      };

      for (const part of manifest.parts) {
        indegree.set(part.id, indegree.get(part.id) ?? 0);
        const ordering = part.ordering;
        if (!ordering) {
          continue;
        }
        for (const target of ordering.before) {
          if (!partIds.has(target)) {
            continue;
          }
          addEdge(part.id, target);
        }
        for (const target of ordering.after) {
          if (!partIds.has(target)) {
            continue;
          }
          addEdge(target, part.id);
        }
      }

      const queue = [...manifest.parts.map((part) => part.id).filter((id) => (indegree.get(id) ?? 0) === 0)];
      const ordered: string[] = [];
      while (queue.length > 0) {
        queue.sort((a, b) => a.localeCompare(b));
        const current = queue.shift();
        if (!current) {
          break;
        }
        ordered.push(current);
        for (const target of edges.get(current) ?? []) {
          const next = (indegree.get(target) ?? 0) - 1;
          indegree.set(target, next);
          if (next === 0) {
            queue.push(target);
          }
        }
      }

      const orderingConflicts = (registry.effectiveModelsByFeature.get(featureName)?.conflicts ?? [])
        .filter((conflict) => conflict.code === "ordering-conflict");
      const unresolved = manifest.parts
        .map((part) => part.id)
        .filter((id) => !ordered.includes(id));

      logComposition(
        `[build:${sourceLabel}] [ordering] ${featureName}: parts=${manifest.parts.length}, constraints=${[...edges.values()].reduce((acc, value) => acc + value.size, 0)}, resolved=${ordered.length}, conflicts=${orderingConflicts.length}`
      );
      if (ordered.length > 0) {
        logComposition(`  [ordering] resolved order: ${ordered.join(" -> ")}`);
      }
      if (unresolved.length > 0) {
        logComposition(`  [ordering] unresolved parts: ${unresolved.join(", ")}`);
      }
      for (const part of orderingParts) {
        const ordering = part.ordering!;
        logComposition(
          `  [ordering] part=${part.id}, group=${ordering.group ?? "(none)"}, before=${ordering.before.join(", ") || "(none)"}, after=${ordering.after.join(", ") || "(none)"}`
        );
      }
    }
  }

  function createBuildRunOptions(
    silent: boolean,
    mode: "fast" | "debug" | "release",
    onTemplateEvaluated?: (
      relativeTemplatePath: string,
      status: "update" | "nochange" | "error",
      templateText: string,
      debugLines: readonly string[]
    ) => void
  ): {
    silent: boolean;
    mode: "fast" | "debug" | "release";
    postBuildFormat: boolean;
    provenanceMode: "off" | "fileComment";
    provenanceLabel: string;
    formatterMaxConsecutiveBlankLines: number;
    generatorsEnabled: boolean;
    generatorTimeoutMs: number;
    generatorEnableUserScripts: boolean;
    generatorUserScriptsRoots: string[];
    onLogLine: (line: string) => void;
    onFileStatus: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => void;
    onTemplateEvaluated: (
      relativeTemplatePath: string,
      status: "update" | "nochange" | "error",
      templateText: string,
      debugLines: readonly string[]
    ) => void;
  } {
    const onTemplateEvaluatedSafe =
      onTemplateEvaluated ??
      (() => {
        // no-op
      });
    const settings = getSettings();
    const provenanceLabel = `v${context.extension.packageJSON.version ?? "unknown"}`;
    return {
      silent,
      mode,
      postBuildFormat: settings.templateBuilderPostBuildFormat,
      provenanceMode: settings.templateBuilderProvenanceMode,
      provenanceLabel,
      formatterMaxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
      generatorsEnabled: settings.templateBuilderGeneratorsEnabled,
      generatorTimeoutMs: settings.templateBuilderGeneratorTimeoutMs,
      generatorEnableUserScripts: settings.templateBuilderGeneratorEnableUserScripts,
      generatorUserScriptsRoots: settings.templateBuilderGeneratorUserScriptsRoots,
      onLogLine: (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return;
        }

        const processingMatch = /^\[(\d+)\/(\d+)\]\s+(.+)$/.exec(trimmed);
        if (processingMatch) {
          if (mode === "release") {
            return;
          }
          const [, current, total, relPath] = processingMatch;
          logBuild(`FILE ${current}/${total}: ${relPath}`);
          return;
        }

        if (/^(UPDATED|SKIPPED|ERROR\b)/i.test(trimmed)) {
          if (mode !== "debug") {
            return;
          }
          return;
        }

        if (/^Done\./i.test(trimmed) || /^Errors:/i.test(trimmed) || /^\[stderr\]/.test(trimmed)) {
          logBuild(trimmed);
        }
      },
      onFileStatus: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => {
        if (mode === "release") {
          return;
        }
        logBuild(`RESULT ${relativeTemplatePath}: ${status}`);
      },
      onTemplateEvaluated: onTemplateEvaluatedSafe
    };
  }

  function enqueueValidation(uri: vscode.Uri, priority: "high" | "low"): void {
    if (uri.scheme !== "file") {
      return;
    }

    const key = uri.toString();
    if (priority === "high") {
      if (highPriorityValidationSet.has(key)) {
        return;
      }

      highPriorityValidationSet.add(key);
      highPriorityValidationQueue.push(key);
      if (lowPriorityValidationStartTimer) {
        clearTimeout(lowPriorityValidationStartTimer);
        lowPriorityValidationStartTimer = undefined;
      }
      void runValidationWorker();
      return;
    }

    if (highPriorityValidationSet.has(key) || lowPriorityValidationSet.has(key)) {
      return;
    }

    lowPriorityValidationSet.add(key);
    lowPriorityValidationQueue.push(key);
    scheduleLowPriorityValidationWorker();
  }

  function enqueueWorkspaceValidation(uris: readonly vscode.Uri[]): void {
    lowPriorityValidationQueue.length = 0;
    lowPriorityValidationSet.clear();

    const filtered = uris.filter((uri) => shouldValidateUriForActiveProjects(uri));
    for (const uri of filtered) {
      enqueueValidation(uri, "low");
    }
  }

  async function runValidationWorker(): Promise<void> {
    if (isValidationWorkerRunning) {
      return;
    }

    const LOW_PRIORITY_CONCURRENCY = 8;
    const backgroundSettingsSnapshot: SfpXmlLinterSettings = getSettings();
    const backgroundMetadataSnapshot: SystemMetadata = getSystemMetadata();
    isValidationWorkerRunning = true;
    try {
      let processed = 0;
      let processedLow = 0;
      let totalLowAtStart = lowPriorityValidationQueue.length;
      let lowComputeMs = 0;
      let lowPublishMs = 0;
      let lowFastPathCount = 0;
      let lowFsReadPathCount = 0;
      let lowOpenDocPathCount = 0;
      let lowCacheMissCount = 0;
      const lowSlowest: Array<{
        relOrPath: string;
        totalMs: number;
        readMs: number;
        diagnosticsMs: number;
      }> = [];
      while (highPriorityValidationQueue.length > 0 || lowPriorityValidationQueue.length > 0) {
        if (highPriorityValidationQueue.length > 0) {
          const key = highPriorityValidationQueue.shift();
          if (!key) {
            continue;
          }
          highPriorityValidationSet.delete(key);
          const uri = vscode.Uri.parse(key);
          await validateUri(uri);
          processed++;
          continue;
        }

        if (processedLow === 0) {
          totalLowAtStart = lowPriorityValidationQueue.length;
          if (totalLowAtStart > 0) {
            logIndex(`Background validation START files=${totalLowAtStart}`);
          }
        }

        const batch = lowPriorityValidationQueue.splice(0, LOW_PRIORITY_CONCURRENCY);
        if (batch.length === 0) {
          continue;
        }
        for (const key of batch) {
          lowPriorityValidationSet.delete(key);
        }

        const computeStartedAt = Date.now();
        const outcomes: Array<Awaited<ReturnType<typeof computeIndexedValidationOutcome>>> = [];
        for (const key of batch) {
          const uri = vscode.Uri.parse(key);
          const outcome = await computeIndexedValidationOutcome(uri, {
            preferFsRead: true,
            settingsSnapshot: backgroundSettingsSnapshot,
            metadataSnapshot: backgroundMetadataSnapshot
          });
          outcomes.push(outcome);
        }
        lowComputeMs += Date.now() - computeStartedAt;

        const publishStartedAt = Date.now();
        const updates: Array<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]> = [];
        for (const outcome of outcomes) {
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
            if (indexedValidationLogSignatureByUri.get(key) !== outcome.signature) {
              indexedValidationLogSignatureByUri.set(key, outcome.signature);
              logIndex(`validate indexed DONE: ${outcome.relOrPath} diagnostics=${outcome.diagnostics.length}`);
            }
          }
        }
        if (updates.length > 0) {
          diagnostics.set(updates);
        }
        lowPublishMs += Date.now() - publishStartedAt;

        processed += batch.length;
        processedLow += batch.length;
        if (processedLow % 100 === 0 || processedLow === totalLowAtStart) {
          logIndex(`Background validation progress ${processedLow}/${totalLowAtStart}`);
        }
        if (processed % 200 === 0) {
          await sleep(1);
        }
      }
      if (processedLow > 0) {
        logIndex(
          `Background validation DONE files=${processedLow} (compute=${lowComputeMs} ms, publish=${lowPublishMs} ms)`
        );
        logIndex(
          `Background validation path stats: fast=${lowFastPathCount}, fs=${lowFsReadPathCount}, open=${lowOpenDocPathCount}, cacheMiss=${lowCacheMissCount}`
        );
        if (lowSlowest.length > 0) {
          lowSlowest.sort((a, b) => b.totalMs - a.totalMs);
          const top = lowSlowest.slice(0, 10);
          logIndex("Background validation slowest files (top 10):");
          for (const item of top) {
            logIndex(
              `  ${item.totalMs} ms (read=${item.readMs} ms, diagnostics=${item.diagnosticsMs} ms) ${item.relOrPath}`
            );
          }
        }
      }
    } finally {
      isValidationWorkerRunning = false;
    }
  }

  function scheduleLowPriorityValidationWorker(delayMs = 350): void {
    if (isValidationWorkerRunning) {
      return;
    }

    if (lowPriorityValidationStartTimer) {
      return;
    }

    lowPriorityValidationStartTimer = setTimeout(() => {
      lowPriorityValidationStartTimer = undefined;
      void runValidationWorker();
    }, delayMs);
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
    if (uri.scheme !== "file") {
      diagnostics.delete(uri);
      return;
    }

    const respectProjectScope = options?.respectProjectScope !== false;
    if (respectProjectScope && !shouldValidateUriForActiveProjects(uri)) {
      diagnostics.delete(uri);
      return;
    }

    const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    try {
      let document = existing;
      if (!document && options?.preferFsRead && uri.scheme === "file") {
        const text = await readWorkspaceFileText(uri);
        const virtualDocument = createVirtualXmlDocument(uri, text);
        validateDocument(virtualDocument);
        return;
      }

      if (!document) {
        const key = uri.toString();
        internalValidationOpens.add(key);
        try {
          document = await vscode.workspace.openTextDocument(uri);
        } finally {
          internalValidationOpens.delete(key);
        }
      }

      if (!document) {
        return;
      }

      validateDocument(document);
    } catch {
      diagnostics.delete(uri);
    }
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
    const totalStartedAt = Date.now();
    if (uri.scheme !== "file") {
      diagnostics.delete(uri);
      return undefined;
    }

    const respectProjectScope = options?.respectProjectScope !== false;
    if (respectProjectScope && !shouldValidateUriForActiveProjects(uri)) {
      diagnostics.delete(uri);
      return undefined;
    }

    const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const readStartedAt = Date.now();
    const index = getIndexerForUri(uri).getIndex();
    const cachedFacts = index.parsedFactsByUri.get(uri.toString());
    const canUseFastBackgroundFacts = false;
    const cacheMiss = options?.preferFsRead === true && !cachedFacts;

    let document = existing;
    let pathMode: "fast" | "fs" | "open" = "open";
    if (!document && options?.preferFsRead) {
      const text = await readWorkspaceFileText(uri);
      document = createVirtualXmlDocument(uri, text);
      pathMode = "fs";
    }
    if (!document) {
      const key = uri.toString();
      internalValidationOpens.add(key);
      try {
        document = await vscode.workspace.openTextDocument(uri);
        pathMode = "open";
      } finally {
        internalValidationOpens.delete(key);
      }
    }
    if (!document) {
      return undefined;
    }
    const readMs = Date.now() - readStartedAt;
    const diagnosticsStartedAt = Date.now();
    const diagnosticsDocument = document;
    const computed = engine.buildDiagnostics(
      diagnosticsDocument,
      index,
      {
        parsedFacts: cachedFacts,
        settingsOverride: options?.settingsSnapshot,
        metadataOverride: options?.metadataSnapshot,
        skipConfiguredRootsCheck: true,
        featureRegistry: featureRegistryStore.getRegistry()
      }
    );
    const diagnosticsMs = Date.now() - diagnosticsStartedAt;
    const signature = `${diagnosticsDocument.version}:${computed.length}`;
    return {
      uri,
      diagnostics: computed,
      signature,
      shouldLog: computed.length > 0 || isUserOpenDocument(uri),
      relOrPath: vscode.workspace.asRelativePath(uri, false),
      totalMs: Date.now() - totalStartedAt,
      readMs,
      diagnosticsMs,
      pathMode,
      cacheMiss
    };
  }

  function validateOpenDocuments(): void {
    ensureActiveProjectScopeInitialized();
    clearDiagnosticsOutsideActiveProjects();
    const targetUris = getUserOpenUris().filter((uri) => uri.scheme === "file");

    for (const uri of targetUris) {
      const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (existing) {
        validateDocument(existing);
        continue;
      }

      void vscode.workspace.openTextDocument(uri).then(validateDocument, () => {
        // Ignore transient failures (closed tab, invalid URI, etc.)
      });
    }
  }

  async function rebuildIndexAndValidateOpenDocs(options?: { verboseProgress?: boolean }): Promise<void> {
    const verbose = options?.verboseProgress === true;
    if (verbose) {
      logIndex("Initial indexing START");
    }

    await templateIndexer.rebuildIndex({
      onProgress: verbose
        ? (event) => {
            logIndex(`[template] ${formatIndexProgress(event)}`);
            reportReindexProgress("template", event);
          }
        : (event) => {
            reportReindexProgress("template", event);
          }
    });

    await runtimeIndexer.rebuildIndex({
      onProgress: verbose
        ? (event) => {
            logIndex(`[runtime] ${formatIndexProgress(event)}`);
            reportReindexProgress("runtime", event);
          }
        : (event) => {
            reportReindexProgress("runtime", event);
          }
    });

    if (verbose) {
      logIndex("Initial indexing DONE");
    }

    rebuildFeatureRegistry();

    hasInitialIndex = true;
    validateOpenDocuments();
    if (!hasCompletedInitialWorkspaceValidation) {
      const uris = await globConfiguredXmlFiles();
      enqueueWorkspaceValidation(uris);
      hasCompletedInitialWorkspaceValidation = true;
      logIndex("Background workspace validation queued (first full index only).");
    }
  }

  async function rebuildBootstrapIndexAndValidateOpenDocs(options?: { verboseProgress?: boolean; includeRuntime?: boolean }): Promise<void> {
    const verbose = options?.verboseProgress === true;
    const includeRuntime = options?.includeRuntime !== false;
    if (verbose) {
      logIndex("Bootstrap indexing START (components + forms)");
    }

    await templateIndexer.rebuildIndex({
      scope: "bootstrap",
      onProgress: verbose
        ? (event) => {
            logIndex(`[template] ${formatIndexProgress(event)}`);
            reportReindexProgress("template", event);
          }
        : (event) => {
            reportReindexProgress("template", event);
          }
    });

    if (includeRuntime) {
      await runtimeIndexer.rebuildIndex({
        scope: "bootstrap",
        onProgress: verbose
          ? (event) => {
              logIndex(`[runtime] ${formatIndexProgress(event)}`);
              reportReindexProgress("runtime", event);
            }
          : (event) => {
              reportReindexProgress("runtime", event);
            }
      });
    } else if (verbose) {
      logIndex("Bootstrap indexing SKIP runtime (no runtime XML opened).");
    }

    if (verbose) {
      logIndex("Bootstrap indexing DONE (components + forms)");
    }

    rebuildFeatureRegistry();

    hasInitialIndex = true;
    validateOpenDocuments();
  }

  async function queueReindex(scope: "bootstrap" | "all", options?: { verboseProgress?: boolean }): Promise<void> {
    logIndex(`QUEUE reindex requested scope=${scope} running=${isReindexRunning}`);
    if (isReindexRunning) {
      queuedReindexScope = maxReindexScope(queuedReindexScope, scope);
      logIndex(`QUEUE reindex deferred scope=${queuedReindexScope}`);
      return;
    }

    isReindexRunning = true;
    const startedAt = Date.now();
    try {
      const verboseProgress = options?.verboseProgress ?? !hasShownInitialIndexReadyNotification;
      let pendingScope: "bootstrap" | "all" = scope;
      do {
        queuedReindexScope = "none";
        const passStartedAt = Date.now();
        logIndex(`REINDEX pass START scope=${pendingScope}`);
        if (pendingScope === "bootstrap") {
          await rebuildBootstrapIndexAndValidateOpenDocs({ verboseProgress });
        } else {
          await rebuildIndexAndValidateOpenDocs({ verboseProgress });
        }
        logIndex(`REINDEX pass DONE scope=${pendingScope} in ${Date.now() - passStartedAt} ms`);

        const queued = queuedReindexScope;
        if (queued === "none") {
          break;
        }
        pendingScope = queued;
      } while (true);

      const durationMs = Date.now() - startedAt;
      logIndex(`REINDEX all passes DONE in ${durationMs} ms`);
      vscode.window.setStatusBarMessage(`SFP XML Linter: Indexace dokoncena (${durationMs} ms)`, 4000);

      if (!hasShownInitialIndexReadyNotification) {
        hasShownInitialIndexReadyNotification = true;
        vscode.window.showInformationMessage(`SFP XML Linter: Úvodní indexace dokoncena (${durationMs} ms).`);
      }
    } finally {
      isReindexRunning = false;
    }
  }

  async function revalidateWorkspaceFull(): Promise<void> {
    const startedAt = Date.now();
    logIndex("REVALIDATE START: full reindex + full validation");
    await withReindexProgress("SFP XML Linter: Revalidate - Indexing", async () => {
      await queueReindex("all");
    });

    const uris = (await globConfiguredXmlFiles()).filter((uri) => uri.scheme === "file");
    const total = uris.length;
    let processed = 0;
    let reportedPercent = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "SFP XML Linter: Revalidating workspace",
        cancellable: false
      },
      async (progress) => {
        for (const uri of uris) {
          await validateUri(uri, { respectProjectScope: false });
          processed++;

          if (processed % 25 === 0 || processed === total) {
            const nextPercent = total > 0 ? Math.floor((processed / total) * 100) : 100;
            progress.report({
              increment: Math.max(0, nextPercent - reportedPercent),
              message: `${processed}/${total}`
            });
            reportedPercent = nextPercent;
            await sleep(1);
          }
        }
      }
    );

    const durationMs = Date.now() - startedAt;
    logIndex(`REVALIDATE DONE: ${processed} files in ${durationMs} ms`);
    vscode.window.showInformationMessage(`SFP XML Linter: Revalidate done (${processed} files, ${durationMs} ms).`);
  }

  async function revalidateCurrentProject(): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== "file") {
      vscode.window.showInformationMessage("SFP XML Linter: Open a file from the target project first.");
      return;
    }

    const projectKey = getProjectKeyForUri(activeUri);
    if (!projectKey) {
      vscode.window.showInformationMessage("SFP XML Linter: Active file is outside configured XML roots.");
      return;
    }

    const startedAt = Date.now();
    logIndex(`REVALIDATE PROJECT START: ${projectKey}`);
    await withReindexProgress("SFP XML Linter: Revalidate - Current Project Indexing", async () => {
      await queueReindex("all");
    });

    const uris = (await globConfiguredXmlFiles())
      .filter((uri) => uri.scheme === "file")
      .filter((uri) => getProjectKeyForUri(uri) === projectKey);
    await validateUrisWithProgress(uris, "SFP XML Linter: Revalidating current project");

    const durationMs = Date.now() - startedAt;
    logIndex(`REVALIDATE PROJECT DONE: ${uris.length} files in ${durationMs} ms`);
    vscode.window.showInformationMessage(`SFP XML Linter: Project revalidate done (${uris.length} files, ${durationMs} ms).`);
  }

  async function validateUrisWithProgress(uris: readonly vscode.Uri[], title: string): Promise<void> {
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
          await validateUri(uri, { preferFsRead: true });
          processed++;
          if (processed % 25 === 0 || processed === total) {
            const nextPercent = total > 0 ? Math.floor((processed / total) * 100) : 100;
            progress.report({
              increment: Math.max(0, nextPercent - reportedPercent),
              message: `${processed}/${total}`
            });
            reportedPercent = nextPercent;
            await sleep(1);
          }
        }
      }
    );
  }

  function shouldValidateUriForActiveProjects(uri: vscode.Uri): boolean {
    // Files outside configured XML roots are treated as standalone:
    // always allow validation (non-reference rules handled in validateDocument).
    if (!isReindexRelevantUri(uri)) {
      return true;
    }

    if (!isWorkspaceMultiProject()) {
      return true;
    }

    if (!activeProjectScopeKey) {
      return true;
    }

    const projectKey = getProjectKeyForUri(uri);
    if (!projectKey) {
      return true;
    }

    if (projectKey === activeProjectScopeKey) {
      return true;
    }

    // Outside active scope: validate only open files ad-hoc, do not flood diagnostics for whole scope.
    return isUserOpenDocument(uri);
  }

  function clearDiagnosticsOutsideActiveProjects(): void {
    if (!isWorkspaceMultiProject()) {
      return;
    }

    if (!activeProjectScopeKey) {
      return;
    }

    diagnostics.forEach((uri) => {
      const projectKey = getProjectKeyForUri(uri);
      if (!projectKey) {
        return;
      }

      if (projectKey !== activeProjectScopeKey && !isUserOpenDocument(uri)) {
        diagnostics.delete(uri);
      }
    });
  }

  function clearClosedStandaloneDiagnostics(): void {
    diagnostics.forEach((uri) => {
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

      diagnostics.delete(uri);
      standaloneValidationVersionByUri.delete(uri.toString());
      indexedValidationLogSignatureByUri.delete(uri.toString());
      logSingleFile(`cleanup removed closed standalone diagnostics: ${vscode.workspace.asRelativePath(uri, false)}`);
    });
  }

  function ensureActiveProjectScopeInitialized(): void {
    if (activeProjectScopeKey) {
      return;
    }

    const candidate = getUserOpenUris()
      .filter((uri) => uri.scheme === "file")
      .map((uri) => getProjectKeyForUri(uri))
      .find((v): v is string => !!v);
    if (!candidate) {
      return;
    }

    activeProjectScopeKey = candidate;
    logIndex(`PROJECT scope initialized: ${candidate}`);
  }

  async function switchActiveProjectScopeToUri(uri: vscode.Uri): Promise<void> {
    if (!isWorkspaceMultiProject()) {
      logIndex("PROJECT scope switch skipped: workspace is not multi-project.");
      return;
    }

    const next = getProjectKeyForUri(uri);
    if (!next) {
      logIndex("PROJECT scope switch skipped: active file is outside configured XML roots.");
      return;
    }

    if (next === activeProjectScopeKey) {
      logIndex(`PROJECT scope unchanged: ${next}`);
      return;
    }

    const prev = activeProjectScopeKey;
    activeProjectScopeKey = next;
    logIndex(`PROJECT scope switched: ${prev ?? "<none>"} -> ${next}`);
    clearDiagnosticsOutsideActiveProjects();

    const uris = (await globConfiguredXmlFiles())
      .filter((u) => u.scheme === "file")
      .filter((u) => getProjectKeyForUri(u) === next);
    logIndex(`PROJECT scope validation queued for ${uris.length} file(s).`);
    enqueueWorkspaceValidation(uris);
  }

  function isWorkspaceMultiProject(): boolean {
    const projectKeys = new Set<string>();

    for (const form of templateIndexer.getIndex().formsByIdent.values()) {
      const key = getProjectKeyForUri(form.uri);
      if (key) {
        projectKeys.add(key);
      }
    }
    for (const component of templateIndexer.getIndex().componentsByKey.values()) {
      const key = getProjectKeyForUri(component.uri);
      if (key) {
        projectKeys.add(key);
      }
    }
    for (const form of runtimeIndexer.getIndex().formsByIdent.values()) {
      const key = getProjectKeyForUri(form.uri);
      if (key) {
        projectKeys.add(key);
      }
    }

    return projectKeys.size > 1;
  }

  function scheduleDeferredFullReindex(delayMs = 6000): void {
    if (deferredFullReindexTimer) {
      clearTimeout(deferredFullReindexTimer);
    }

    deferredFullReindexTimer = setTimeout(() => {
      deferredFullReindexTimer = undefined;
      if (!hasShownInitialIndexReadyNotification) {
        void withReindexProgress("SFP XML Linter: Initial Full Indexing", async () => {
          await queueReindex("all");
        });
        return;
      }

      void queueReindex("all");
    }, delayMs);
  }

  async function queueTemplateBuild(workspaceFolder: vscode.WorkspaceFolder, targetPath?: string): Promise<void> {
    if (targetPath) {
      queuedTemplatePaths.add(targetPath);
      logBuild(`QUEUE + target: ${vscode.workspace.asRelativePath(targetPath, false)} (targets=${queuedTemplatePaths.size}, full=${queuedFullTemplateBuild})`);
    } else {
      queuedFullTemplateBuild = true;
      queuedTemplatePaths.clear();
      logBuild("QUEUE + FULL build (target queue cleared)");
    }

    if (isTemplateBuildRunning) {
      logBuild("Worker busy, request queued.");
      return;
    }

    isTemplateBuildRunning = true;
    logBuild("Worker START");
    const mode = getTemplateBuilderMode();
    let executedBuild = false;
    let executedFullBuild = false;
    const builtTargetPaths = new Set<string>();
    const telemetry = createBuildTelemetryCollector();
    try {
      do {
        if (queuedFullTemplateBuild) {
          queuedFullTemplateBuild = false;
          logBuild("BUILD START full templates");
          await buildService.run(workspaceFolder, createBuildRunOptions(true, mode, telemetry.onTemplateEvaluated));
          executedBuild = true;
          executedFullBuild = true;
          logBuild("BUILD DONE full templates");
          continue;
        }

        const nextPath = queuedTemplatePaths.values().next().value as string | undefined;
        if (!nextPath) {
          break;
        }

        queuedTemplatePaths.delete(nextPath);
        logBuild(`BUILD START target: ${vscode.workspace.asRelativePath(nextPath, false)} (remaining=${queuedTemplatePaths.size})`);
        await buildService.runForPath(workspaceFolder, nextPath, createBuildRunOptions(true, mode, telemetry.onTemplateEvaluated));
        executedBuild = true;
        builtTargetPaths.add(nextPath);
        logBuild(`BUILD DONE target: ${vscode.workspace.asRelativePath(nextPath, false)}`);
      } while (queuedFullTemplateBuild || queuedTemplatePaths.size > 0);

      if (executedBuild) {
        if (executedFullBuild) {
          logIndex("POST-BUILD reindex scope=all");
          await queueReindex("all");
        } else {
          const refreshStartedAt = Date.now();
          const refreshedCount = await refreshFormsFromTemplateTargets([...builtTargetPaths]);
          logIndex(`POST-BUILD incremental form refresh count=${refreshedCount} in ${Date.now() - refreshStartedAt} ms`);
        }

        logBuildCompositionSnapshot("auto", telemetry.entries, mode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Auto BuildXmlTemplates failed: ${message}`);
      logBuild(`BUILD ERROR: ${message}`);
    } finally {
      isTemplateBuildRunning = false;
      logBuild("Worker IDLE");
    }
  }

  async function refreshFormsFromTemplateTargets(targetPaths: readonly string[]): Promise<number> {
    let refreshed = 0;
    for (const targetPath of targetPaths) {
      const uri = vscode.Uri.file(targetPath);
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (!doc) {
          continue;
        }

        const root = (parseDocumentFacts(doc).rootTag ?? "").toLowerCase();
        if (root !== "form") {
          continue;
        }

        const result = templateIndexer.refreshFormDocument(doc);
        if (result.updated) {
          refreshed++;
          validateDocument(doc);
          if (isUserOpenDocument(doc.uri)) {
            enqueueValidation(doc.uri, "high");
          }
        }
      } catch {
        // Ignore transient file states during/after build.
      }
    }

    return refreshed;
  }

  function isInFolder(uri: vscode.Uri, folderName: string): boolean {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
    const token = `${folderName.toLowerCase()}/`;
    return rel.startsWith(token) || rel.includes(`/${token}`);
  }

  async function maybeAutoBuildTemplates(document: vscode.TextDocument, componentKeyHint?: string): Promise<void> {
    const settings = getSettings();
    if (!settings.autoBuildOnSave) {
      return;
    }

    if (document.languageId !== "xml") {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    if (isInFolder(document.uri, "XML_Templates")) {
      logBuild(`SAVE XML_Templates: ${vscode.workspace.asRelativePath(document.uri, false)}`);
      await queueTemplateBuild(workspaceFolder, document.uri.fsPath);
      return;
    }

    const isComponentLikeSave = isInFolder(document.uri, "XML_Components") || isInFolder(document.uri, "XML_Primitives");
    if (!isComponentLikeSave) {
      return;
    }

    logBuild(`SAVE component-like source: ${vscode.workspace.asRelativePath(document.uri, false)}`);
    if (settings.componentSaveBuildScope === "full") {
      logBuild("Component save scope=full -> FULL build");
      await queueTemplateBuild(workspaceFolder);
      return;
    }

    const indexedDependents = componentKeyHint ? collectDependentTemplatesFromIndex(componentKeyHint) : [];
    if (indexedDependents.length > 0) {
      logBuild(`Dependents from index: ${indexedDependents.length}`);
      for (const templatePath of indexedDependents) {
        await queueTemplateBuild(workspaceFolder, templatePath);
      }
      return;
    }

    const fallbackStartedAt = Date.now();
    const dependentTemplates = await buildService.findTemplatesUsingComponent(workspaceFolder, document.uri.fsPath);
    logBuild(`Dependents fallback scan took ${Date.now() - fallbackStartedAt} ms`);
    if (dependentTemplates.length === 0) {
      logBuild("No dependents found -> FULL build fallback");
      await queueTemplateBuild(workspaceFolder);
      return;
    }

    logBuild(`Dependents found: ${dependentTemplates.length}`);
    for (const templatePath of dependentTemplates) {
      await queueTemplateBuild(workspaceFolder, templatePath);
    }
  }

  function collectDependentTemplatesFromIndex(componentKey: string): string[] {
    const idx = templateIndexer.getIndex();
    const candidateKeys = new Set<string>([componentKey]);
    const baseName = componentKey.split("/").pop() ?? componentKey;
    const variants = idx.componentKeysByBaseName.get(baseName);
    if (variants) {
      for (const variant of variants) {
        candidateKeys.add(variant);
      }
    }

    const result = new Set<string>();
    for (const key of candidateKeys) {
      const refs = idx.componentReferenceLocationsByKey.get(key);
      if (!refs) {
        continue;
      }

      for (const location of refs) {
        if (!isInFolder(location.uri, "XML_Templates")) {
          continue;
        }

        result.add(location.uri.fsPath);
      }
    }

    return [...result].sort((a, b) => a.localeCompare(b));
  }

  function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== "xml") {
      diagnostics.delete(document.uri);
      return;
    }

    // Ignore virtual XML documents (git:, vscode-userdata:, etc.).
    // We only validate real files and optional untitled scratch XML.
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      diagnostics.delete(document.uri);
      return;
    }

    const relOrPath = document.uri.scheme === "file"
      ? vscode.workspace.asRelativePath(document.uri, false)
      : document.uri.toString();

    if (!documentInConfiguredRoots(document)) {
      const docKey = document.uri.toString();
      const alreadyValidatedVersion = standaloneValidationVersionByUri.get(docKey);
      if (alreadyValidatedVersion === document.version) {
        return;
      }

      logSingleFile(`validate standalone START: ${relOrPath}`);
      const standaloneDiagnostics = engine.buildDiagnostics(document, emptyIndex, { standaloneMode: true }).filter((d) => {
        const code = typeof d.code === "string" ? d.code : "";
        return !REFERENCE_REQUIRED_RULES.has(code);
      });
      diagnostics.set(document.uri, standaloneDiagnostics);
      standaloneValidationVersionByUri.set(docKey, document.version);
      logSingleFile(`validate standalone DONE: ${relOrPath} diagnostics=${standaloneDiagnostics.length}`);
      return;
    }

    if (!shouldValidateUriForActiveProjects(document.uri)) {
      logIndex(`validate skipped by project scope: ${relOrPath}`);
      diagnostics.delete(document.uri);
      return;
    }

    // Avoid noisy false positives during startup before the first full index exists.
    if (!hasInitialIndex) {
      logIndex(`validate skipped before initial index: ${relOrPath}`);
      diagnostics.delete(document.uri);
      return;
    }

    const result = engine.buildDiagnostics(document, getIndexerForUri(document.uri).getIndex(), {
      parsedFacts: parseDocumentFacts(document),
      featureRegistry: featureRegistryStore.getRegistry()
    });
    diagnostics.set(document.uri, result);
    if (result.length > 0 || isUserOpenDocument(document.uri)) {
      const key = document.uri.toString();
      const signature = `${document.version}:${result.length}`;
      if (indexedValidationLogSignatureByUri.get(key) !== signature) {
        indexedValidationLogSignatureByUri.set(key, signature);
        logIndex(`validate indexed DONE: ${relOrPath} diagnostics=${result.length}`);
      }
    }
  }

  function refreshHoverDocsWatchers(): void {
    while (hoverDocsWatchers.length > 0) {
      const w = hoverDocsWatchers.pop();
      w?.dispose();
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    const settings = getSettings();
    for (const folder of folders) {
      for (const docPath of settings.hoverDocsFiles) {
        const pattern = new vscode.RelativePattern(folder, docPath);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
        watcher.onDidCreate(() => documentationHoverResolver.markDirty());
        watcher.onDidChange(() => documentationHoverResolver.markDirty());
        watcher.onDidDelete(() => documentationHoverResolver.markDirty());
        hoverDocsWatchers.push(watcher);
      }
    }
  }

  refreshHoverDocsWatchers();
  context.subscriptions.push({
    dispose: () => {
      while (hoverDocsWatchers.length > 0) {
        hoverDocsWatchers.pop()?.dispose();
      }
    }
  });

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
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
      if (!documentInConfiguredRoots(document)) {
        validateDocument(document);
      }
      compositionTreeProvider.refresh();
      if (isUserOpenDocument(document.uri) && documentInConfiguredRoots(document)) {
        enqueueValidation(document.uri, "high");
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
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
        diagnostics.delete(document.uri);
        standaloneValidationVersionByUri.delete(document.uri.toString());
        visibleSweepValidatedVersionByUri.delete(document.uri.toString());
        indexedValidationLogSignatureByUri.delete(document.uri.toString());
        logSingleFile(`closed standalone file, diagnostics cleared: ${relOrPath}`);
      }
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleSqlSuggestOnTyping(event);
      pendingContentChangesSinceLastSave.add(event.document.uri.toString());
      if (!documentInConfiguredRoots(event.document)) {
        validateDocument(event.document);
      }
      compositionTreeProvider.refresh();
      if (isUserOpenDocument(event.document.uri) && documentInConfiguredRoots(event.document)) {
        enqueueValidation(event.document.uri, "high");
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      clearClosedStandaloneDiagnostics();
      compositionTreeProvider.refresh();
      const document = vscode.window.activeTextEditor?.document;
      if (document && document.languageId === "xml") {
        const key = document.uri.toString();
        if (visibleSweepValidatedVersionByUri.get(key) !== document.version) {
          visibleSweepValidatedVersionByUri.set(key, document.version);
          if (!documentInConfiguredRoots(document)) {
            validateDocument(document);
          } else if (document.uri.scheme === "file") {
            enqueueValidation(document.uri, "high");
          }
        }
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      clearClosedStandaloneDiagnostics();
      compositionTreeProvider.refresh();
      enqueueActiveEditorValidation("high");
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isSfpSettingsUri(document.uri)) {
        invalidateSystemMetadataCache();
        logIndex(`SETTINGS changed: ${vscode.workspace.asRelativePath(document.uri, false)} -> metadata cache invalidated`);
        void queueReindex("all");
        return;
      }

      const saveKey = document.uri.toString();
      const hadContentChanges = pendingContentChangesSinceLastSave.has(saveKey);
      pendingContentChangesSinceLastSave.delete(saveKey);

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

      if (isReindexRelevantUri(document.uri)) {
        const root = (parseDocumentFacts(document).rootTag ?? "").toLowerCase();
        const rel = vscode.workspace.asRelativePath(document.uri, false);
        const activeIndexer = getIndexerForUri(document.uri);
        let refreshedComponentKey: string | undefined;
        if (root === "form") {
          const startedAt = Date.now();
          const refreshed = activeIndexer.refreshFormDocument(document);
          logIndex(
            `SAVE form incremental refresh ${refreshed.updated ? "UPDATED" : "SKIPPED"} (${refreshed.reason}) ${rel} in ${Date.now() - startedAt} ms`
          );
        } else if (root === "component") {
          const startedAt = Date.now();
          const refreshed = activeIndexer.refreshComponentDocument(document);
          refreshedComponentKey = refreshed.componentKey;
          logIndex(
            `SAVE component incremental refresh ${refreshed.updated ? "UPDATED" : "SKIPPED"} (${refreshed.reason}) ${rel} in ${Date.now() - startedAt} ms`
          );
        } else {
          logIndex(`SAVE skip non-structural root='${root || "unknown"}': ${rel}`);
        }
        void maybeAutoBuildTemplates(document, refreshedComponentKey);
        return;
      }
      void maybeAutoBuildTemplates(document);
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      if (event.files.some((uri) => isSfpSettingsUri(uri))) {
        invalidateSystemMetadataCache();
        logIndex("SETTINGS created -> metadata cache invalidated");
      }
      if (event.files.some((uri) => isReindexRelevantUri(uri))) {
        void queueReindex("all");
      }
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      if (event.files.some((uri) => isSfpSettingsUri(uri))) {
        invalidateSystemMetadataCache();
        logIndex("SETTINGS deleted -> metadata cache invalidated");
      }
      for (const uri of event.files) {
        diagnostics.delete(uri);
      }

      if (event.files.some((uri) => isReindexRelevantUri(uri))) {
        void queueReindex("all");
      }
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      if (event.files.some((item) => isSfpSettingsUri(item.oldUri) || isSfpSettingsUri(item.newUri))) {
        invalidateSystemMetadataCache();
        logIndex("SETTINGS renamed -> metadata cache invalidated");
      }
      for (const item of event.files) {
        diagnostics.delete(item.oldUri);
      }

      if (event.files.some((item) => isReindexRelevantUri(item.oldUri) || isReindexRelevantUri(item.newUri))) {
        void queueReindex("all");
      }
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("sfpXmlLinter")) {
        invalidateSystemMetadataCache();
        documentationHoverResolver.markDirty();
        refreshHoverDocsWatchers();
        validateOpenDocuments();
        compositionTreeProvider.refresh();
        await queueReindex("all");
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: "xml" }, new DiagnosticsHoverProvider(diagnostics)),
    vscode.languages.registerHoverProvider({ language: "xml" }, new HoverRegistry([documentationHoverResolver])),
    vscode.languages.registerCompletionItemProvider(
      { language: "xml" },
      new SfpXmlCompletionProvider((uri) => getIndexForUri(uri)),
      "<",
      " ",
      ":",
      "\"",
      "'",
      "=",
      "@"
    ),
    vscode.languages.registerReferenceProvider({ language: "xml" }, new SfpXmlReferencesProvider((uri) => getIndexForUri(uri))),
    vscode.languages.registerDefinitionProvider({ language: "xml" }, new SfpXmlDefinitionProvider((uri) => getIndexForUri(uri))),
    vscode.languages.registerRenameProvider({ language: "xml" }, new SfpXmlRenameProvider((uri) => getIndexForUri(uri))),
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "xml" },
      new SfpSqlPlaceholderSemanticProvider(),
      SfpSqlPlaceholderSemanticProvider.legend
    ),
    vscode.languages.registerColorProvider({ language: "xml" }, new SfpXmlColorProvider()),
    vscode.languages.registerDocumentFormattingEditProvider({ language: "xml" }, {
      provideDocumentFormattingEdits(document, options) {
        const startedAt = Date.now();
        const formatterOptions = createFormatterOptionsFromFormattingOptions(options, document);
        const result = formatXmlTolerant(document.getText(), formatterOptions);
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        logFormatter(
          `PROVIDER format document done in ${Date.now() - startedAt} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`
        );
        return [vscode.TextEdit.replace(fullRange, result.text)];
      }
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider({ language: "xml" }, {
      provideDocumentRangeFormattingEdits(document, range, options) {
        const startedAt = Date.now();
        const formatterOptions = createFormatterOptionsFromFormattingOptions(options, document);
        const result = formatRangeLikeDocument(document, range, formatterOptions);
        logFormatter(
          `PROVIDER format range done in ${Date.now() - startedAt} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`
        );
        return [vscode.TextEdit.replace(result.range, result.text)];
      }
    }),
    vscode.languages.registerCodeActionsProvider({ language: "xml" }, new SfpXmlIgnoreCodeActionProvider(), {
      providedCodeActionKinds: SfpXmlIgnoreCodeActionProvider.providedCodeActionKinds
    })
  );

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
    enqueueValidation(document.uri, priority);
  }
  compositionTreeProvider.refresh();

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.suppressNextSqlSuggest", () => {
      suppressSqlSuggestUntil = Date.now() + 600;
    }),
    vscode.commands.registerCommand("sfpXmlLinter.buildXmlTemplates", async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("No workspace folder is open.");
        return;
      }

      try {
        logBuild("MANUAL build current/selection START");
        const mode = getTemplateBuilderMode();
        const telemetry = createBuildTelemetryCollector();
        const selection = collectBuildSelectionUris(uri, uris);
        const targetUris = selection.length > 0 ? selection : getActiveDocumentUriFallback();

        if (targetUris.length === 0) {
          logBuild("No current/selected resource -> FULL fallback");
          await buildService.run(folder, createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated));
          await queueReindex("all");
          logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);
          logBuild("MANUAL build current/selection DONE (full fallback)");
          return;
        }

        const templateTargets = new Set<string>();
        let usedFullFallback = false;

        for (const targetUri of targetUris) {
          if (isInFolder(targetUri, "XML_Templates")) {
            templateTargets.add(targetUri.fsPath);
            continue;
          }

          if (isInFolder(targetUri, "XML_Components") || isInFolder(targetUri, "XML_Primitives")) {
            const dependentTemplates = await buildService.findTemplatesUsingComponent(folder, targetUri.fsPath);
            if (dependentTemplates.length === 0) {
              usedFullFallback = true;
              logBuild(
                `Selection in XML_Components/XML_Primitives has no dependents: ${vscode.workspace.asRelativePath(targetUri, false)} -> FULL fallback`
              );
              break;
            }

            for (const dependent of dependentTemplates) {
              templateTargets.add(dependent);
            }
            continue;
          }

          usedFullFallback = true;
          logBuild(`Selection outside template roots: ${vscode.workspace.asRelativePath(targetUri, false)} -> FULL fallback`);
          break;
        }

        if (usedFullFallback || templateTargets.size === 0) {
          await buildService.run(folder, createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated));
          await queueReindex("all");
          logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);
          logBuild("MANUAL build current/selection DONE (full fallback)");
          return;
        }

        for (const targetPath of templateTargets) {
          logBuild(`MANUAL target build: ${vscode.workspace.asRelativePath(targetPath, false)}`);
          await buildService.runForPath(folder, targetPath, createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated));
        }
        await queueReindex("all");
        logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);

        logBuild("MANUAL build current/selection DONE");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`BuildXmlTemplates failed: ${message}`);
        logBuild(`MANUAL build current/selection ERROR: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.buildXmlTemplatesAll", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("No workspace folder is open.");
        return;
      }

      try {
        logBuild("MANUAL build all START");
        const mode = getTemplateBuilderMode();
        const telemetry = createBuildTelemetryCollector();
        await buildService.run(folder, createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated));
        await queueReindex("all");
        logBuildCompositionSnapshot("manual-all", telemetry.entries, mode);
        logBuild("MANUAL build all DONE");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`BuildXmlTemplates (all) failed: ${message}`);
        logBuild(`MANUAL build all ERROR: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.createDocumentGeneratorTemplate", async () => {
      await createGeneratorTemplateFile("document");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.createSnippetGeneratorTemplate", async () => {
      await createGeneratorTemplateFile("snippet");
    })
  );

  async function createGeneratorTemplateFile(kind: "document" | "snippet"): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    const baseDir = path.join(folder.uri.fsPath, "XML_Generators");
    const baseFileName = kind === "document"
      ? "hello.document.generator.js"
      : "hello.snippet.generator.js";
    const targetPath = await nextAvailableFilePath(baseDir, baseFileName);
    const targetUri = vscode.Uri.file(targetPath);

    const content = kind === "document"
      ? buildDocumentGeneratorTemplate()
      : buildSnippetGeneratorTemplate();

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
    const opened = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(opened, { preview: false });
    const rel = vscode.workspace.asRelativePath(targetUri, false);
    vscode.window.showInformationMessage(`SFP XML Linter: Created ${kind} generator template at ${rel}.`);
    logBuild(`Generator template created: kind=${kind} path=${rel}`);
  }

  async function nextAvailableFilePath(baseDir: string, fileName: string): Promise<string> {
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, Math.max(0, fileName.length - ext.length));
    let candidate = path.join(baseDir, fileName);
    let index = 1;
    while (await pathExists(candidate)) {
      candidate = path.join(baseDir, `${stem}.${index}${ext}`);
      index++;
    }
    return candidate;
  }

  async function pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  function buildDocumentGeneratorTemplate(): string {
    return `module.exports = {
  kind: "document",
  id: "hello-document-generator",
  description: "Hello World document generator example.",

  // Optional: skip files where this generator should not run.
  applies(ctx) {
    return /<\\s*Form\\b/i.test(ctx.document.getXml());
  },

  // Input: full XML document via ctx.document.getXml()
  // Output: mutate the document via ctx.document.setXml(...) or ctx.document.append/prepend/before/after(...)
  run(ctx) {
    const marker = "<!-- hello-document-generator -->";
    const xml = ctx.document.getXml();
    if (xml.includes(marker)) {
      return;
    }

    const result = ctx.document.append("//Form", "\\n  " + marker + "\\n", false);
    if (result.insertCount === 0) {
      ctx.warn("hello-document-no-form", "No //Form node found, nothing inserted.");
    }
  }
};
`;
  }

  function buildSnippetGeneratorTemplate(): string {
    return `module.exports = {
  kind: "snippet",
  id: "hello-snippet-generator",
  selector: "Demo/HelloSnippet",
  description: "Hello World snippet generator example.",

  // This runs only for blocks with: UseGenerator="Demo/HelloSnippet"
  // Example input:
  // <GeneratorSnippet UseGenerator="Demo/HelloSnippet" Name="Team" />
  run(ctx) {
    const name = (ctx.snippet.attrs.get("Name") ?? "World").trim() || "World";
    const safeName = ctx.helpers.xml.escapeAttr(name);
    const replacement = "<Label Text=\\"Hello " + safeName + "\\" />";
    ctx.replaceSnippet(replacement);
  }
};
`;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.showBuildQueueLog", () => {
      buildOutput.show(true);
      logBuild("Opened build queue log");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.showIndexLog", () => {
      indexOutput.show(true);
      logIndex("Opened index log");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.showCompositionLog", () => {
      compositionOutput.show(true);
      logComposition("Opened composition log");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.refreshCompositionView", () => {
      compositionTreeProvider.refresh();
      logComposition("Composition view refreshed");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.compositionCopySummary", async (payload?: { text?: string }) => {
      const text = payload?.text?.trim();
      if (!text) {
        vscode.window.showInformationMessage("SFP XML Linter: No composition summary available for current selection.");
        return;
      }

      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("SFP XML Linter: Composition summary copied to clipboard.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sfpXmlLinter.compositionLogNonEffectiveUsings",
      (payload?: { title?: string; lines?: string[] }) => {
        const lines = payload?.lines ?? [];
        if (lines.length === 0) {
          vscode.window.showInformationMessage("SFP XML Linter: No non-effective usings for current document.");
          return;
        }

        logComposition(payload?.title ? `${payload.title}:` : "Non-effective usings:");
        for (const line of lines) {
          logComposition(`  ${line}`);
        }
        compositionOutput.show(true);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.generateFeatureManifestBootstrap", async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (!activeUri || activeUri.scheme !== "file") {
        vscode.window.showInformationMessage("SFP XML Linter: Open a feature XML file first.");
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (!workspaceFolder) {
        vscode.window.showInformationMessage("SFP XML Linter: Active file must be inside a workspace folder.");
        return;
      }

      const draft = buildBootstrapManifestDraft(workspaceFolder.uri.fsPath, activeUri.fsPath);
      if (!draft) {
        vscode.window.showInformationMessage(
          "SFP XML Linter: No feature candidate found for this file. Open a *.feature.xml inside XML_Components."
        );
        return;
      }

      const targetUri = vscode.Uri.file(draft.manifestPath);
      const alreadyExists = await fs
        .access(draft.manifestPath)
        .then(() => true)
        .catch(() => false);

      if (alreadyExists) {
        const choice = await vscode.window.showWarningMessage(
          `SFP XML Linter: '${vscode.workspace.asRelativePath(targetUri, false)}' already exists. Overwrite?`,
          { modal: true },
          "Overwrite"
        );
        if (choice !== "Overwrite") {
          return;
        }
      }

      await fs.mkdir(path.dirname(draft.manifestPath), { recursive: true });
      await fs.writeFile(draft.manifestPath, draft.manifestText, "utf8");
      logComposition(
        `Bootstrap manifest generated for feature '${draft.feature}': ${vscode.workspace.asRelativePath(targetUri, false)}`
      );
      const opened = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(opened, { preview: false });
      vscode.window.showInformationMessage(
        `SFP XML Linter: Generated bootstrap manifest for '${draft.feature}'.`
      );
      compositionTreeProvider.refresh();
    })
  );

  type CompositionSourceNode = {
    sourceLocation?: vscode.Location;
    resourceUri?: vscode.Uri;
    label?: string;
  };

  type CompositionOpenMode = "peek" | "side" | "sidePreview" | "newTab" | "current";

  function getCompositionOpenMode(): CompositionOpenMode {
    const raw = vscode.workspace
      .getConfiguration("sfpXmlLinter")
      .get<string>("composition.openMode", "newTab");
    if (raw === "side" || raw === "sidePreview" || raw === "newTab" || raw === "current" || raw === "peek") {
      return raw;
    }
    return "newTab";
  }

  async function openCompositionSource(node: CompositionSourceNode | undefined, mode: CompositionOpenMode): Promise<void> {
    const location = node?.sourceLocation;
    if (location) {
      if (mode === "peek") {
        await vscode.commands.executeCommand(
          "editor.action.peekLocations",
          location.uri,
          location.range.start,
          [location],
          "peek"
        );
        return;
      }

      await vscode.window.showTextDocument(location.uri, {
        selection: location.range,
        viewColumn: mode === "side" || mode === "sidePreview" ? vscode.ViewColumn.Beside : undefined,
        preview: mode === "sidePreview" || mode === "current",
        preserveFocus: mode === "sidePreview"
      });
      return;
    }

    if (node?.resourceUri) {
      await vscode.window.showTextDocument(node.resourceUri, {
        viewColumn: mode === "side" || mode === "sidePreview" ? vscode.ViewColumn.Beside : undefined,
        preview: mode === "sidePreview" || mode === "current",
        preserveFocus: mode === "sidePreview"
      });
      return;
    }

    vscode.window.showInformationMessage("SFP XML Linter: Source location is not available for this item.");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSource", async (node?: CompositionSourceNode) => {
      await openCompositionSource(node, getCompositionOpenMode());
    }),
    vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSourceBeside", async (node?: CompositionSourceNode) => {
      await openCompositionSource(node, "side");
    }),
    vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSourceSidePreview", async (node?: CompositionSourceNode) => {
      await openCompositionSource(node, "sidePreview");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sfpXmlLinter.compositionApplyPrimitiveQuickFix",
      async (payload?: CompositionPrimitiveQuickFixPayload) => {
        if (!payload?.uri || !payload?.kind || !(payload?.name ?? "").trim()) {
          vscode.window.showInformationMessage("SFP XML Linter: Primitive quick fix payload is incomplete.");
          return;
        }
        const debugName = (payload.name ?? "").trim();
        const debugKind = payload.kind;
        const debugPrimitive = (payload.primitiveKey ?? "").trim();
        logComposition(
          `Primitive quick-fix START kind=${debugKind} name='${debugName}' primitive='${debugPrimitive || "(none)"}'`
        );

        const result = await applyCompositionPrimitiveQuickFix(payload, {
          getDiagnostics(uri) {
            return vscode.languages.getDiagnostics(uri as vscode.Uri);
          },
          async getCodeActions(uri, range) {
            const actions =
              (await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
                "vscode.executeCodeActionProvider",
                uri as vscode.Uri,
                range as vscode.Range,
                vscode.CodeActionKind.QuickFix
              )) ?? [];
            return actions.map((action) => {
              if (action instanceof vscode.CodeAction) {
                return {
                  title: action.title,
                  edit: action.edit,
                  command: action.command
                    ? {
                        command: action.command.command,
                        arguments: action.command.arguments
                      }
                    : undefined
                };
              }

              return {
                title: action.title,
                command: {
                  command: action.command,
                  arguments: action.arguments
                }
              };
            });
          },
          async applyEdit(edit) {
            await vscode.workspace.applyEdit(edit as vscode.WorkspaceEdit);
          },
          async executeCommand(command, ...args) {
            await vscode.commands.executeCommand(command, ...args);
          },
          async openDocument(uri) {
            return vscode.workspace.openTextDocument(uri as vscode.Uri);
          },
          async validateDocument(document) {
            await validateDocument(document as vscode.TextDocument);
          },
          async askRevalidate(message) {
            logComposition(`Primitive quick-fix RETRY prompt: ${message}`);
            const pick = await vscode.window.showInformationMessage(message, "Revalidate");
            logComposition(`Primitive quick-fix RETRY selected=${pick === "Revalidate" ? "yes" : "no"}`);
            return pick === "Revalidate";
          }
        });

        if (result === "missing-diagnostic") {
          vscode.window.showInformationMessage("SFP XML Linter: Matching diagnostic was not found.");
          logComposition("Primitive quick-fix DONE result=missing-diagnostic");
        } else if (result === "missing-action") {
          vscode.window.showInformationMessage("SFP XML Linter: Matching quick fix action was not found.");
          logComposition("Primitive quick-fix DONE result=missing-action");
        } else if (result === "invalid") {
          logComposition("Primitive quick-fix DONE result=invalid");
        } else {
          logComposition("Primitive quick-fix DONE result=applied");
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.compositionShowUsages", async (node?: {
      usageLocations?: vscode.Location[];
      label?: string;
    }) => {
      const locations = node?.usageLocations ?? [];
      if (locations.length === 0) {
        vscode.window.showInformationMessage(`SFP XML Linter: No usages found for ${node?.label ?? "selected item"}.`);
        return;
      }

      if (locations.length === 1) {
        const [location] = locations;
        await vscode.window.showTextDocument(location.uri, {
          selection: location.range,
          preview: false
        });
        return;
      }

      const picks = locations.map((location) => {
        const relative = vscode.workspace.asRelativePath(location.uri, false);
        const line = location.range.start.line + 1;
        const column = location.range.start.character + 1;
        return {
          label: `${relative}:${line}:${column}`,
          description: node?.label,
          location
        };
      });

      const picked = await vscode.window.showQuickPick(picks, {
        title: `Usages of ${node?.label ?? "selected item"}`,
        matchOnDescription: true
      });
      if (!picked) {
        return;
      }

      await vscode.window.showTextDocument(picked.location.uri, {
        selection: picked.location.range,
        preview: false
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.rebuildIndex", async () => {
      const start = Date.now();
      await queueReindex("all");
      const durationMs = Date.now() - start;
      vscode.window.showInformationMessage(`SFP XML Linter index rebuilt in ${durationMs} ms.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.revalidateWorkspace", async () => {
      await revalidateWorkspaceFull();
    }),
    vscode.commands.registerCommand("sfpXmlLinter.revalidateProject", async () => {
      await revalidateCurrentProject();
    }),
    vscode.commands.registerCommand("sfpXmlLinter.switchProjectScopeToActiveFile", async () => {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (!active || active.scheme !== "file") {
        vscode.window.showInformationMessage("SFP XML Linter: Open an XML file from target project first.");
        return;
      }

      await switchActiveProjectScopeToUri(active);
      vscode.window.showInformationMessage("SFP XML Linter: Active project scope switched.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sfpXmlLinter.workspaceDiagnosticsReport", async () => {
      const output = vscode.window.createOutputChannel("SFP XML Linter");
      output.clear();
      output.appendLine("SFP XML Linter - Workspace Diagnostics Report");
      output.appendLine("");

      await templateIndexer.rebuildIndex();
      await runtimeIndexer.rebuildIndex();
      const uris = await globConfiguredXmlFiles();

      const byRule = new Map<string, number>();
      let total = 0;

      for (const uri of uris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const ds = engine.buildDiagnostics(doc, getIndexerForUri(uri).getIndex(), {
          parsedFacts: getIndexerForUri(uri).getIndex().parsedFactsByUri.get(uri.toString()),
          featureRegistry: featureRegistryStore.getRegistry()
        });
        if (ds.length === 0) {
          continue;
        }

        output.appendLine(`${vscode.workspace.asRelativePath(uri, false)} (${ds.length})`);
        for (const d of ds) {
          const rule = typeof d.code === "string" ? d.code : "unknown";
          byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
          total++;
          output.appendLine(`  - [${rule}] line ${d.range.start.line + 1}: ${d.message}`);
        }
      }

      output.appendLine("");
      output.appendLine(`Total diagnostics: ${total}`);
      output.appendLine("By rule:");
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        output.appendLine(`  ${rule}: ${count}`);
      }

      output.show(true);
    }),
    vscode.commands.registerCommand("sfpXmlLinter.formatDocumentTolerant", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor.");
        return;
      }

      if (editor.document.languageId !== "xml") {
        vscode.window.showInformationMessage("SFP XML Tolerant Formatter works only for XML documents.");
        return;
      }

      const startedAt = Date.now();
      const options = createFormatterOptions(editor.options, editor.document);
      const result = formatXmlTolerant(editor.document.getText(), options);
      const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, result.text);
      });
      const durationMs = Date.now() - startedAt;
      logFormatter(`FORMAT document done in ${durationMs} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`);
      vscode.window.setStatusBarMessage(
        `SFP XML Formatter: done in ${durationMs} ms (recoveries=${result.recoveries}, invalid=${result.invalidNodes})`,
        4000
      );
    }),
    vscode.commands.registerCommand("sfpXmlLinter.formatSelectionTolerant", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor.");
        return;
      }

      if (editor.document.languageId !== "xml") {
        vscode.window.showInformationMessage("SFP XML Tolerant Formatter works only for XML documents.");
        return;
      }

      const nonEmptySelections = editor.selections.filter((selection) => !selection.isEmpty);
      if (nonEmptySelections.length === 0) {
        vscode.window.showInformationMessage("No text selected.");
        return;
      }

      const startedAt = Date.now();
      const options = createFormatterOptions(editor.options, editor.document);
      const sortedSelections = [...nonEmptySelections].sort((a, b) => editor.document.offsetAt(b.start) - editor.document.offsetAt(a.start));
      let totalRecoveries = 0;
      let totalInvalidNodes = 0;
      await editor.edit((editBuilder) => {
        for (const selection of sortedSelections) {
          const result = formatRangeLikeDocument(editor.document, selection, options);
          totalRecoveries += result.recoveries;
          totalInvalidNodes += result.invalidNodes;
          editBuilder.replace(result.range, result.text);
        }
      });
      const durationMs = Date.now() - startedAt;
      logFormatter(
        `FORMAT selection done in ${durationMs} ms (selections=${sortedSelections.length}, recoveries=${totalRecoveries}, invalidNodes=${totalInvalidNodes})`
      );
      vscode.window.setStatusBarMessage(
        `SFP XML Formatter Selection: ${sortedSelections.length} selection(s), ${durationMs} ms`,
        4000
      );
    })
  );

  // Fast startup: index components + forms first for open-file responsiveness,
  // then perform
  // full index and background validation.
  void (async () => {
    ensureActiveProjectScopeInitialized();
    const hasRuntimeOpenAtStartup = getUserOpenUris().some((uri) => getXmlIndexDomainByUri(uri) === "runtime");
    await withReindexProgress("SFP XML Linter: Initial Bootstrap Indexing", async () => {
      await rebuildBootstrapIndexAndValidateOpenDocs({
        verboseProgress: true,
        includeRuntime: hasRuntimeOpenAtStartup
      });
    });
    scheduleDeferredFullReindex();
  })();
}

function createFormatterOptions(editorOptions: vscode.TextEditorOptions, document: vscode.TextDocument): FormatterOptions {
  const settings = getSettings();
  const tabSize = typeof editorOptions.tabSize === "number" ? editorOptions.tabSize : 2;
  const insertSpaces = editorOptions.insertSpaces !== false;
  const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";
  const lineEnding: "\n" | "\r\n" = document.getText().includes("\r\n") ? "\r\n" : "\n";
  return {
    indentUnit,
    lineEnding,
    tabSize,
    insertSpaces,
    maxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
    forceInlineAttributes: true,
    typeAttributeFirst: true
  };
}

function formatRangeLikeDocument(
  document: vscode.TextDocument,
  range: vscode.Range,
  options: FormatterOptions
): { text: string; recoveries: number; invalidNodes: number; range: vscode.Range } {
  const source = document.getText();
  const result = formatXmlSelectionWithContext(source, document.offsetAt(range.start), document.offsetAt(range.end), options);
  const text = result.text;
  return {
    text,
    recoveries: result.recoveries,
    invalidNodes: result.invalidNodes,
    range: new vscode.Range(document.positionAt(result.rangeStart), document.positionAt(result.rangeEnd))
  };
}

function createFormatterOptionsFromFormattingOptions(
  options: vscode.FormattingOptions,
  document: vscode.TextDocument
): FormatterOptions {
  const settings = getSettings();
  const tabSize = Number.isFinite(options.tabSize) ? Math.max(1, Math.floor(options.tabSize)) : 2;
  const indentUnit = options.insertSpaces ? " ".repeat(tabSize) : "\t";
  const lineEnding: "\n" | "\r\n" = document.getText().includes("\r\n") ? "\r\n" : "\n";
  return {
    indentUnit,
    lineEnding,
    tabSize,
    insertSpaces: !!options.insertSpaces,
    maxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
    forceInlineAttributes: true,
    typeAttributeFirst: true
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maxReindexScope(current: "none" | "bootstrap" | "all", next: "bootstrap" | "all"): "bootstrap" | "all" {
  if (current === "all" || next === "all") {
    return "all";
  }

  return "bootstrap";
}

export function deactivate(): void {
  // No-op
}

function isInsideSqlOrCommandBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
  return getEnclosingSqlOrCommandRegion(document, position) !== undefined;
}

function shouldAutoTriggerSqlSuggest(document: vscode.TextDocument, position: vscode.Position): boolean {
  const region = getEnclosingSqlOrCommandRegion(document, position);
  if (!region) {
    return false;
  }

  const text = document.getText();
  const offset = document.offsetAt(position);
  const beforeCursor = text.slice(region.openEnd, offset);
  const lastAt = beforeCursor.lastIndexOf("@");
  if (lastAt < 0) {
    return false;
  }

  const tail = beforeCursor.slice(lastAt + 1);
  if (!tail.length) {
    return true;
  }

  if (/\s/.test(tail)) {
    return false;
  }

  // Allow identifiers and optional inline value marker for @Ident==Value
  return /^[A-Za-z_][\w]*(?:==[^\s<>"']*)?$/.test(tail);
}

function getEnclosingSqlOrCommandRegion(
  document: vscode.TextDocument,
  position: vscode.Position
): { openEnd: number; closeStart: number } | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const openRegex = /<\s*(?:[A-Za-z_][\w.-]*:)?(SQL|Command)\b[^>]*>/gi;

  let lastOpen: RegExpExecArray | undefined;
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(text)) !== null) {
    if (match.index >= offset) {
      break;
    }

    lastOpen = match;
  }

  if (!lastOpen) {
    return undefined;
  }

  const openStart = lastOpen.index;
  const openEnd = openStart + lastOpen[0].length;
  if (offset < openEnd) {
    return undefined;
  }

  const tagMatch = /<\s*(?:[A-Za-z_][\w.-]*:)?(SQL|Command)\b/i.exec(lastOpen[0]);
  const tag = (tagMatch?.[1] ?? "").toLowerCase();
  if (!tag) {
    return undefined;
  }

  const closeRegex = new RegExp(`<\\s*\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, "i");
  const afterOpen = text.slice(openEnd);
  const close = closeRegex.exec(afterOpen);
  if (!close) {
    return undefined;
  }

  const closeStart = openEnd + close.index;
  if (offset > closeStart) {
    return undefined;
  }

  return { openEnd, closeStart };
}

function getUserOpenUris(): vscode.Uri[] {
  const map = new Map<string, vscode.Uri>();

  for (const editor of vscode.window.visibleTextEditors) {
    map.set(editor.document.uri.toString(), editor.document.uri);
  }

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (input.uri.scheme === "file") {
          map.set(input.uri.toString(), input.uri);
        }
        continue;
      }

      if (input instanceof vscode.TabInputTextDiff) {
        if (input.original.scheme === "file") {
          map.set(input.original.toString(), input.original);
        }
        if (input.modified.scheme === "file") {
          map.set(input.modified.toString(), input.modified);
        }
        continue;
      }
    }
  }

  return [...map.values()];
}

function isUserOpenDocument(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return getUserOpenUris().some((u) => u.toString() === key);
}

function collectBuildSelectionUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  if (Array.isArray(uris) && uris.length > 0) {
    return dedupeUris(uris);
  }

  if (Array.isArray(uri)) {
    return dedupeUris(uri);
  }

  if (uri) {
    return [uri];
  }

  return [];
}

function getActiveDocumentUriFallback(): vscode.Uri[] {
  const active = vscode.window.activeTextEditor?.document.uri;
  return active ? [active] : [];
}

function dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  for (const item of uris) {
    const key = item.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}

function isReindexRelevantUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
  if (!rel.endsWith(".xml")) {
    return false;
  }

  const settings = getSettings();
  return settings.workspaceRoots.some((root) => {
    const normalized = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (normalized.length === 0) {
      return false;
    }

    return rel === normalized || rel.startsWith(`${normalized}/`) || rel.includes(`/${normalized}/`);
  });
}

function isSfpSettingsUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  const fileName = uri.fsPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  return fileName === ".sfpxmlsetting" || fileName === ".sfpxmlsettings";
}

function getProjectKeyForUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== "file") {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  const relLower = rel.toLowerCase();
  const settings = getSettings();

  let bestRootStart = Number.MAX_SAFE_INTEGER;
  let matched = false;
  for (const root of settings.workspaceRoots) {
    const normalized = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!normalized) {
      continue;
    }

    if (relLower === normalized || relLower.startsWith(`${normalized}/`)) {
      matched = true;
      bestRootStart = 0;
      break;
    }

    const token = `/${normalized}/`;
    const idx = relLower.indexOf(token);
    if (idx < 0) {
      continue;
    }

    matched = true;
    const start = idx + 1;
    if (start < bestRootStart) {
      bestRootStart = start;
    }
  }

  if (!matched) {
    return undefined;
  }

  const prefix = bestRootStart <= 0 ? "." : rel.slice(0, bestRootStart - 1);
  const workspaceKey = workspaceFolder?.uri.fsPath ?? "__no_workspace__";
  return `${workspaceKey}|${prefix || "."}`;
}

async function readWorkspaceFileText(uri: vscode.Uri): Promise<string> {
  let text: string;
  if (uri.scheme === "file") {
    try {
      text = await fs.readFile(uri.fsPath, "utf8");
    } catch {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder("utf-8").decode(bytes);
    }
  } else {
    const bytes = await vscode.workspace.fs.readFile(uri);
    text = new TextDecoder("utf-8").decode(bytes);
  }

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function createVirtualXmlDocument(uri: vscode.Uri, text: string): vscode.TextDocument {
  const lineStarts = computeLineStarts(text);
  const lineCount = lineStarts.length;
  const doc = {
    uri,
    languageId: "xml",
    version: 0,
    lineCount,
    getText(range?: vscode.Range): string {
      if (!range) {
        return text;
      }

      const startOffset = this.offsetAt(range.start);
      const endOffset = this.offsetAt(range.end);
      return text.slice(startOffset, endOffset);
    },
    positionAt(offset: number): vscode.Position {
      return offsetToPosition(lineStarts, offset, text.length);
    },
    offsetAt(position: vscode.Position): number {
      const line = Math.max(0, Math.min(position.line, lineStarts.length - 1));
      const lineStart = lineStarts[line] ?? 0;
      return Math.max(0, Math.min(text.length, lineStart + Math.max(0, position.character)));
    },
    lineAt(lineOrPos: number | vscode.Position): vscode.TextLine {
      const rawLine = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line;
      const line = Math.max(0, Math.min(rawLine, lineCount - 1));
      const lineStart = lineStarts[line] ?? 0;
      const nextLineStart = line + 1 < lineCount ? lineStarts[line + 1] : text.length;
      const lineEndWithBreak = nextLineStart;

      // VS Code TextLine.text excludes trailing line break.
      let lineEnd = lineEndWithBreak;
      if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 10) {
        lineEnd--;
      }
      if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
        lineEnd--;
      }

      const lineText = text.slice(lineStart, lineEnd);
      const firstNonWhitespaceCharacterIndex = /\S/.test(lineText) ? (lineText.search(/\S/) ?? 0) : lineText.length;
      const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lineText.length));
      const rangeIncludingLineBreak = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, Math.max(0, lineEndWithBreak - lineStart))
      );

      return {
        lineNumber: line,
        text: lineText,
        range,
        rangeIncludingLineBreak,
        firstNonWhitespaceCharacterIndex,
        isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex >= lineText.length
      } as vscode.TextLine;
    }
  } as vscode.TextDocument;

  return doc;
}

function createIndexOnlyXmlDocument(uri: vscode.Uri): vscode.TextDocument {
  const doc = {
    uri,
    languageId: "xml",
    version: 0,
    getText(): string {
      return "";
    },
    positionAt(_offset: number): vscode.Position {
      return new vscode.Position(0, 0);
    },
    offsetAt(_position: vscode.Position): number {
      return 0;
    }
  } as vscode.TextDocument;

  return doc;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(lineStarts: readonly number[], offset: number, textLength: number): vscode.Position {
  const safe = Math.max(0, Math.min(offset, textLength));
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (safe < start) {
      high = mid - 1;
    } else if (safe >= nextStart) {
      low = mid + 1;
    } else {
      return new vscode.Position(mid, safe - start);
    }
  }

  const line = Math.max(0, Math.min(lineStarts.length - 1, low));
  const start = lineStarts[line] ?? 0;
  return new vscode.Position(line, safe - start);
}


