import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BuildRunOptions, BuildXmlTemplatesService } from "../../template/buildXmlTemplatesService";
import {
  BuildTemplateEvaluation,
  BuildTemplateMutationTelemetry,
  CompositionTelemetryCollector
} from "./compositionTelemetryService";
import { TemplateBuildRunMode } from "./templateBuildRunOptionsFactory";
import type { TemplateBuildOutputsReadyStats } from "./templateBuildOrchestrator";

export interface ManualTemplateBuildCommandsServiceDeps {
  buildService: BuildXmlTemplatesService;
  getTemplateBuilderMode: () => TemplateBuildRunMode;
  createBuildTelemetryCollector: () => CompositionTelemetryCollector;
  createBuildRunOptions: (
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
      mutations: readonly import("../../template/buildXmlTemplatesCore").TemplateMutationRecord[],
      renderedOutputText?: string
    ) => void
  ) => BuildRunOptions;
  queueReindexAll: () => Promise<void>;
  applyBuildMutationTelemetry: (
    mutationsByTemplate: ReadonlyMap<string, BuildTemplateMutationTelemetry>
  ) => void;
  logBuildCompositionSnapshot: (
    sourceLabel: string,
    evaluations: ReadonlyMap<string, BuildTemplateEvaluation>,
    mode: TemplateBuildRunMode
  ) => void;
  logBuild: (message: string) => void;
  isInFolder: (uri: vscode.Uri, folderName: string) => boolean;
  toRelativePath: (uriOrPath: vscode.Uri | string) => string;
  onBuildStateChanged?: (state: "idle" | "running") => void;
  onBuildOutputsReady?: (stats: TemplateBuildOutputsReadyStats) => void;
}

export class ManualTemplateBuildCommandsService {
  public constructor(private readonly deps: ManualTemplateBuildCommandsServiceDeps) {}

  public async runBuildCurrentOrSelection(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    this.deps.onBuildStateChanged?.("running");
    const commandStartedAt = Date.now();
    try {
      this.deps.logBuild("MANUAL build current/selection START");
      const mode = this.deps.getTemplateBuilderMode();
      const compatibilityProbe = this.deps.createBuildRunOptions(true, mode);
      const legacyTagAliasesEnabled = compatibilityProbe.legacyTagAliasesEnabled !== false;
      const telemetry = this.deps.createBuildTelemetryCollector();
      const selection = this.collectBuildSelectionUris(uri, uris);
      const targetUris = selection.length > 0 ? selection : this.getActiveDocumentUriFallback();

      if (targetUris.length === 0) {
        this.deps.logBuild("No current/selected resource -> FULL fallback");
        this.deps.buildService.invalidateComponentLibraryCache(folder);
        await this.deps.buildService.run(
          folder,
          this.deps.createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated, telemetry.onTemplateMutations)
        );
        await this.deps.queueReindexAll();
        this.deps.applyBuildMutationTelemetry(telemetry.mutationsByTemplate);
        this.deps.onBuildOutputsReady?.(
          buildOutputsReadyStatsFromTelemetry(telemetry, true, undefined, Date.now() - commandStartedAt)
        );
        this.deps.logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);
        this.deps.logBuild("MANUAL build current/selection DONE (full fallback)");
        return;
      }

      const templateTargets = new Set<string>();
      let usedFullFallback = false;

      for (const targetUri of targetUris) {
        if (this.deps.isInFolder(targetUri, "XML_Templates")) {
          templateTargets.add(targetUri.fsPath);
          continue;
        }

        if (this.deps.isInFolder(targetUri, "XML_Components") || this.deps.isInFolder(targetUri, "XML_Primitives")) {
          const dependentTemplates = await this.deps.buildService.findTemplatesUsingComponent(
            folder,
            targetUri.fsPath,
            legacyTagAliasesEnabled
          );
          if (dependentTemplates.length === 0) {
            usedFullFallback = true;
            this.deps.logBuild(
              `Selection in XML_Components/XML_Primitives has no dependents: ${this.deps.toRelativePath(targetUri)} -> FULL fallback`
            );
            break;
          }

          for (const dependent of dependentTemplates) {
            templateTargets.add(dependent);
          }
          continue;
        }

        usedFullFallback = true;
        this.deps.logBuild(`Selection outside template roots: ${this.deps.toRelativePath(targetUri)} -> FULL fallback`);
        break;
      }

      if (usedFullFallback || templateTargets.size === 0) {
        this.deps.buildService.invalidateComponentLibraryCache(folder);
        await this.deps.buildService.run(
          folder,
          this.deps.createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated, telemetry.onTemplateMutations)
        );
        await this.deps.queueReindexAll();
        this.deps.applyBuildMutationTelemetry(telemetry.mutationsByTemplate);
        this.deps.logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);
        this.deps.logBuild("MANUAL build current/selection DONE (full fallback)");
        return;
      }

      for (const targetPath of templateTargets) {
        this.deps.logBuild(`MANUAL target build: ${this.deps.toRelativePath(targetPath)}`);
        await this.deps.buildService.runForPath(
          folder,
          targetPath,
          this.deps.createBuildRunOptions(false, mode, telemetry.onTemplateEvaluated, telemetry.onTemplateMutations)
        );
      }
      await this.deps.queueReindexAll();
      this.deps.applyBuildMutationTelemetry(telemetry.mutationsByTemplate);
      this.deps.onBuildOutputsReady?.(
        buildOutputsReadyStatsFromTelemetry(telemetry, false, templateTargets.size, Date.now() - commandStartedAt)
      );
      this.deps.logBuildCompositionSnapshot("manual-current", telemetry.entries, mode);
      this.deps.logBuild("MANUAL build current/selection DONE");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`BuildXmlTemplates failed: ${message}`);
      this.deps.logBuild(`MANUAL build current/selection ERROR: ${message}`);
    } finally {
      this.deps.onBuildStateChanged?.("idle");
    }
  }

  public async runBuildAll(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    this.deps.onBuildStateChanged?.("running");
    const commandStartedAt = Date.now();
    try {
      this.deps.logBuild("MANUAL build all START");
      // Always invalidate component library cache before full rebuild so the run
      // cannot reuse stale component snapshots from missed file-watch/save events.
      this.deps.buildService.invalidateComponentLibraryCache(folder);
      const mode = this.deps.getTemplateBuilderMode();
      const telemetry = this.deps.createBuildTelemetryCollector();
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "SFP XML Linter: Full rebuild XML templates",
          cancellable: false
        },
        async (progress) => {
          let lastReported = 0;
          let totalCount = 0;
          const buildErrors: string[] = [];
          progress.report({ message: "Starting..." });
          const runOptions = this.deps.createBuildRunOptions(
            false,
            mode,
            telemetry.onTemplateEvaluated,
            telemetry.onTemplateMutations
          );
          const previousOnLogLine = runOptions.onLogLine;
          runOptions.onLogLine = (line: string) => {
            previousOnLogLine?.(line);
            const trimmed = line.trim();
            if (/^ERROR:\s*/i.test(trimmed)) {
              const normalized = trimmed.replace(/^ERROR:\s*/i, "");
              if (normalized.length > 0) {
                buildErrors.push(normalized);
              }
            }
            const match = /^\[(\d+)\/(\d+)\]\s+(.+)$/.exec(line.trim());
            if (!match) {
              if (buildErrors.length > 0) {
                const last = truncateForProgress(buildErrors[buildErrors.length - 1]);
                progress.report({ message: `Errors: ${buildErrors.length} | Last: ${last}` });
              }
              return;
            }
            const current = Number(match[1] ?? 0);
            const total = Number(match[2] ?? 0);
            const relPath = match[3] ?? "";
            if (Number.isFinite(total) && total > 0) {
              totalCount = total;
              const targetPercent = Math.floor((Math.max(0, current) / total) * 100);
              const increment = Math.max(0, Math.min(100, targetPercent - lastReported));
              lastReported += increment;
              const errorPart = buildErrors.length > 0
                ? ` | errors: ${buildErrors.length} | last: ${truncateForProgress(buildErrors[buildErrors.length - 1])}`
                : "";
              progress.report({
                increment,
                message: `${Math.max(0, current)}/${total}: ${relPath}${errorPart}`
              });
            } else {
              progress.report({ message: relPath });
            }
          };
          await this.deps.buildService.run(folder, runOptions);
          if (totalCount > 0 && lastReported < 100) {
            progress.report({ increment: 100 - lastReported, message: "Finalizing..." });
          } else {
            progress.report({ message: "Finalizing..." });
          }
        }
      );
      await this.deps.queueReindexAll();
      this.deps.applyBuildMutationTelemetry(telemetry.mutationsByTemplate);
      this.deps.onBuildOutputsReady?.(
        buildOutputsReadyStatsFromTelemetry(telemetry, true, undefined, Date.now() - commandStartedAt)
      );
      this.deps.logBuildCompositionSnapshot("manual-all", telemetry.entries, mode);
      this.deps.logBuild("MANUAL build all DONE");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`BuildXmlTemplates (all) failed: ${message}`);
      this.deps.logBuild(`MANUAL build all ERROR: ${message}`);
    } finally {
      this.deps.onBuildStateChanged?.("idle");
    }
  }

  public async compareTemplateWithBuiltXml(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!document || document.languageId !== "xml") {
      vscode.window.showWarningMessage("Open an XML document first.");
      return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    let templateUri: vscode.Uri | undefined;
    if (this.deps.isInFolder(document.uri, "XML_Templates")) {
      templateUri = document.uri;
    } else if (this.deps.isInFolder(document.uri, "XML")) {
      const templatePath = document.uri.fsPath.replace(/[\\/]XML([\\/])/i, `${path.sep}XML_Templates$1`);
      if (await this.pathExists(templatePath)) {
        templateUri = vscode.Uri.file(templatePath);
      }
    }

    if (!templateUri) {
      vscode.window.showWarningMessage("Current XML is not under XML_Templates/XML or matching template file was not found.");
      return;
    }

    this.deps.onBuildStateChanged?.("running");
    try {
      const mode = this.deps.getTemplateBuilderMode();
      const options = this.deps.createBuildRunOptions(true, mode);
      const sourceIsTemplate = templateUri.toString() === document.uri.toString();
      const renderedXml = await this.deps.buildService.renderTemplateToFinalXml(
        folder,
        templateUri,
        options,
        sourceIsTemplate ? document.getText() : undefined
      );
      const renderedDoc = await vscode.workspace.openTextDocument({
        language: "xml",
        content: renderedXml
      });

      const leftLabel = vscode.workspace.asRelativePath(document.uri, false);
      const title = `SFP Compare: ${leftLabel} ↔ Built XML`;
      await vscode.commands.executeCommand("vscode.diff", document.uri, renderedDoc.uri, title);
      this.deps.logBuild(`Compare opened: ${leftLabel} -> built from ${vscode.workspace.asRelativePath(templateUri, false)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Template compare failed: ${message}`);
      this.deps.logBuild(`COMPARE ERROR: ${message}`);
    } finally {
      this.deps.onBuildStateChanged?.("idle");
    }
  }

  private collectBuildSelectionUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
    if (Array.isArray(uris) && uris.length > 0) {
      return this.dedupeUris(uris.filter((item) => isVsCodeUri(item)));
    }

    if (Array.isArray(uri)) {
      return this.dedupeUris(uri.filter((item) => isVsCodeUri(item)));
    }

    if (isVsCodeUri(uri)) {
      return [uri];
    }

    return [];
  }

  private getActiveDocumentUriFallback(): vscode.Uri[] {
    const active = vscode.window.activeTextEditor?.document.uri;
    return active ? [active] : [];
  }

  private dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
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

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

function truncateForProgress(input: string, max = 120): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, max - 3)}...`;
}

function isVsCodeUri(value: unknown): value is vscode.Uri {
  if (!(value instanceof vscode.Uri) && (!value || typeof value !== "object")) {
    return false;
  }
  const candidate = value as vscode.Uri;
  return typeof candidate.scheme === "string" && typeof candidate.fsPath === "string" && typeof candidate.toString === "function";
}

function buildOutputsReadyStatsFromTelemetry(
  telemetry: CompositionTelemetryCollector,
  fullBuild: boolean,
  builtTargetCount?: number,
  durationMs?: number
): TemplateBuildOutputsReadyStats {
  const updatedTemplatePaths: string[] = [];
  const summary = { updated: 0, skipped: 0, errors: 0 };
  for (const [templatePath, evaluation] of telemetry.entries) {
    const status = String(evaluation.status).toLowerCase();
    if (status === "update") {
      summary.updated += 1;
      updatedTemplatePaths.push(templatePath.replace(/\\/g, "/"));
    } else if (status === "nochange") {
      summary.skipped += 1;
    } else if (status === "error") {
      summary.errors += 1;
    }
  }
  const updatedTemplateKeySet = new Set(updatedTemplatePaths.map((item) => item.toLowerCase()));
  const updatedOutputPaths: string[] = [];
  for (const [templatePath, mutation] of telemetry.mutationsByTemplate) {
    if (!updatedTemplateKeySet.has(templatePath.replace(/\\/g, "/").toLowerCase())) {
      continue;
    }
    if (mutation.outputRelativePath) {
      updatedOutputPaths.push(mutation.outputRelativePath.replace(/\\/g, "/"));
    }
  }
  updatedTemplatePaths.sort((a, b) => a.localeCompare(b));
  updatedOutputPaths.sort((a, b) => a.localeCompare(b));
  return {
    durationMs: durationMs ?? 0,
    executedFullBuild: fullBuild,
    builtTargetCount: builtTargetCount ?? telemetry.entries.size,
    summary,
    updatedTemplatePaths,
    updatedOutputPaths
  };
}
