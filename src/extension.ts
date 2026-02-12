import * as vscode from "vscode";
import { WorkspaceIndexer, RebuildIndexProgressEvent } from "./indexer/workspaceIndexer";
import { DiagnosticsEngine } from "./diagnostics/engine";
import { documentInConfiguredRoots, getXmlIndexDomainByUri, XmlIndexDomain } from "./utils/paths";
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
import { getSettings } from "./config/settings";
import { parseDocumentFacts } from "./indexer/xmlFacts";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const DEBUG_PREFIX = "[SFP-DBG]";
  const diagnostics = vscode.languages.createDiagnosticCollection("sfpXmlLinter");
  const buildOutput = vscode.window.createOutputChannel("SFP XML Linter Build");
  const indexOutput = vscode.window.createOutputChannel("SFP XML Linter Index");
  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);
  const engine = new DiagnosticsEngine();
  const buildService = new BuildXmlTemplatesService();
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

  context.subscriptions.push(diagnostics);
  context.subscriptions.push(buildOutput);
  context.subscriptions.push(indexOutput);

  function logBuild(message: string): void {
    buildOutput.appendLine(`[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`);
  }

  function logIndex(message: string): void {
    indexOutput.appendLine(`[${new Date().toLocaleTimeString()}] ${DEBUG_PREFIX} ${message}`);
  }

  function formatIndexProgress(event: RebuildIndexProgressEvent): string {
    const rel = event.uri ? vscode.workspace.asRelativePath(event.uri, false) : undefined;
    switch (event.phase) {
      case "discover-start":
        return "PHASE discover: searching XML files...";
      case "discover-done":
        return `PHASE discover: found ${event.total ?? 0} files`;
      case "parse-progress":
        return `PHASE parse: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "components-start":
        return `PHASE components: start (${event.total ?? 0})`;
      case "components-progress":
        return `PHASE components: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "components-done":
        return `PHASE components: done (${event.total ?? 0})`;
      case "forms-start":
        return `PHASE forms: start (${event.total ?? 0})`;
      case "forms-progress":
        return `PHASE forms: ${event.current ?? 0}/${event.total ?? 0} ${rel ?? ""}`.trim();
      case "forms-done":
        return `PHASE forms: done (${event.total ?? 0})`;
      case "done":
        return `PHASE done: ${event.message ?? "index ready"}`;
      default:
        return event.message ?? event.phase;
    }
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

    for (const uri of uris) {
      enqueueValidation(uri, "low");
    }
  }

  async function runValidationWorker(): Promise<void> {
    if (isValidationWorkerRunning) {
      return;
    }

    isValidationWorkerRunning = true;
    try {
      let processed = 0;
      while (highPriorityValidationQueue.length > 0 || lowPriorityValidationQueue.length > 0) {
        const useHigh = highPriorityValidationQueue.length > 0;
        const key = useHigh ? highPriorityValidationQueue.shift() : lowPriorityValidationQueue.shift();
        if (!key) {
          continue;
        }

        if (useHigh) {
          highPriorityValidationSet.delete(key);
        } else {
          lowPriorityValidationSet.delete(key);
        }

        const uri = vscode.Uri.parse(key);
        await validateUri(uri);
        processed++;
        if (!useHigh && processed % 20 === 0) {
          await sleep(1);
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

  async function validateUri(uri: vscode.Uri): Promise<void> {
    const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    try {
      let document = existing;
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

  function validateOpenDocuments(): void {
    const targetUris = getUserOpenUris();

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
          }
        : undefined
    });

    await runtimeIndexer.rebuildIndex({
      onProgress: verbose
        ? (event) => {
            logIndex(`[runtime] ${formatIndexProgress(event)}`);
          }
        : undefined
    });

    if (verbose) {
      logIndex("Initial indexing DONE");
    }

    hasInitialIndex = true;
    validateOpenDocuments();
    if (!hasCompletedInitialWorkspaceValidation) {
      const uris = await globConfiguredXmlFiles();
      enqueueWorkspaceValidation(uris);
      hasCompletedInitialWorkspaceValidation = true;
      logIndex("Background workspace validation queued (first full index only).");
    }
  }

  async function rebuildBootstrapIndexAndValidateOpenDocs(options?: { verboseProgress?: boolean }): Promise<void> {
    const verbose = options?.verboseProgress === true;
    if (verbose) {
      logIndex("Bootstrap indexing START (components + forms)");
    }

    await templateIndexer.rebuildIndex({
      scope: "bootstrap",
      onProgress: verbose
        ? (event) => {
            logIndex(`[template] ${formatIndexProgress(event)}`);
          }
        : undefined
    });

    await runtimeIndexer.rebuildIndex({
      scope: "bootstrap",
      onProgress: verbose
        ? (event) => {
            logIndex(`[runtime] ${formatIndexProgress(event)}`);
          }
        : undefined
    });

    if (verbose) {
      logIndex("Bootstrap indexing DONE (components + forms)");
    }

    hasInitialIndex = true;
    validateOpenDocuments();
  }

  async function queueReindex(scope: "bootstrap" | "all"): Promise<void> {
    logIndex(`QUEUE reindex requested scope=${scope} running=${isReindexRunning}`);
    if (isReindexRunning) {
      queuedReindexScope = maxReindexScope(queuedReindexScope, scope);
      logIndex(`QUEUE reindex deferred scope=${queuedReindexScope}`);
      return;
    }

    isReindexRunning = true;
    const startedAt = Date.now();
    try {
      const verboseProgress = !hasShownInitialIndexReadyNotification;
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

  function scheduleDeferredFullReindex(delayMs = 1400): void {
    if (deferredFullReindexTimer) {
      clearTimeout(deferredFullReindexTimer);
    }

    deferredFullReindexTimer = setTimeout(() => {
      deferredFullReindexTimer = undefined;
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
    if (!documentInConfiguredRoots(document)) {
      diagnostics.delete(document.uri);
      return;
    }

    // Avoid noisy false positives during startup before the first full index exists.
    if (!hasInitialIndex) {
      diagnostics.delete(document.uri);
      return;
    }

    const result = engine.buildDiagnostics(document, getIndexerForUri(document.uri).getIndex());
    diagnostics.set(document.uri, result);
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

      validateDocument(document);
      if (isUserOpenDocument(document.uri)) {
        enqueueValidation(document.uri, "high");
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      pendingContentChangesSinceLastSave.add(event.document.uri.toString());
      validateDocument(event.document);
      if (isUserOpenDocument(event.document.uri)) {
        enqueueValidation(event.document.uri, "high");
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      validateOpenDocuments();
      for (const uri of getUserOpenUris()) {
        enqueueValidation(uri, "high");
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      validateOpenDocuments();
      for (const uri of getUserOpenUris()) {
        enqueueValidation(uri, "high");
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const saveKey = document.uri.toString();
      const hadContentChanges = pendingContentChangesSinceLastSave.has(saveKey);
      pendingContentChangesSinceLastSave.delete(saveKey);

      validateDocument(document);
      if (isUserOpenDocument(document.uri)) {
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
      if (event.files.some((uri) => isReindexRelevantUri(uri))) {
        void queueReindex("all");
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        diagnostics.delete(uri);
      }

      if (event.files.some((uri) => isReindexRelevantUri(uri))) {
        void queueReindex("all");
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const item of event.files) {
        diagnostics.delete(item.oldUri);
      }

      if (event.files.some((item) => isReindexRelevantUri(item.oldUri) || isReindexRelevantUri(item.newUri))) {
        void queueReindex("all");
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("sfpXmlLinter")) {
        documentationHoverResolver.markDirty();
        refreshHoverDocsWatchers();
        validateOpenDocuments();
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
      "="
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
    vscode.languages.registerCodeActionsProvider({ language: "xml" }, new SfpXmlIgnoreCodeActionProvider(), {
      providedCodeActionKinds: SfpXmlIgnoreCodeActionProvider.providedCodeActionKinds
    })
  );

  context.subscriptions.push(
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
    vscode.commands.registerCommand("sfpXmlLinter.rebuildIndex", async () => {
      const start = Date.now();
      await queueReindex("all");
      const durationMs = Date.now() - start;
      vscode.window.showInformationMessage(`SFP XML Linter index rebuilt in ${durationMs} ms.`);
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
        const ds = engine.buildDiagnostics(doc, getIndexerForUri(uri).getIndex());
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
    })
  );

  // Fast startup: index components + forms first for open-file responsiveness,
  // then perform
  // full index and background validation.
  void (async () => {
    await rebuildBootstrapIndexAndValidateOpenDocs({ verboseProgress: true });
    scheduleDeferredFullReindex();
  })();
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

function getUserOpenUris(): vscode.Uri[] {
  const map = new Map<string, vscode.Uri>();

  for (const editor of vscode.window.visibleTextEditors) {
    map.set(editor.document.uri.toString(), editor.document.uri);
  }

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        map.set(input.uri.toString(), input.uri);
        continue;
      }

      if (input instanceof vscode.TabInputTextDiff) {
        map.set(input.original.toString(), input.original);
        map.set(input.modified.toString(), input.modified);
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
