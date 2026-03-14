import * as vscode from "vscode";
import * as fs from "node:fs/promises";
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
import { parseDocumentFacts } from "./indexer/xmlFacts";
import { formatXmlTolerant } from "./formatter";
import { formatXmlSelectionWithContext } from "./formatter/selection";
import { FormatterOptions } from "./formatter/types";
import { WorkspaceIndex } from "./indexer/types";
import { SystemMetadata, getSystemMetadata } from "./config/systemMetadata";
import { FeatureRegistryStore } from "./composition/registry";
import { CompositionTreeProvider } from "./composition/treeView";

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
  "ident-convention-lookup-control"
]);

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const DEBUG_PREFIX = "[SFP-DBG]";
  const diagnostics = vscode.languages.createDiagnosticCollection("sfpXmlLinter");
  const buildOutput = vscode.window.createOutputChannel("SFP XML Linter Build");
  const indexOutput = vscode.window.createOutputChannel("SFP XML Linter Index");
  const formatterOutput = vscode.window.createOutputChannel("SFP XML Linter Formatter");
  const compositionOutput = vscode.window.createOutputChannel("SFP XML Linter Composition");
  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);
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

  function createBuildRunOptions(silent: boolean): {
    silent: boolean;
    onLogLine: (line: string) => void;
    onFileStatus: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => void;
  } {
    return {
      silent,
      onLogLine: (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return;
        }

        const processingMatch = /^\[(\d+)\/(\d+)\]\s+(.+)$/.exec(trimmed);
        if (processingMatch) {
          const [, current, total, relPath] = processingMatch;
          logBuild(`FILE ${current}/${total}: ${relPath}`);
          return;
        }

        if (/^(UPDATED|SKIPPED|ERROR\b)/i.test(trimmed)) {
          return;
        }

        if (/^Done\./i.test(trimmed) || /^Errors:/i.test(trimmed) || /^\[stderr\]/.test(trimmed)) {
          logBuild(trimmed);
        }
      },
      onFileStatus: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => {
        logBuild(`RESULT ${relativeTemplatePath}: ${status}`);
      }
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
      vscode.window.setStatusBarMessage(`SFP XML Linter: Indexace dokončena (${durationMs} ms)`, 4000);

      if (!hasShownInitialIndexReadyNotification) {
        hasShownInitialIndexReadyNotification = true;
        vscode.window.showInformationMessage(`SFP XML Linter: Úvodní indexace dokončena (${durationMs} ms).`);
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
    let executedBuild = false;
    let executedFullBuild = false;
    const builtTargetPaths = new Set<string>();
    try {
      do {
        if (queuedFullTemplateBuild) {
          queuedFullTemplateBuild = false;
          logBuild("BUILD START full templates");
          await buildService.run(workspaceFolder, createBuildRunOptions(true));
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
        await buildService.runForPath(workspaceFolder, nextPath, createBuildRunOptions(true));
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

    if (!isInFolder(document.uri, "XML_Components")) {
      return;
    }

    logBuild(`SAVE XML_Components: ${vscode.workspace.asRelativePath(document.uri, false)}`);
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
        logSingleFile(`validate standalone SKIP unchanged version: ${relOrPath} v${document.version}`);
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
      parsedFacts: getIndexerForUri(document.uri).getIndex().parsedFactsByUri.get(document.uri.toString()),
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
      validateDocument(document);
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

      if (!documentInConfiguredRoots(document)) {
        const relOrPath = document.uri.scheme === "file"
          ? vscode.workspace.asRelativePath(document.uri, false)
          : document.uri.toString();
        logSingleFile(`onDidCloseTextDocument: ${relOrPath}`);
        diagnostics.delete(document.uri);
        standaloneValidationVersionByUri.delete(document.uri.toString());
        indexedValidationLogSignatureByUri.delete(document.uri.toString());
        logSingleFile(`closed standalone file, diagnostics cleared: ${relOrPath}`);
      }
      compositionTreeProvider.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleSqlSuggestOnTyping(event);
      pendingContentChangesSinceLastSave.add(event.document.uri.toString());
      validateDocument(event.document);
      compositionTreeProvider.refresh();
      if (isUserOpenDocument(event.document.uri) && documentInConfiguredRoots(event.document)) {
        enqueueValidation(event.document.uri, "high");
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      validateOpenDocuments();
      clearClosedStandaloneDiagnostics();
      compositionTreeProvider.refresh();
      for (const uri of getUserOpenUris()) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (!doc || !documentInConfiguredRoots(doc)) {
          continue;
        }
        enqueueValidation(uri, "high");
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      validateOpenDocuments();
      clearClosedStandaloneDiagnostics();
      compositionTreeProvider.refresh();
      for (const uri of getUserOpenUris()) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (!doc || !documentInConfiguredRoots(doc)) {
          continue;
        }
        enqueueValidation(uri, "high");
      }
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

      validateDocument(document);
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
        const selection = collectBuildSelectionUris(uri, uris);
        const targetUris = selection.length > 0 ? selection : getActiveDocumentUriFallback();

        if (targetUris.length === 0) {
          logBuild("No current/selected resource -> FULL fallback");
          await buildService.run(folder, createBuildRunOptions(false));
          await queueReindex("all");
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

          if (isInFolder(targetUri, "XML_Components")) {
            const dependentTemplates = await buildService.findTemplatesUsingComponent(folder, targetUri.fsPath);
            if (dependentTemplates.length === 0) {
              usedFullFallback = true;
              logBuild(
                `Selection in XML_Components has no dependents: ${vscode.workspace.asRelativePath(targetUri, false)} -> FULL fallback`
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
          await buildService.run(folder, createBuildRunOptions(false));
          await queueReindex("all");
          logBuild("MANUAL build current/selection DONE (full fallback)");
          return;
        }

        for (const targetPath of templateTargets) {
          logBuild(`MANUAL target build: ${vscode.workspace.asRelativePath(targetPath, false)}`);
          await buildService.runForPath(folder, targetPath, createBuildRunOptions(false));
        }
        await queueReindex("all");

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
        await buildService.run(folder, createBuildRunOptions(false));
        await queueReindex("all");
        logBuild("MANUAL build all DONE");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`BuildXmlTemplates (all) failed: ${message}`);
        logBuild(`MANUAL build all ERROR: ${message}`);
      }
    })
  );

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

