import * as vscode from "vscode";
import * as path from "node:path";
import {
  buildComponentLibrary,
  extractUsingComponentRefs,
  normalizePath,
  renderTemplateText,
  stripXmlComponentExtension
} from "./buildXmlTemplatesCore";

interface BuildRunOptions {
  silent?: boolean;
  onLogLine?: (line: string) => void;
  onFileStatus?: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => void;
}

export interface BuildRunSummary {
  updated: number;
  skipped: number;
  errors: number;
}

export interface BuildRunResult {
  summary?: BuildRunSummary;
}

export class BuildXmlTemplatesService {
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

  public async findTemplatesUsingComponent(workspaceFolder: vscode.WorkspaceFolder, componentFilePath: string): Promise<string[]> {
    const normalizedComponentPath = normalizePath(componentFilePath);
    const componentsRoot = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Components"));
    if (!normalizedComponentPath.startsWith(`${componentsRoot}/`)) {
      return [];
    }

    const rel = normalizedComponentPath.slice(componentsRoot.length + 1);
    const relNoExt = stripXmlComponentExtension(rel);
    const targetBaseName = relNoExt.split("/").pop() ?? relNoExt;

    const templateUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Templates/**/*.xml"));
    const out = new Set<string>();

    for (const uri of templateUris) {
      const text = await readWorkspaceTextFile(uri);
      for (const usingRef of extractUsingComponentRefs(text)) {
        if (usingRef === relNoExt || usingRef.split("/").pop() === targetBaseName) {
          out.add(uri.fsPath);
          break;
        }
      }
    }

    return [...out].sort((a, b) => a.localeCompare(b));
  }

  private async runInternal(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string | undefined,
    options: BuildRunOptions
  ): Promise<BuildRunResult> {
    const templateUris = await collectTemplateTargets(workspaceFolder, targetPath);
    const componentUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Components/**/*.xml"));

    const componentSources: Array<{ key: string; text: string; origin: string }> = [];
    for (const uri of componentUris) {
      const key = componentKeyFromUri(workspaceFolder, uri);
      if (!key) {
        continue;
      }

      const text = await readWorkspaceTextFile(uri);
      componentSources.push({
        key,
        text,
        origin: uri.fsPath
      });
    }

    const componentLibrary = buildComponentLibrary(componentSources);
    const summary: BuildRunSummary = { updated: 0, skipped: 0, errors: 0 };
    const total = templateUris.length;
    let current = 0;

    for (const templateUri of templateUris) {
      current++;
      const relPath = relativeTemplatePath(workspaceFolder, templateUri);
      options.onLogLine?.(`[${current}/${total}] ${relPath}`);

      try {
        const templateText = await readWorkspaceTextFile(templateUri);
        const rendered = renderTemplateText(templateText, componentLibrary);
        const outputUri = templateToRuntimeUri(templateUri);
        const existing = await readWorkspaceTextFile(outputUri).catch(() => undefined);

        if (existing === rendered) {
          summary.skipped++;
          options.onLogLine?.("SKIPPED");
          options.onFileStatus?.(relPath, "nochange");
          continue;
        }

        await ensureParentDirectory(outputUri);
        await vscode.workspace.fs.writeFile(outputUri, Buffer.from(rendered, "utf8"));
        summary.updated++;
        options.onLogLine?.("UPDATED");
        options.onFileStatus?.(relPath, "update");
      } catch (error) {
        summary.errors++;
        const message = error instanceof Error ? error.message : String(error);
        options.onLogLine?.(`ERROR: ${message}`);
        options.onFileStatus?.(relPath, "error");
      }
    }

    options.onLogLine?.(`Done. Updated: ${summary.updated}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`);

    if (!options.silent) {
      const summaryText = formatSummaryText(summary);
      if (targetPath && targetPath.trim().length > 0) {
        vscode.window.showInformationMessage(`BuildXmlTemplates finished for: ${path.basename(targetPath)}. ${summaryText}`);
      } else {
        vscode.window.showInformationMessage(`BuildXmlTemplates finished for all templates. ${summaryText}`);
      }
    }

    return { summary };
  }
}

async function collectTemplateTargets(workspaceFolder: vscode.WorkspaceFolder, targetPath: string | undefined): Promise<vscode.Uri[]> {
  if (targetPath && targetPath.trim().length > 0) {
    const normalized = normalizePath(targetPath);
    const maybeTemplate = normalized.toLowerCase().includes("/xml_templates/")
      ? vscode.Uri.file(targetPath)
      : normalized.toLowerCase().includes("/xml/")
        ? vscode.Uri.file(targetPath.replace(/[\\/]XML[\\/]/i, `${path.sep}XML_Templates${path.sep}`))
        : undefined;

    if (maybeTemplate && maybeTemplate.fsPath.toLowerCase().endsWith(".xml")) {
      return [maybeTemplate];
    }
  }

  return vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Templates/**/*.xml"));
}

function componentKeyFromUri(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const root = normalizePath(path.join(workspaceFolder.uri.fsPath, "XML_Components"));
  const current = normalizePath(uri.fsPath);
  if (!current.startsWith(`${root}/`)) {
    return undefined;
  }

  const rel = current.slice(root.length + 1);
  return stripXmlComponentExtension(rel);
}

function relativeTemplatePath(workspaceFolder: vscode.WorkspaceFolder, templateUri: vscode.Uri): string {
  const rel = normalizePath(path.relative(path.join(workspaceFolder.uri.fsPath, "XML_Templates"), templateUri.fsPath));
  return rel.length > 0 ? rel : vscode.workspace.asRelativePath(templateUri, false);
}

function templateToRuntimeUri(templateUri: vscode.Uri): vscode.Uri {
  const fsPath = templateUri.fsPath.replace(/[\\/]XML_Templates([\\/])/i, `${path.sep}XML$1`);
  return vscode.Uri.file(fsPath);
}

function formatSummaryText(summary: BuildRunSummary): string {
  return `Updated: ${summary.updated}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`;
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
