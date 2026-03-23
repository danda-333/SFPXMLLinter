import * as vscode from "vscode";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  buildComponentLibrary,
  extractUsingComponentRefs,
  normalizePath,
  renderTemplateWithTrace,
  stripXmlComponentExtension,
  type RenderTemplateResult
} from "./buildXmlTemplatesCore";
import type { TemplateMutationRecord } from "./buildXmlTemplatesCore";
import { applyTemplateOutputQuality, TemplateBuilderProvenanceMode } from "./outputQuality";
import { runTemplateGenerators } from "./generators";
import { computeWorkspaceUserGeneratorsSignature, loadWorkspaceUserGenerators } from "./generators/userGeneratorLoader";

const DEFAULT_TEMPLATE_GENERATOR_TIMEOUT_MS = 2000;
const FATAL_GENERATOR_WARNING_CODES = new Set<string>([
  "generator-timeout",
  "generator-snippet-guard",
  "generator-snippet-not-found",
  "generator-run-failed",
  "generator-unresolved-snippet"
]);

export interface BuildRunOptions {
  silent?: boolean;
  mode?: "fast" | "debug" | "release";
  postBuildFormat?: boolean;
  legacyTagAliasesEnabled?: boolean;
  provenanceMode?: TemplateBuilderProvenanceMode;
  provenanceLabel?: string;
  formatterMaxConsecutiveBlankLines?: number;
  generatorsEnabled?: boolean;
  generatorTimeoutMs?: number;
  generatorEnableUserScripts?: boolean;
  generatorUserScriptsRoots?: string[];
  onLogLine?: (line: string) => void;
  onFileStatus?: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => void;
  onTemplateEvaluated?: (
    relativeTemplatePath: string,
    status: "update" | "nochange" | "error",
    templateText: string,
    debugLines: readonly string[]
  ) => void;
  onTemplateMutations?: (
    relativeTemplatePath: string,
    outputRelativePath: string,
    outputFsPath: string,
    mutations: readonly TemplateMutationRecord[],
    renderedOutputText?: string
  ) => void;
  onPerformanceStats?: (stats: BuildRunPerformanceStats) => void;
  buildConcurrency?: number;
  inheritedUsingsByFormIdent?: ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]>;
}

export interface BuildRunSummary {
  updated: number;
  skipped: number;
  errors: number;
}

export interface BuildRunResult {
  summary?: BuildRunSummary;
}

export interface BuildRunIoStats {
  readCount: number;
  readBytes: number;
  readMs: number;
  readWallMs: number;
  writeCount: number;
  writeBytes: number;
  writeMs: number;
  writeWallMs: number;
  statCount: number;
  statMs: number;
  statWallMs: number;
}

export interface BuildRunPerformanceStats {
  durationMs: number;
  templates: number;
  summary: BuildRunSummary;
  cache: {
    fastHit: number;
    fastMiss: number;
    traceHit: number;
    traceMiss: number;
    componentLibrary: "hit" | "miss";
  };
  io: BuildRunIoStats;
}

export interface TemplateMutationTelemetryEntry {
  relativeTemplatePath: string;
  outputRelativePath: string;
  outputFsPath: string;
  mutations: readonly TemplateMutationRecord[];
  renderedOutputText?: string;
}

interface ParsedTemplateRoot {
  rootTag: string;
  formIdent?: string;
}

interface ParsedUsingEntry {
  featureKey: string;
  contributionKey?: string;
  suppressInheritance: boolean;
  attributes: ReadonlyArray<{ name: string; value: string }>;
}

interface CachedTemplateTraceResult {
  signature: string;
  templateText: string;
  renderResult: RenderTemplateResult;
}

interface CachedTemplateBuildResult {
  fastSignature: string;
  templateText: string;
  debugLines: readonly string[];
  mutations: readonly TemplateMutationRecord[];
  renderedOutputText?: string;
  outputRelativePath: string;
  outputFsPath: string;
  outputMtimeMs: number;
  outputSize: number;
}

interface CachedComponentLibrarySnapshot {
  signature: string;
  library: ReturnType<typeof buildComponentLibrary>;
  sourceByKey: Map<string, { text: string; origin: string }>;
  cacheHit: boolean;
  dirty: boolean;
  dirtyPaths?: Set<string>;
}

interface BuildCacheStats {
  fastHit: number;
  fastMiss: number;
  traceHit: number;
  traceMiss: number;
}

export interface TemplateInheritedUsingEntry {
  featureKey: string;
  contributionKey?: string;
  suppressInheritance?: boolean;
  attributes?: ReadonlyArray<{ name: string; value: string }>;
  rawComponentValue?: string;
}

export class BuildXmlTemplatesService {
  private readonly componentLibraryCacheByWorkspace = new Map<string, CachedComponentLibrarySnapshot>();
  private readonly templateTraceCache = new Map<string, CachedTemplateTraceResult>();
  private readonly templateBuildFastCache = new Map<string, CachedTemplateBuildResult>();

  public invalidateComponentLibraryCache(workspaceFolder: vscode.WorkspaceFolder, changedPath?: string): void {
    const workspaceKey = workspaceKeyFromFolder(workspaceFolder);
    const cached = this.componentLibraryCacheByWorkspace.get(workspaceKey);
    if (!cached) {
      return;
    }
    cached.dirty = true;
    if (changedPath && changedPath.trim().length > 0) {
      const dirtyPaths = cached.dirtyPaths ?? new Set<string>();
      dirtyPaths.add(normalizePath(changedPath));
      cached.dirtyPaths = dirtyPaths;
    }
    this.componentLibraryCacheByWorkspace.set(workspaceKey, cached);
  }

  public async collectTemplateMutationTelemetry(
    workspaceFolder: vscode.WorkspaceFolder,
    options: BuildRunOptions = {},
    targetPath?: string
  ): Promise<TemplateMutationTelemetryEntry[]> {
    const templateUris = await collectTemplateTargets(workspaceFolder, targetPath);
    if (templateUris.length === 0) {
      return [];
    }

    const componentLibrarySnapshot = await this.buildWorkspaceComponentLibrary(workspaceFolder);
    const componentLibrary = componentLibrarySnapshot.library;
    const out: TemplateMutationTelemetryEntry[] = [];
    for (const templateUri of templateUris) {
      const relPath = relativeTemplatePath(workspaceFolder, templateUri);
      const templateText = await readWorkspaceTextFile(templateUri);
      const inheritedUsingsXml = buildInheritedUsingsXml(templateText, options.inheritedUsingsByFormIdent);
      const renderResult = this.getOrCreateTemplateTraceResult(
        workspaceFolder,
        relPath,
        templateText,
        componentLibrary,
        componentLibrarySnapshot.signature,
        options.legacyTagAliasesEnabled !== false,
        inheritedUsingsXml,
        undefined,
        options.mode === "debug" ? options.onLogLine : undefined
      );
      const outputUri = templateToRuntimeUri(templateUri);
      const outputRelativePath = vscode.workspace.asRelativePath(outputUri, false).replace(/\\/g, "/");
      out.push({
        relativeTemplatePath: relPath,
        outputRelativePath,
        outputFsPath: outputUri.fsPath,
        mutations: renderResult.mutations
      });
    }

    return out;
  }

  public async renderTemplateToFinalXml(
    workspaceFolder: vscode.WorkspaceFolder,
    templateUri: vscode.Uri,
    options: BuildRunOptions = {},
    templateTextOverride?: string
  ): Promise<string> {
    const componentLibrarySnapshot = await this.buildWorkspaceComponentLibrary(workspaceFolder);
    const componentLibrary = componentLibrarySnapshot.library;
    const relPath = relativeTemplatePath(workspaceFolder, templateUri);
    const templateText = templateTextOverride ?? await readWorkspaceTextFile(templateUri);
    const inheritedUsingsXml = buildInheritedUsingsXml(templateText, options.inheritedUsingsByFormIdent);
    const renderedRaw = this.getOrCreateTemplateTraceResult(
      workspaceFolder,
      relPath,
      templateText,
      componentLibrary,
      componentLibrarySnapshot.signature,
      options.legacyTagAliasesEnabled !== false,
      inheritedUsingsXml,
      undefined,
      options.mode === "debug" ? options.onLogLine : undefined
    ).xml;

    const userGenerators = options.generatorEnableUserScripts === false
      ? []
      : await loadWorkspaceUserGenerators(
          workspaceFolder.uri.fsPath,
          options.generatorUserScriptsRoots ?? ["XML_Generators"],
          options.onLogLine
        );

    const generated = runTemplateGenerators(
      {
        xml: renderedRaw,
        sourceTemplateText: templateText,
        relativeTemplatePath: relPath,
        mode: options.mode ?? "debug"
      },
      {
        enabled: options.generatorsEnabled !== false,
        timeoutMs: Math.max(50, options.generatorTimeoutMs ?? DEFAULT_TEMPLATE_GENERATOR_TIMEOUT_MS),
        userGenerators
      },
      options.onLogLine
    );

    return applyTemplateOutputQuality(generated.xml, templateText, {
      postBuildFormat: options.postBuildFormat === true,
      provenanceMode: options.provenanceMode ?? "off",
      provenanceLabel: options.provenanceLabel,
      relativeTemplatePath: relPath,
      formatterMaxConsecutiveBlankLines: Math.max(0, options.formatterMaxConsecutiveBlankLines ?? 2)
    });
  }

  public async run(workspaceFolder: vscode.WorkspaceFolder, options: BuildRunOptions = {}): Promise<BuildRunResult> {
    return this.runInternal(workspaceFolder, undefined, options);
  }

  public async runForPath(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
    options: BuildRunOptions = {}
  ): Promise<BuildRunResult> {
    return this.runInternal(workspaceFolder, targetPath, options);
  }

  public async runForPaths(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPaths: readonly string[],
    options: BuildRunOptions = {}
  ): Promise<BuildRunResult> {
    return this.runInternal(workspaceFolder, [...targetPaths], options);
  }

  public async findTemplatesUsingComponent(
    workspaceFolder: vscode.WorkspaceFolder,
    componentFilePath: string,
    legacyTagAliasesEnabled = true
  ): Promise<string[]> {
    const normalizedComponentPath = normalizePath(componentFilePath);
    const componentsRoot = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Components"));
    const primitivesRoot = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Primitives"));
    if (!normalizedComponentPath.startsWith(`${componentsRoot}/`) && !normalizedComponentPath.startsWith(`${primitivesRoot}/`)) {
      return [];
    }

    const rel = normalizedComponentPath.startsWith(`${componentsRoot}/`)
      ? normalizedComponentPath.slice(componentsRoot.length + 1)
      : normalizedComponentPath.slice(primitivesRoot.length + 1);
    const relNoExt = stripXmlComponentExtension(rel);
    const targetBaseName = relNoExt.split("/").pop() ?? relNoExt;

    const templateUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Templates/**/*.xml"));
    const exact = new Set<string>();
    const byBaseName = new Set<string>();

    for (const uri of templateUris) {
      const text = await readWorkspaceTextFile(uri);
      for (const usingRef of extractUsingComponentRefs(text, { legacyTagAliasesEnabled })) {
        if (usingRef === relNoExt) {
          exact.add(uri.fsPath);
          break;
        }
        if (usingRef.split("/").pop() === targetBaseName) {
          byBaseName.add(uri.fsPath);
        }
      }
    }

    const out = exact.size > 0 ? [...exact] : [...byBaseName];
    return out.sort((a, b) => a.localeCompare(b));
  }

  private async runInternal(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPathOrPaths: string | readonly string[] | undefined,
    options: BuildRunOptions
  ): Promise<BuildRunResult> {
    const runStartedAt = Date.now();
    const ioStats = createEmptyIoStats();
    const templateUris = await collectTemplateTargets(workspaceFolder, targetPathOrPaths);
    const componentLibrarySnapshot = await this.buildWorkspaceComponentLibrary(workspaceFolder, ioStats);
    const componentLibrary = componentLibrarySnapshot.library;
    const cacheStats: BuildCacheStats = {
      fastHit: 0,
      fastMiss: 0,
      traceHit: 0,
      traceMiss: 0
    };
    const workspaceKey = workspaceKeyFromFolder(workspaceFolder);
    const inheritedUsingsSignature = computeInheritedUsingsSignature(options.inheritedUsingsByFormIdent);
    const generatorUserScriptsRoots = options.generatorUserScriptsRoots ?? ["XML_Generators"];
    const generatorScriptsSignature = options.generatorEnableUserScripts === false
      ? "disabled"
      : computeWorkspaceUserGeneratorsSignature(workspaceFolder.uri.fsPath, generatorUserScriptsRoots);
    const runSettingsSignature = computeRunSettingsSignature(options, inheritedUsingsSignature, generatorScriptsSignature);

    const userGenerators = options.generatorEnableUserScripts === false
      ? []
      : await loadWorkspaceUserGenerators(
          workspaceFolder.uri.fsPath,
          generatorUserScriptsRoots,
          options.onLogLine
        );
    const summary: BuildRunSummary = { updated: 0, skipped: 0, errors: 0 };
    const total = templateUris.length;
    let current = 0;
    const isTargetedBuild = !!targetPathOrPaths;
    const desiredConcurrency = Math.max(1, Math.trunc(options.buildConcurrency ?? (isTargetedBuild ? 4 : 2)));
    const concurrency = Math.min(desiredConcurrency, Math.max(1, total));

    await forEachWithConcurrency(templateUris, concurrency, async (templateUri) => {
      current++;
      const relPath = relativeTemplatePath(workspaceFolder, templateUri);
      options.onLogLine?.(`[${current}/${total}] ${relPath}`);

      try {
        const templateText = await readWorkspaceTextFileTracked(templateUri, ioStats);
        const inheritedUsingsXml = buildInheritedUsingsXml(templateText, options.inheritedUsingsByFormIdent);
        const fastSignature = hashText([
          `component:${componentLibrarySnapshot.signature}`,
          `run:${runSettingsSignature}`,
          `template:${templateUri.toString()}`,
          `template-content:${templateText}`,
          `inherited:${inheritedUsingsXml ?? ""}`
        ].join("\n"));
        const outputUri = templateToRuntimeUri(templateUri);
        const outputRelativePath = vscode.workspace.asRelativePath(outputUri, false).replace(/\\/g, "/");
        const fastCacheKey = `${workspaceKey}::${normalizePath(templateUri.fsPath)}`;
        const fastCacheHit = await this.tryFastSkipFromCache(fastCacheKey, fastSignature, outputUri, relPath, options, summary, ioStats);
        if (fastCacheHit) {
          cacheStats.fastHit++;
          return;
        }
        cacheStats.fastMiss++;

        const debugLines: string[] = [];
        const debugMode = options.mode === "debug";
        const renderResult = this.getOrCreateTemplateTraceResult(
          workspaceFolder,
          relPath,
          templateText,
          componentLibrary,
          componentLibrarySnapshot.signature,
          options.legacyTagAliasesEnabled !== false,
          inheritedUsingsXml,
          cacheStats,
          debugMode
            ? (line) => {
                debugLines.push(line);
                options.onLogLine?.(`DEBUG: ${line}`);
              }
            : undefined
        );
        const renderedRaw = renderResult.xml;
        const generated = runTemplateGenerators(
          {
            xml: renderedRaw,
            sourceTemplateText: templateText,
            relativeTemplatePath: relPath,
            mode: options.mode ?? "debug"
          },
          {
            enabled: options.generatorsEnabled !== false,
            timeoutMs: Math.max(50, options.generatorTimeoutMs ?? DEFAULT_TEMPLATE_GENERATOR_TIMEOUT_MS),
            userGenerators
          },
          options.onLogLine
        );
        const generatorWarnings = [...generated.warnings];
        const generatorTimedOut = generatorWarnings.some((warning) => warning.code === "generator-timeout");
        const unresolvedGeneratorSnippets = countGeneratorSnippets(generated.xml);
        if (unresolvedGeneratorSnippets > 0) {
          generatorWarnings.push({
            code: "generator-unresolved-snippet",
            message: `'${relPath}' contains ${unresolvedGeneratorSnippets} unresolved <GeneratorSnippet> block(s) after generator stage.`
          });
        }
        for (const warning of generatorWarnings) {
          options.onLogLine?.(`[generator][warning] ${warning.code}: ${warning.message}`);
        }
        const fatalGeneratorWarnings = generatorWarnings.filter((warning) =>
          FATAL_GENERATOR_WARNING_CODES.has(warning.code)
        );
        if (fatalGeneratorWarnings.length > 0) {
          throw new Error(
            `Generator stage failed for '${relPath}': ${fatalGeneratorWarnings
              .map((warning) => `${warning.code}: ${warning.message}`)
              .join(" | ")}`
          );
        }
        const allowFastCache = !generatorTimedOut && unresolvedGeneratorSnippets === 0;
        if ((options.mode ?? "debug") === "debug") {
          options.onLogLine?.(
            `[generator] summary: applied=${generated.appliedGeneratorIds.length}, warnings=${generatorWarnings.length}, duration=${generated.durationMs} ms`
          );
        }

        const rendered = applyTemplateOutputQuality(generated.xml, templateText, {
          postBuildFormat: options.postBuildFormat === true,
          provenanceMode: options.provenanceMode ?? "off",
          provenanceLabel: options.provenanceLabel,
          relativeTemplatePath: relPath,
          formatterMaxConsecutiveBlankLines: Math.max(0, options.formatterMaxConsecutiveBlankLines ?? 2)
        });
        const existing = await readWorkspaceTextFileTracked(outputUri, ioStats).catch(() => undefined);

        if (existing === rendered) {
          summary.skipped++;
          options.onLogLine?.("SKIPPED");
          options.onFileStatus?.(relPath, "nochange");
          options.onTemplateEvaluated?.(relPath, "nochange", templateText, debugLines);
          options.onTemplateMutations?.(relPath, outputRelativePath, outputUri.fsPath, renderResult.mutations, rendered);
          if (allowFastCache) {
            await this.updateFastCacheEntry(
              fastCacheKey,
              fastSignature,
              outputUri,
              templateText,
              debugLines,
              outputRelativePath,
              renderResult.mutations,
              rendered,
              ioStats
            );
          } else {
            this.templateBuildFastCache.delete(fastCacheKey);
          }
          return;
        }

        await ensureParentDirectory(outputUri);
        await writeWorkspaceTextFileTracked(outputUri, rendered, ioStats);
        summary.updated++;
        options.onLogLine?.("UPDATED");
        options.onFileStatus?.(relPath, "update");
        options.onTemplateEvaluated?.(relPath, "update", templateText, debugLines);
        options.onTemplateMutations?.(relPath, outputRelativePath, outputUri.fsPath, renderResult.mutations, rendered);
        if (allowFastCache) {
          await this.updateFastCacheEntry(
            fastCacheKey,
            fastSignature,
            outputUri,
            templateText,
            debugLines,
            outputRelativePath,
            renderResult.mutations,
            rendered,
            ioStats
          );
        } else {
          this.templateBuildFastCache.delete(fastCacheKey);
        }
      } catch (error) {
        summary.errors++;
        const message = error instanceof Error ? error.message : String(error);
        options.onLogLine?.(`ERROR: ${message}`);
        options.onFileStatus?.(relPath, "error");
      }
    });

    options.onLogLine?.(
      `Done. Updated: ${summary.updated}, Skipped: ${summary.skipped}, Errors: ${summary.errors}, Cache: fast=${cacheStats.fastHit}/${cacheStats.fastHit + cacheStats.fastMiss}, trace=${cacheStats.traceHit}/${cacheStats.traceHit + cacheStats.traceMiss}, componentLibrary=${componentLibrarySnapshot.cacheHit ? "hit" : "miss"}`
    );
    options.onPerformanceStats?.({
      durationMs: Date.now() - runStartedAt,
      templates: templateUris.length,
      summary,
      cache: {
        fastHit: cacheStats.fastHit,
        fastMiss: cacheStats.fastMiss,
        traceHit: cacheStats.traceHit,
        traceMiss: cacheStats.traceMiss,
        componentLibrary: componentLibrarySnapshot.cacheHit ? "hit" : "miss"
      },
      io: ioStats
    });

    if (!options.silent) {
      const summaryText = formatSummaryText(summary);
      const notify = (message: string): void => {
        if (summary.errors > 0) {
          vscode.window.showErrorMessage(message);
        } else {
          vscode.window.showInformationMessage(message);
        }
      };
      if (Array.isArray(targetPathOrPaths) && targetPathOrPaths.length > 0) {
        notify(`BuildXmlTemplates finished for ${targetPathOrPaths.length} template(s). ${summaryText}`);
      } else if (typeof targetPathOrPaths === "string" && targetPathOrPaths.trim().length > 0) {
        notify(`BuildXmlTemplates finished for: ${path.basename(targetPathOrPaths)}. ${summaryText}`);
      } else {
        notify(`BuildXmlTemplates finished for all templates. ${summaryText}`);
      }
    }

    return { summary };
  }

  private async buildWorkspaceComponentLibrary(
    workspaceFolder: vscode.WorkspaceFolder,
    ioStats?: BuildRunIoStats
  ): Promise<CachedComponentLibrarySnapshot> {
    const workspaceKey = workspaceKeyFromFolder(workspaceFolder);
    const cached = this.componentLibraryCacheByWorkspace.get(workspaceKey);
    if (cached && !cached.dirty) {
      return {
        signature: cached.signature,
        library: cached.library,
        sourceByKey: cached.sourceByKey,
        cacheHit: true,
        dirty: false,
        dirtyPaths: cached.dirtyPaths
      };
    }
    if (cached?.dirty && cached.sourceByKey && cached.sourceByKey.size > 0 && cached.dirtyPaths && cached.dirtyPaths.size > 0) {
      const sourceByKey = new Map(cached.sourceByKey);
      for (const dirtyPath of cached.dirtyPaths) {
        const key = componentLikeKeyFromFsPath(workspaceFolder, dirtyPath);
        if (!key) {
          continue;
        }
        try {
          const text = await readWorkspaceTextFileTracked(vscode.Uri.file(dirtyPath), ioStats);
          sourceByKey.set(key, { text, origin: dirtyPath });
        } catch {
          sourceByKey.delete(key);
        }
      }
      const componentSources = [...sourceByKey.entries()]
        .map(([key, value]) => ({ key, text: value.text, origin: value.origin }))
        .sort((a, b) => a.key.localeCompare(b.key));
      const signature = hashText(componentSources.map((item) => `${item.key}:${hashText(item.text)}`).join(";"));
      const snapshot: CachedComponentLibrarySnapshot = {
        signature,
        library: buildComponentLibrary(componentSources),
        sourceByKey,
        cacheHit: false,
        dirty: false,
        dirtyPaths: new Set()
      };
      this.componentLibraryCacheByWorkspace.set(workspaceKey, snapshot);
      return snapshot;
    }
    const componentUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Components/**/*.xml"));
    const primitiveUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Primitives/**/*.xml"));
    const allUris = [...componentUris, ...primitiveUris];
    const componentSources: Array<{ key: string; text: string; origin: string }> = [];
    const sourceByKey = new Map<string, { text: string; origin: string }>();
    for (const uri of allUris) {
      const key = componentLikeKeyFromUri(workspaceFolder, uri);
      if (!key) {
        continue;
      }
      const text = await readWorkspaceTextFileTracked(uri, ioStats);
      componentSources.push({
        key,
        text,
        origin: uri.fsPath
      });
      sourceByKey.set(key, { text, origin: uri.fsPath });
    }
    componentSources.sort((a, b) => a.key.localeCompare(b.key));
    const signature = hashText(componentSources.map((item) => `${item.key}:${hashText(item.text)}`).join(";"));
    const snapshot: CachedComponentLibrarySnapshot = {
      signature,
      library: buildComponentLibrary(componentSources),
      sourceByKey,
      cacheHit: false,
      dirty: false,
      dirtyPaths: new Set()
    };
    this.componentLibraryCacheByWorkspace.set(workspaceKey, snapshot);
    return snapshot;
  }

  private getOrCreateTemplateTraceResult(
    workspaceFolder: vscode.WorkspaceFolder,
    relativeTemplatePath: string,
    templateText: string,
    componentLibrary: ReturnType<typeof buildComponentLibrary>,
    componentLibrarySignature: string,
    legacyTagAliasesEnabled: boolean,
    inheritedUsingsXml?: string,
    cacheStats?: BuildCacheStats,
    onDebugLog?: (line: string) => void
  ): RenderTemplateResult {
    const cacheSignature = hashText([
      workspaceKeyFromFolder(workspaceFolder),
      relativeTemplatePath,
      componentLibrarySignature,
      `legacy:${legacyTagAliasesEnabled ? "1" : "0"}`,
      templateText,
      inheritedUsingsXml ?? ""
    ].join("\n"));
    const cached = this.templateTraceCache.get(cacheSignature);
    if (cached && cached.signature === cacheSignature && cached.templateText === templateText) {
      cacheStats && (cacheStats.traceHit += 1);
      return cached.renderResult;
    }
    cacheStats && (cacheStats.traceMiss += 1);

    const renderResult = renderTemplateWithTrace(
      templateText,
      componentLibrary,
      12,
      onDebugLog,
      inheritedUsingsXml,
      { legacyTagAliasesEnabled }
    );
    this.templateTraceCache.set(cacheSignature, {
      signature: cacheSignature,
      templateText,
      renderResult
    });
    return renderResult;
  }

  private async tryFastSkipFromCache(
    fastCacheKey: string,
    fastSignature: string,
    outputUri: vscode.Uri,
    relativeTemplatePath: string,
    options: BuildRunOptions,
    summary: BuildRunSummary,
    ioStats?: BuildRunIoStats
  ): Promise<boolean> {
    const cached = this.templateBuildFastCache.get(fastCacheKey);
    if (!cached || cached.fastSignature !== fastSignature) {
      return false;
    }

    const outputStat = await safeStatTracked(outputUri, ioStats);
    if (!outputStat) {
      return false;
    }
    if (cached.outputMtimeMs !== outputStat.mtime || cached.outputSize !== outputStat.size) {
      return false;
    }

    summary.skipped++;
    options.onLogLine?.("SKIPPED (cache)");
    options.onFileStatus?.(relativeTemplatePath, "nochange");
    options.onTemplateEvaluated?.(relativeTemplatePath, "nochange", cached.templateText, cached.debugLines);
    options.onTemplateMutations?.(
      relativeTemplatePath,
      cached.outputRelativePath,
      cached.outputFsPath,
      cached.mutations,
      cached.renderedOutputText
    );
    return true;
  }

  private async updateFastCacheEntry(
    fastCacheKey: string,
    fastSignature: string,
    outputUri: vscode.Uri,
    templateText: string,
    debugLines: readonly string[],
    outputRelativePath: string,
    mutations: readonly TemplateMutationRecord[],
    renderedOutputText: string | undefined,
    ioStats?: BuildRunIoStats
  ): Promise<void> {
    const stat = await safeStatTracked(outputUri, ioStats);
    if (!stat) {
      return;
    }
    this.templateBuildFastCache.set(fastCacheKey, {
      fastSignature,
      templateText,
      debugLines: [...debugLines],
      mutations: [...mutations],
      renderedOutputText,
      outputRelativePath,
      outputFsPath: outputUri.fsPath,
      outputMtimeMs: stat.mtime,
      outputSize: stat.size
    });
  }
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
    runners.push(
      (async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) {
            return;
          }
          await worker(items[index], index);
        }
      })()
    );
  }

  await Promise.all(runners);
}

async function collectTemplateTargets(
  workspaceFolder: vscode.WorkspaceFolder,
  targetPathOrPaths: string | readonly string[] | undefined
): Promise<vscode.Uri[]> {
  if (Array.isArray(targetPathOrPaths) && targetPathOrPaths.length > 0) {
    const out = new Map<string, vscode.Uri>();
    for (const item of targetPathOrPaths) {
      const templateUri = resolveMaybeTemplateUri(item);
      if (!templateUri) {
        continue;
      }
      out.set(templateUri.fsPath.toLowerCase(), templateUri);
    }
    return [...out.values()];
  }

  if (typeof targetPathOrPaths === "string" && targetPathOrPaths.trim().length > 0) {
    const maybeTemplate = resolveMaybeTemplateUri(targetPathOrPaths);
    if (maybeTemplate) {
      return [maybeTemplate];
    }
  }

  return vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Templates/**/*.xml"));
}

function resolveMaybeTemplateUri(targetPath: string): vscode.Uri | undefined {
  const normalized = normalizePath(targetPath);
  const maybeTemplate = normalized.toLowerCase().includes("/xml_templates/")
    ? vscode.Uri.file(targetPath)
    : normalized.toLowerCase().includes("/xml/")
      ? vscode.Uri.file(targetPath.replace(/[\\/]XML[\\/]/i, `${path.sep}XML_Templates${path.sep}`))
      : undefined;
  if (maybeTemplate && maybeTemplate.fsPath.toLowerCase().endsWith(".xml")) {
    return maybeTemplate;
  }
  return undefined;
}

function componentLikeKeyFromUri(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const root = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Components"));
  const primitivesRoot = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Primitives"));
  const current = normalizePath(uri.fsPath);
  if (current.startsWith(`${root}/`)) {
    const rel = current.slice(root.length + 1);
    return stripXmlComponentExtension(rel);
  }
  if (current.startsWith(`${primitivesRoot}/`)) {
    const rel = current.slice(primitivesRoot.length + 1);
    return stripXmlComponentExtension(rel);
  }
  return undefined;
}

function relativeTemplatePath(workspaceFolder: vscode.WorkspaceFolder, templateUri: vscode.Uri): string {
  const rel = normalizePath(path.relative(path.join(workspaceFolder.uri.fsPath, "XML_Templates"), templateUri.fsPath));
  return rel.length > 0 ? rel : vscode.workspace.asRelativePath(templateUri, false);
}

function templateToRuntimeUri(templateUri: vscode.Uri): vscode.Uri {
  const fsPath = templateUri.fsPath.replace(/[\\/]XML_Templates([\\/])/i, `${path.sep}XML$1`);
  return vscode.Uri.file(fsPath);
}

function parseTemplateRoot(text: string): ParsedTemplateRoot {
  const rootMatch = /<\s*([A-Za-z_][\w.-]*)\b([^>]*)>/i.exec(text);
  if (!rootMatch) {
    return { rootTag: "" };
  }
  const rootTag = (rootMatch[1] ?? "").trim().toLowerCase();
  const attrs = rootMatch[2] ?? "";
  if (rootTag === "form") {
    const formIdent = extractAttributeValue(attrs, "Ident");
    return { rootTag, formIdent };
  }
  if (rootTag === "workflow" || rootTag === "dataview") {
    const formIdent = extractAttributeValue(attrs, "FormIdent");
    return { rootTag, formIdent };
  }
  return { rootTag };
}

function buildInheritedUsingsXml(
  templateText: string,
  formUsingsByFormIdent: ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]> | undefined
): string | undefined {
  if (!formUsingsByFormIdent) {
    return undefined;
  }
  const root = parseTemplateRoot(templateText);
  if ((root.rootTag !== "workflow" && root.rootTag !== "dataview") || !root.formIdent) {
    return undefined;
  }

  const inherited = formUsingsByFormIdent.get(root.formIdent);
  if (!inherited || inherited.length === 0) {
    return undefined;
  }

  const localUsings = parseUsingEntries(templateText);
  const localKeys = new Set<string>(localUsings.map((item) => toUsingEntryKey(item.featureKey, item.contributionKey)));
  const suppressFull = new Set<string>();
  const suppressContribution = new Set<string>();
  for (const item of localUsings) {
    if (!item.suppressInheritance) {
      continue;
    }
    if (!item.contributionKey) {
      suppressFull.add(item.featureKey);
      continue;
    }
    suppressContribution.add(toUsingEntryKey(item.featureKey, item.contributionKey));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const inheritedUsing of inherited) {
    if (inheritedUsing.suppressInheritance === true) {
      continue;
    }
    const key = toUsingEntryKey(inheritedUsing.featureKey, normalizeContributionKey(inheritedUsing.contributionKey));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (suppressFull.has(inheritedUsing.featureKey)) {
      continue;
    }
    if (inheritedUsing.contributionKey && suppressContribution.has(key)) {
      continue;
    }
    if (localKeys.has(key)) {
      continue;
    }

    out.push(buildInheritedUsingTag(resolveInheritedAttributes(inheritedUsing), inheritedUsing.featureKey, inheritedUsing.contributionKey));
  }

  return out.length > 0 ? out.join("\n") : undefined;
}

function parseUsingEntries(text: string): ParsedUsingEntry[] {
  const out: ParsedUsingEntry[] = [];
  const pattern = /<Using\b([^>]*)\/?>/gi;
  for (const match of text.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const orderedAttrs = parseXmlAttributesOrdered(attrs);
    const featureValue =
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component") ??
      extractAttributeValue(attrs, "Name");
    if (!featureValue) {
      continue;
    }
    const featureKey = stripXmlComponentExtension(normalizePath(featureValue.trim()));
    const contributionRaw = extractAttributeValue(attrs, "Contribution") ?? extractAttributeValue(attrs, "Section");
    const contributionKey = normalizeContributionKey(contributionRaw);
    const suppressInheritance = parseBooleanAttribute(extractAttributeValue(attrs, "SuppressInheritance"));
    out.push({
      featureKey,
      contributionKey,
      suppressInheritance,
      attributes: orderedAttrs
    });
  }
  return out;
}

function buildInheritedUsingTag(
  attributes: ReadonlyArray<{ name: string; value: string }>,
  fallbackFeatureKey?: string,
  fallbackContributionKey?: string
): string {
  const visibleAttrs = attributes.filter((attr) => {
    const lower = attr.name.trim().toLowerCase();
    return lower !== "suppressinheritance" && lower !== "inherit";
  });
  if (visibleAttrs.length === 0) {
    if (!fallbackFeatureKey) {
      return "<Using />";
    }
    const attrsText = [`Feature="${escapeXmlAttribute(fallbackFeatureKey)}"`];
    if (fallbackContributionKey) {
      attrsText.push(`Contribution="${escapeXmlAttribute(fallbackContributionKey)}"`);
    }
    return `<Using ${attrsText.join(" ")} />`;
  }
  if (!visibleAttrs.some((attr) => /^(feature|component|name)$/i.test(attr.name)) && fallbackFeatureKey) {
    visibleAttrs.unshift({ name: "Feature", value: fallbackFeatureKey });
  }
  if (
    fallbackContributionKey &&
    !visibleAttrs.some((attr) => /^(contribution|section)$/i.test(attr.name))
  ) {
    visibleAttrs.push({ name: "Contribution", value: fallbackContributionKey });
  }
  if (visibleAttrs.length === 0) {
    return "<Using />";
  }
  const attrsText = visibleAttrs.map((attr) => `${attr.name}="${escapeXmlAttribute(attr.value)}"`).join(" ");
  return `<Using ${attrsText} />`;
}

function resolveInheritedAttributes(entry: TemplateInheritedUsingEntry): ReadonlyArray<{ name: string; value: string }> {
  const attrs = entry.attributes ?? [];
  if (attrs.length > 0) {
    return attrs;
  }
  const out: Array<{ name: string; value: string }> = [];
  if (entry.rawComponentValue && entry.rawComponentValue.trim().length > 0) {
    out.push({ name: "Feature", value: entry.rawComponentValue.trim() });
  } else if (entry.featureKey.trim().length > 0) {
    out.push({ name: "Feature", value: entry.featureKey.trim() });
  }
  const contribution = normalizeContributionKey(entry.contributionKey);
  if (contribution) {
    out.push({ name: "Contribution", value: contribution });
  }
  return out;
}

function parseXmlAttributesOrdered(attrs: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attrs.matchAll(pattern)) {
    const name = (match[1] ?? "").trim();
    if (!name) {
      continue;
    }
    const value = (match[2] ?? match[3] ?? "").trim();
    out.push({ name, value });
  }
  return out;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toUsingEntryKey(featureKey: string, contributionKey?: string): string {
  return `${featureKey}#${normalizeContributionKey(contributionKey) ?? ""}`;
}

function normalizeContributionKey(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractAttributeValue(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`\\b${name}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(attrs);
  if (!match) {
    return undefined;
  }
  return (match[2] ?? match[3] ?? "").trim();
}

function parseBooleanAttribute(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function componentLikeKeyFromFsPath(workspaceFolder: vscode.WorkspaceFolder, fsPath: string): string | undefined {
  const root = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Components"));
  const primitivesRoot = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Primitives"));
  const current = normalizePath(fsPath);
  if (current.startsWith(`${root}/`)) {
    const rel = current.slice(root.length + 1);
    return stripXmlComponentExtension(rel);
  }
  if (current.startsWith(`${primitivesRoot}/`)) {
    const rel = current.slice(primitivesRoot.length + 1);
    return stripXmlComponentExtension(rel);
  }
  return undefined;
}

function formatSummaryText(summary: BuildRunSummary): string {
  return `Updated: ${summary.updated}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`;
}

function workspaceKeyFromFolder(workspaceFolder: vscode.WorkspaceFolder): string {
  return normalizePath(workspaceFolder.uri.fsPath).toLowerCase();
}

function computeRunSettingsSignature(
  options: BuildRunOptions,
  inheritedUsingsSignature: string,
  generatorScriptsSignature: string
): string {
  return hashText([
      `mode:${options.mode ?? "debug"}`,
      `postBuildFormat:${options.postBuildFormat === true}`,
      `legacyTagAliasesEnabled:${options.legacyTagAliasesEnabled !== false}`,
      `provenanceMode:${options.provenanceMode ?? "off"}`,
    `provenanceLabel:${options.provenanceLabel ?? ""}`,
    `blankLines:${Math.max(0, options.formatterMaxConsecutiveBlankLines ?? 2)}`,
    `generatorsEnabled:${options.generatorsEnabled !== false}`,
    `generatorTimeout:${Math.max(50, options.generatorTimeoutMs ?? DEFAULT_TEMPLATE_GENERATOR_TIMEOUT_MS)}`,
    `generatorEnableUserScripts:${options.generatorEnableUserScripts !== false}`,
    `generatorRoots:${(options.generatorUserScriptsRoots ?? ["XML_Generators"]).join("|")}`,
    `generatorScriptsSignature:${generatorScriptsSignature}`,
    `inheritedUsingsSignature:${inheritedUsingsSignature}`
  ].join("\n"));
}

function countGeneratorSnippets(xml: string): number {
  return (xml.match(/<\s*GeneratorSnippet\b/gi) ?? []).length;
}

function computeInheritedUsingsSignature(
  map: ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]> | undefined
): string {
  if (!map || map.size === 0) {
    return "none";
  }

  const rows: string[] = [];
  const formIdents = [...map.keys()].sort((a, b) => a.localeCompare(b));
  for (const formIdent of formIdents) {
    const entries = [...(map.get(formIdent) ?? [])];
    entries.sort((a, b) => {
      const left = `${a.featureKey}|${a.contributionKey ?? ""}|${a.rawComponentValue ?? ""}`;
      const right = `${b.featureKey}|${b.contributionKey ?? ""}|${b.rawComponentValue ?? ""}`;
      return left.localeCompare(right);
    });
    for (const entry of entries) {
      const attrs = [...(entry.attributes ?? [])]
        .map((attr) => `${attr.name}=${attr.value}`)
        .sort((a, b) => a.localeCompare(b))
        .join(",");
      rows.push([
        formIdent,
        entry.featureKey,
        entry.contributionKey ?? "",
        entry.suppressInheritance === true ? "1" : "0",
        entry.rawComponentValue ?? "",
        attrs
      ].join("|"));
    }
  }
  return hashText(rows.join("\n"));
}

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function createEmptyIoStats(): BuildRunIoStats {
  return {
    readCount: 0,
    readBytes: 0,
    readMs: 0,
    readWallMs: 0,
    writeCount: 0,
    writeBytes: 0,
    writeMs: 0,
    writeWallMs: 0,
    statCount: 0,
    statMs: 0,
    statWallMs: 0
  };
}

async function ensureParentDirectory(uri: vscode.Uri): Promise<void> {
  const parent = vscode.Uri.file(path.dirname(uri.fsPath));
  try {
    await vscode.workspace.fs.createDirectory(parent);
  } catch {
    // ignore
  }
}

async function readWorkspaceTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

async function readWorkspaceTextFileTracked(uri: vscode.Uri, ioStats?: BuildRunIoStats): Promise<string> {
  const startedAt = Date.now();
  const bytes = await vscode.workspace.fs.readFile(uri);
  const endedAt = Date.now();
  if (ioStats) {
    ioStats.readCount += 1;
    ioStats.readBytes += bytes.byteLength;
    ioStats.readMs += endedAt - startedAt;
    ioStats.readWallMs = Math.max(ioStats.readWallMs, endedAt - startedAt);
  }
  return Buffer.from(bytes).toString("utf8");
}

async function writeWorkspaceTextFileTracked(uri: vscode.Uri, text: string, ioStats?: BuildRunIoStats): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  const startedAt = Date.now();
  await vscode.workspace.fs.writeFile(uri, bytes);
  const endedAt = Date.now();
  if (ioStats) {
    ioStats.writeCount += 1;
    ioStats.writeBytes += bytes.byteLength;
    ioStats.writeMs += endedAt - startedAt;
    ioStats.writeWallMs = Math.max(ioStats.writeWallMs, endedAt - startedAt);
  }
}

async function safeStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

async function safeStatTracked(uri: vscode.Uri, ioStats?: BuildRunIoStats): Promise<vscode.FileStat | undefined> {
  const startedAt = Date.now();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const endedAt = Date.now();
    if (ioStats) {
      ioStats.statCount += 1;
      ioStats.statMs += endedAt - startedAt;
      ioStats.statWallMs = Math.max(ioStats.statWallMs, endedAt - startedAt);
    }
    return stat;
  } catch {
    const endedAt = Date.now();
    if (ioStats) {
      ioStats.statCount += 1;
      ioStats.statMs += endedAt - startedAt;
      ioStats.statWallMs = Math.max(ioStats.statWallMs, endedAt - startedAt);
    }
    return undefined;
  }
}
