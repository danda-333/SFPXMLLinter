import * as vscode from "vscode";
import { SfpXmlLinterSettings } from "../../config/settings";
import { parseDocumentFacts } from "../../indexer/xmlFacts";

export interface TemplateBuildPlannerServiceDeps {
  getSettings: () => SfpXmlLinterSettings;
  getWorkspaceFolderForUri: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined;
  isInFolder: (uri: vscode.Uri, folderName: string) => boolean;
  toRelativePath: (uri: vscode.Uri) => string;
  logBuild: (message: string) => void;
  queueTemplateBuild: (workspaceFolder: vscode.WorkspaceFolder, targetPath?: string) => Promise<void>;
  queueTemplateBuildBatch: (workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[]) => Promise<void>;
  queueTemplateBuildBatchDeferred: (workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[]) => Promise<void>;
  waitForTemplateBuildIdle: () => Promise<void>;
  getOpenTemplatePaths: (workspaceFolder: vscode.WorkspaceFolder) => ReadonlySet<string>;
  collectTemplatePathsForFormIdentFromIndex: (formIdent: string) => string[];
  collectDependentTemplatesFromIndex: (componentKey: string) => string[];
  findTemplatesUsingComponent: (workspaceFolder: vscode.WorkspaceFolder, componentPath: string) => Promise<string[]>;
}

export class TemplateBuildPlannerService {
  public constructor(private readonly deps: TemplateBuildPlannerServiceDeps) {}

  private enqueueTemplateTargets(workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[]): void {
    void this.deps.queueTemplateBuildBatch(workspaceFolder, targetPaths);
  }

  private splitImmediateAndDeferred(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPaths: readonly string[]
  ): { immediate: string[]; deferred: string[] } {
    const openTemplatePaths = this.deps.getOpenTemplatePaths(workspaceFolder);
    if (openTemplatePaths.size === 0) {
      return { immediate: [], deferred: [...targetPaths] };
    }
    const immediate: string[] = [];
    const deferred: string[] = [];
    for (const targetPath of targetPaths) {
      const normalized = targetPath.replace(/\\/g, "/").toLowerCase();
      if (openTemplatePaths.has(normalized)) {
        immediate.push(targetPath);
      } else {
        deferred.push(targetPath);
      }
    }
    return { immediate, deferred };
  }

  private async queueDeferredTemplateTargets(workspaceFolder: vscode.WorkspaceFolder, targetPaths: readonly string[]): Promise<void> {
    if (targetPaths.length === 0) {
      return;
    }
    this.deps.logBuild(`Dependents deferred: ${targetPaths.length}`);
    await this.deps.queueTemplateBuildBatchDeferred(workspaceFolder, targetPaths);
  }

  public async maybeAutoBuildTemplates(document: vscode.TextDocument, componentKeyHint?: string): Promise<void> {
    const settings = this.deps.getSettings();
    if (!settings.autoBuildOnSave || document.languageId !== "xml") {
      return;
    }

    const workspaceFolder = this.deps.getWorkspaceFolderForUri(document.uri);
    if (!workspaceFolder) {
      return;
    }

    if (this.deps.isInFolder(document.uri, "XML_Templates")) {
      this.deps.logBuild(`SAVE XML_Templates: ${this.deps.toRelativePath(document.uri)}`);
      const facts = parseDocumentFacts(document);
      const root = (facts.rootTag ?? "").toLowerCase();
      if (root === "form" && facts.formIdent) {
        const relatedTemplatePaths = this.deps.collectTemplatePathsForFormIdentFromIndex(facts.formIdent);
        if (relatedTemplatePaths.length > 0) {
          this.deps.logBuild(
            `Form save detected: queue related templates for FormIdent='${facts.formIdent}' count=${relatedTemplatePaths.length}`
          );
          this.enqueueTemplateTargets(workspaceFolder, relatedTemplatePaths);
          await this.deps.waitForTemplateBuildIdle();
          return;
        }
      }
      await this.deps.queueTemplateBuild(workspaceFolder, document.uri.fsPath);
      await this.deps.waitForTemplateBuildIdle();
      return;
    }

    const isComponentLikeSave = this.deps.isInFolder(document.uri, "XML_Components")
      || this.deps.isInFolder(document.uri, "XML_Primitives");
    if (!isComponentLikeSave) {
      return;
    }

    this.deps.logBuild(`SAVE component-like source: ${this.deps.toRelativePath(document.uri)}`);
    if (settings.componentSaveBuildScope === "full") {
      this.deps.logBuild("Component save scope=full -> FULL build");
      await this.deps.queueTemplateBuild(workspaceFolder);
      await this.deps.waitForTemplateBuildIdle();
      return;
    }

    const indexedDependents = componentKeyHint ? this.deps.collectDependentTemplatesFromIndex(componentKeyHint) : [];
    if (indexedDependents.length > 0) {
      this.deps.logBuild(`Dependents from index: ${indexedDependents.length}`);
      const { immediate, deferred } = this.splitImmediateAndDeferred(workspaceFolder, indexedDependents);
      if (immediate.length > 0) {
        this.deps.logBuild(`Dependents immediate (open): ${immediate.length}`);
        this.enqueueTemplateTargets(workspaceFolder, immediate);
        await this.deps.waitForTemplateBuildIdle();
      }
      await this.queueDeferredTemplateTargets(workspaceFolder, deferred);
      if (deferred.length > 0) {
        await this.deps.waitForTemplateBuildIdle();
      }
      return;
    }

    const fallbackStartedAt = Date.now();
    const dependentTemplates = await this.deps.findTemplatesUsingComponent(workspaceFolder, document.uri.fsPath);
    this.deps.logBuild(`Dependents fallback scan took ${Date.now() - fallbackStartedAt} ms`);
    if (dependentTemplates.length === 0) {
      this.deps.logBuild("No dependents found -> FULL build fallback");
      await this.deps.queueTemplateBuild(workspaceFolder);
      await this.deps.waitForTemplateBuildIdle();
      return;
    }

    this.deps.logBuild(`Dependents found: ${dependentTemplates.length}`);
    const { immediate, deferred } = this.splitImmediateAndDeferred(workspaceFolder, dependentTemplates);
    if (immediate.length > 0) {
      this.deps.logBuild(`Dependents immediate (open): ${immediate.length}`);
      this.enqueueTemplateTargets(workspaceFolder, immediate);
      await this.deps.waitForTemplateBuildIdle();
    }
    await this.queueDeferredTemplateTargets(workspaceFolder, deferred);
    if (deferred.length > 0) {
      await this.deps.waitForTemplateBuildIdle();
    }
  }
}
