import * as vscode from "vscode";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { getSettings } from "../config/settings";

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
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
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
    const settings = getSettings();
    if (settings.templateBuilderMode === "powershell") {
      return this.runPowerShellFallback(workspaceFolder, targetPath, options);
    }

    if (settings.templateBuilderMode === "typescript") {
      return this.runTypeScriptBuilder(workspaceFolder, targetPath, options);
    }

    try {
      return await this.runTypeScriptBuilder(workspaceFolder, targetPath, options);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`TypeScript builder failed (${msg}), falling back to PowerShell script.`);
      return this.runPowerShellFallback(workspaceFolder, targetPath, options);
    }
  }

  private async runTypeScriptBuilder(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string | undefined,
    options: BuildRunOptions
  ): Promise<BuildRunResult> {
    // Architecture hook: this is where full TypeScript port of BuildXmlTemplates.ps1 will run.
    // Current implementation intentionally falls back to legacy script for parity.
    return this.runPowerShellFallback(workspaceFolder, targetPath, options);
  }

  private async runPowerShellFallback(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string | undefined,
    options: BuildRunOptions
  ): Promise<BuildRunResult> {
    const settings = getSettings();
    const scriptPath = resolveScriptPath(workspaceFolder, settings.powershellScriptPath);
    const args = ["-NoProfile", "-File", scriptPath];

    if (targetPath && targetPath.trim().length > 0) {
      args.push("-Path", targetPath);
    }

    const parseState: BuildOutputParseState = {};
    await execProcess("powershell", args, workspaceFolder.uri.fsPath, {
      onStdoutLine: (line) => {
        options.onLogLine?.(line);
        parseBuildStdoutLine(line, parseState, options.onFileStatus);
      },
      onStderrLine: (line) => {
        options.onLogLine?.(`[stderr] ${line}`);
      }
    });

    if (options.silent) {
      return { summary: parseState.summary };
    }

    const summaryText = formatSummaryText(parseState.summary);
    if (targetPath) {
      vscode.window.showInformationMessage(`BuildXmlTemplates finished for: ${path.basename(targetPath)}. ${summaryText}`);
      return { summary: parseState.summary };
    }

    vscode.window.showInformationMessage(`BuildXmlTemplates finished for all templates. ${summaryText}`);
    return { summary: parseState.summary };
  }
}

interface ExecProcessOptions {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

interface BuildOutputParseState {
  currentRelativeTemplatePath?: string;
  summary?: BuildRunSummary;
}

function execProcess(command: string, args: string[], cwd: string, options: ExecProcessOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });

    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushStdout = () => {
      const lines = splitCompleteLines(stdoutBuffer);
      stdoutBuffer = lines.remaining;
      for (const line of lines.complete) {
        if (line.trim().length > 0) {
          console.log(`[SFP-DBG][sfpXmlLinter] ${line}`);
        }
        options.onStdoutLine?.(line);
      }
    };

    const flushStderr = () => {
      const lines = splitCompleteLines(stderrBuffer);
      stderrBuffer = lines.remaining;
      for (const line of lines.complete) {
        stderr += `${line}\n`;
        options.onStderrLine?.(line);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      flushStdout();
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += String(chunk);
      flushStderr();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.length > 0) {
        const line = stdoutBuffer;
        if (line.trim().length > 0) {
          console.log(`[SFP-DBG][sfpXmlLinter] ${line}`);
        }
        options.onStdoutLine?.(line);
      }

      if (stderrBuffer.length > 0) {
        stderr += stderrBuffer;
        options.onStderrLine?.(stderrBuffer);
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Command '${command}' exited with code ${code}.`));
    });
  });
}

function splitCompleteLines(buffer: string): { complete: string[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const remaining = parts.pop() ?? "";
  return { complete: parts, remaining };
}

function parseBuildStdoutLine(
  rawLine: string,
  state: BuildOutputParseState,
  onFileStatus?: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => void
): void {
  const line = rawLine.trim();
  if (line.length === 0) {
    return;
  }

  const summaryMatch = /^Done\.\s*Updated:\s*(\d+),\s*Skipped:\s*(\d+),\s*Errors:\s*(\d+)/i.exec(line);
  if (summaryMatch) {
    state.summary = {
      updated: Number.parseInt(summaryMatch[1] ?? "0", 10),
      skipped: Number.parseInt(summaryMatch[2] ?? "0", 10),
      errors: Number.parseInt(summaryMatch[3] ?? "0", 10)
    };
  }

  const fileMatch = /^\[\d+\/\d+\]\s+(.+)$/.exec(line);
  if (fileMatch) {
    state.currentRelativeTemplatePath = fileMatch[1].trim();
    return;
  }

  const current = state.currentRelativeTemplatePath;
  if (!current) {
    return;
  }

  if (/^UPDATED$/i.test(line)) {
    onFileStatus?.(current, "update");
    return;
  }

  if (/^SKIPPED$/i.test(line)) {
    onFileStatus?.(current, "nochange");
    return;
  }

  if (/^ERROR\b/i.test(line)) {
    onFileStatus?.(current, "error");
  }
}

function formatSummaryText(summary: BuildRunSummary | undefined): string {
  if (!summary) {
    return "Summary not available.";
  }

  return `Updated: ${summary.updated}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`;
}

function extractUsingComponentRefs(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(/<Using\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const componentValue = extractAttributeValue(attrs, "Component") ?? extractAttributeValue(attrs, "Name");
    if (!componentValue) {
      continue;
    }

    refs.push(normalizeComponentRef(componentValue));
  }

  return refs;
}

function extractAttributeValue(rawAttrs: string, attrName: string): string | undefined {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(rawAttrs);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function normalizeComponentRef(value: string): string {
  return stripXmlComponentExtension(normalizePath(value));
}

function stripXmlComponentExtension(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(".component.xml")) {
    return value.slice(0, value.length - ".component.xml".length);
  }

  if (lower.endsWith(".xml")) {
    return value.slice(0, value.length - ".xml".length);
  }

  return value;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveScriptPath(workspaceFolder: vscode.WorkspaceFolder, configuredScriptPath: string): string {
  const direct = path.join(workspaceFolder.uri.fsPath, configuredScriptPath);
  if (existsFile(direct)) {
    return direct;
  }

  const fallback = path.join(workspaceFolder.uri.fsPath, "Scripts", "BuildXmlTemplates.ps1");
  if (existsFile(fallback)) {
    return fallback;
  }

  return direct;
}

function existsFile(filePath: string): boolean {
  return fs.existsSync(filePath);
}
