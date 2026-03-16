import * as vscode from "vscode";
import * as path from "node:path";
import {
  buildComponentLibrary,
  extractUsingComponentRefs,
  normalizePath,
  renderTemplateText,
  stripXmlComponentExtension
} from "./buildXmlTemplatesCore";
import { applyTemplateOutputQuality, TemplateBuilderProvenanceMode } from "./outputQuality";
import { runTemplateGenerators } from "./generators";
import { loadWorkspaceUserGenerators } from "./generators/userGeneratorLoader";

interface BuildRunOptions {
  silent?: boolean;
  mode?: "fast" | "debug" | "release";
  postBuildFormat?: boolean;
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

export interface TemplateInheritedUsingEntry {
  featureKey: string;
  contributionKey?: string;
  suppressInheritance?: boolean;
  attributes?: ReadonlyArray<{ name: string; value: string }>;
  rawComponentValue?: string;
}

export class BuildXmlTemplatesService {
  public async renderTemplateToFinalXml(
    workspaceFolder: vscode.WorkspaceFolder,
    templateUri: vscode.Uri,
    options: BuildRunOptions = {},
    templateTextOverride?: string
  ): Promise<string> {
    const componentLibrary = await this.buildWorkspaceComponentLibrary(workspaceFolder);
    const relPath = relativeTemplatePath(workspaceFolder, templateUri);
    const templateText = templateTextOverride ?? await readWorkspaceTextFile(templateUri);
    const inheritedUsingsXml = buildInheritedUsingsXml(templateText, options.inheritedUsingsByFormIdent);
    const renderedRaw = renderTemplateText(
      templateText,
      componentLibrary,
      12,
      options.mode === "debug" ? options.onLogLine : undefined,
      inheritedUsingsXml
    );

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
        timeoutMs: Math.max(50, options.generatorTimeoutMs ?? 150),
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

  public async findTemplatesUsingComponent(workspaceFolder: vscode.WorkspaceFolder, componentFilePath: string): Promise<string[]> {
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
    const componentLibrary = await this.buildWorkspaceComponentLibrary(workspaceFolder);
    const templateTextByUri = new Map<string, string>();
    for (const templateUri of templateUris) {
      const text = await readWorkspaceTextFile(templateUri);
      templateTextByUri.set(templateUri.toString(), text);
    }

    const userGenerators = options.generatorEnableUserScripts === false
      ? []
      : await loadWorkspaceUserGenerators(
          workspaceFolder.uri.fsPath,
          options.generatorUserScriptsRoots ?? ["XML_Generators"],
          options.onLogLine
        );
    const summary: BuildRunSummary = { updated: 0, skipped: 0, errors: 0 };
    const total = templateUris.length;
    let current = 0;

    for (const templateUri of templateUris) {
      current++;
      const relPath = relativeTemplatePath(workspaceFolder, templateUri);
      options.onLogLine?.(`[${current}/${total}] ${relPath}`);

      try {
        const templateText = templateTextByUri.get(templateUri.toString()) ?? await readWorkspaceTextFile(templateUri);
        const inheritedUsingsXml = buildInheritedUsingsXml(templateText, options.inheritedUsingsByFormIdent);
        const debugLines: string[] = [];
        const debugMode = options.mode === "debug";
        const renderedRaw = renderTemplateText(
          templateText,
          componentLibrary,
          12,
          debugMode
            ? (line) => {
                debugLines.push(line);
                options.onLogLine?.(`DEBUG: ${line}`);
              }
            : undefined,
          inheritedUsingsXml
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
            timeoutMs: Math.max(50, options.generatorTimeoutMs ?? 150),
            userGenerators
          },
          options.onLogLine
        );
        for (const warning of generated.warnings) {
          options.onLogLine?.(`[generator][warning] ${warning.code}: ${warning.message}`);
        }
        if ((options.mode ?? "debug") === "debug") {
          options.onLogLine?.(
            `[generator] summary: applied=${generated.appliedGeneratorIds.length}, warnings=${generated.warnings.length}, duration=${generated.durationMs} ms`
          );
        }

        const rendered = applyTemplateOutputQuality(generated.xml, templateText, {
          postBuildFormat: options.postBuildFormat === true,
          provenanceMode: options.provenanceMode ?? "off",
          provenanceLabel: options.provenanceLabel,
          relativeTemplatePath: relPath,
          formatterMaxConsecutiveBlankLines: Math.max(0, options.formatterMaxConsecutiveBlankLines ?? 2)
        });
        const outputUri = templateToRuntimeUri(templateUri);
        const existing = await readWorkspaceTextFile(outputUri).catch(() => undefined);

        if (existing === rendered) {
          summary.skipped++;
          options.onLogLine?.("SKIPPED");
          options.onFileStatus?.(relPath, "nochange");
          options.onTemplateEvaluated?.(relPath, "nochange", templateText, debugLines);
          continue;
        }

        await ensureParentDirectory(outputUri);
        await vscode.workspace.fs.writeFile(outputUri, Buffer.from(rendered, "utf8"));
        summary.updated++;
        options.onLogLine?.("UPDATED");
        options.onFileStatus?.(relPath, "update");
        options.onTemplateEvaluated?.(relPath, "update", templateText, debugLines);
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

  private async buildWorkspaceComponentLibrary(workspaceFolder: vscode.WorkspaceFolder): Promise<ReturnType<typeof buildComponentLibrary>> {
    const componentUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Components/**/*.xml"));
    const primitiveUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, "XML_Primitives/**/*.xml"));
    const componentSources: Array<{ key: string; text: string; origin: string }> = [];
    for (const uri of [...componentUris, ...primitiveUris]) {
      const key = componentLikeKeyFromUri(workspaceFolder, uri);
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
    return buildComponentLibrary(componentSources);
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
