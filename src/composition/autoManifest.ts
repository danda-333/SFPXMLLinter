import * as fs from "node:fs";
import * as path from "node:path";
import {
  FeatureContextKind,
  FeatureManifest,
  FeatureManifestContribution,
  FeatureManifestContributionKind,
  FeatureManifestDependencyRef,
  FeatureManifestPart,
  FeatureManifestSymbolRef,
  FeatureReferenceKind,
  FeatureSymbolKind
} from "./model";

const CONTRIBUTION_REGEX = /<\s*(Contribution|Section)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\s*\1\s*>)/gi;
const MANIFEST_REGEX = /<\s*Manifest\b([^>]*)>([\s\S]*?)<\/\s*Manifest\s*>/i;
const CONTRIBUTION_CONTRACT_REGEX = /<\s*ContributionContract\b([^>]*)>([\s\S]*?)<\/\s*ContributionContract\s*>/gi;
const ATTR_REGEX = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SYMBOL_ITEM_REGEX = /<\s*Symbol\b([^>]*?)\/>/gi;
const REF_ITEM_REGEX = /<\s*Ref\b([^>]*?)\/>/gi;

type XmlPartContract = {
  description?: string;
  tags: string[];
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  requires: FeatureManifestDependencyRef[];
  contributionContractsByKey: Map<string, XmlContributionContract>;
};

type XmlContributionContract = {
  id?: string;
  key?: string;
  kind?: FeatureManifestContributionKind;
  summary?: string;
  note?: string;
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  expectsXPath: string[];
  requires: FeatureManifestDependencyRef[];
  touches: FeatureManifestDependencyRef[];
};

type ContributionExtraction = {
  id: string;
  name?: string;
  kind: FeatureManifestContributionKind;
  summary?: string;
  targetXPath?: string;
  insert?: string;
  contexts: FeatureContextKind[];
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  expectsXPath: string[];
  requires: FeatureManifestDependencyRef[];
  touches: FeatureManifestDependencyRef[];
  note?: string;
};

type AutoManifestPartBuild = {
  part: FeatureManifestPart;
  description?: string;
  tags: string[];
  requires: FeatureManifestDependencyRef[];
  expects: FeatureManifestSymbolRef[];
};

export interface AutoManifestSourceFile {
  filePath: string;
  relativePath: string;
  text: string;
}

export interface AutoManifestCandidate {
  feature: string;
  sourceFiles: AutoManifestSourceFile[];
  manifest: FeatureManifest;
}

export function discoverAutoManifestSourceFiles(rootDir: string): AutoManifestSourceFile[] {
  const out: AutoManifestSourceFile[] = [];
  walk(rootDir, out, rootDir);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export function buildAutoManifestCandidates(rootDir: string): AutoManifestCandidate[] {
  const files = discoverAutoManifestSourceFiles(rootDir);
  const groups = new Map<string, AutoManifestSourceFile[]>();

  for (const file of files) {
    const feature = inferFeatureNameFromRelativePath(file.relativePath);
    const list = groups.get(feature) ?? [];
    list.push(file);
    groups.set(feature, list);
  }

  const out: AutoManifestCandidate[] = [];
  for (const [feature, sourceFiles] of groups.entries()) {
    const manifest = buildAutoManifestFromFiles(feature, sourceFiles);
    out.push({ feature, sourceFiles, manifest });
  }

  out.sort((a, b) => a.feature.localeCompare(b.feature));
  return out;
}

export function buildAutoManifestFromFiles(feature: string, sourceFiles: readonly AutoManifestSourceFile[]): FeatureManifest {
  const builtParts = sourceFiles.map((file) => buildAutoManifestPart(file));
  const parts = builtParts.map((item) => item.part);
  const tags = uniqueStrings([
    ...collectTagsFromParts(parts),
    ...builtParts.flatMap((item) => item.tags)
  ]);
  const description = builtParts.map((item) => item.description).find((value) => !!value);

  return {
    version: 1,
    feature,
    ...(description ? { description } : { description: `Auto-generated manifest for feature '${feature}'.` }),
    entrypoint: sourceFiles[0]?.relativePath,
    tags,
    parts,
    requires: uniqueDependencies(builtParts.flatMap((item) => item.requires)),
    expects: uniqueSymbols(builtParts.flatMap((item) => item.expects)),
    source: `auto:${feature}`
  };
}

function buildAutoManifestPart(file: AutoManifestSourceFile): AutoManifestPartBuild {
  const stem = stripFeatureFileExtension(path.basename(file.relativePath).replace(/\\/g, "/"));
  const contract = parseXmlManifestBlock(file.text);
  const contributions = collectContributions(file.text, contract.contributionContractsByKey);
  const appliesTo = uniqueContexts(contributions.flatMap((item) => item.contexts));
  const partProvides = uniqueSymbols([
    ...contract.provides,
    ...contributions.flatMap((item) => item.provides)
  ]);
  const partExpects = uniqueSymbols([
    ...contract.expects,
    ...contributions.flatMap((item) => item.expects)
  ]);

  return {
    part: {
      id: stem,
      file: file.relativePath.replace(/\\/g, "/"),
      appliesTo: appliesTo.length > 0 ? appliesTo : inferContextsFromStem(stem),
      provides: partProvides,
      expects: partExpects,
      contributions: contributions.map(toManifestContribution)
    },
    description: contract.description,
    tags: contract.tags,
    requires: uniqueDependencies([
      ...contract.requires,
      ...contributions.flatMap((item) => item.requires)
    ]),
    expects: partExpects
  };
}

function toManifestContribution(contribution: ContributionExtraction): FeatureManifestContribution {
  return {
    id: contribution.id,
    ...(contribution.name ? { name: contribution.name } : {}),
    kind: contribution.kind,
    ...(contribution.summary ? { summary: contribution.summary } : {}),
    ...(contribution.targetXPath ? { targetXPath: contribution.targetXPath } : {}),
    ...(contribution.insert ? { insert: contribution.insert } : {}),
    appliesTo: contribution.contexts,
    provides: contribution.provides,
    expects: contribution.expects,
    expectsXPath: contribution.expectsXPath,
    requires: contribution.requires,
    touches: contribution.touches,
    ...(contribution.note ? { note: contribution.note } : {})
  };
}

function collectContributions(text: string, contractsByKey: ReadonlyMap<string, XmlContributionContract>): ContributionExtraction[] {
  const out: ContributionExtraction[] = [];
  let index = 0;
  for (const match of text.matchAll(CONTRIBUTION_REGEX)) {
    const attrs = parseAttributes(match[2] ?? "");
    const content = match[3] ?? "";
    const name = normalizeString(attrs.get("Name"));
    const targetXPath = normalizeString(attrs.get("TargetXPath"));
    const insert = normalizeString(attrs.get("Insert"));
    const baseKind = normalizeContributionKind(attrs.get("Kind")) ?? inferContributionKind(insert, targetXPath, content);
    const contract = selectContributionContract(contractsByKey, name, index);
    const inlineContract = parseInlineContributionContract(content);
    out.push({
      id: contract?.id || buildContributionId(name, targetXPath, insert, baseKind, index),
      ...(name ? { name } : {}),
      kind: contract?.kind ?? inlineContract.kind ?? baseKind,
      ...(contract?.summary || normalizeString(attrs.get("Summary")) || inlineContract.summary
        ? { summary: contract?.summary ?? normalizeString(attrs.get("Summary")) ?? inlineContract.summary }
        : {}),
      ...(targetXPath ? { targetXPath } : {}),
      ...(insert ? { insert } : {}),
      contexts: parseContributionContexts(attrs.get("Root")),
      provides: uniqueSymbols([
        ...inlineContract.provides,
        ...(contract?.provides ?? [])
      ]),
      expects: uniqueSymbols([
        ...inlineContract.expects,
        ...(contract?.expects ?? [])
      ]),
      expectsXPath: uniqueStrings([
        ...inlineContract.expectsXPath,
        ...(contract?.expectsXPath ?? [])
      ]),
      requires: uniqueDependencies([
        ...inlineContract.requires,
        ...(contract?.requires ?? [])
      ]),
      touches: uniqueDependencies([
        ...inlineContract.touches,
        ...(contract?.touches ?? [])
      ]),
      ...(contract?.note || inlineContract.note ? { note: contract?.note ?? inlineContract.note } : {})
    });
    index += 1;
  }

  return out;
}

function parseXmlManifestBlock(text: string): XmlPartContract {
  const match = MANIFEST_REGEX.exec(text);
  if (!match) {
    return {
      tags: [],
      provides: [],
      expects: [],
      requires: [],
      contributionContractsByKey: new Map<string, XmlContributionContract>()
    };
  }

  const attrs = parseAttributes(match[1] ?? "");
  const body = match[2] ?? "";
  const tags = parseDelimitedValues(attrs.get("Tags"));
  const description = normalizeString(attrs.get("Description"));

  return {
    ...(description ? { description } : {}),
    tags,
    provides: parseSymbolSection(body, "Provides"),
    expects: parseSymbolSection(body, "Expects"),
    requires: parseDependencySection(body, "Requires"),
    contributionContractsByKey: parseContributionContracts(body)
  };
}

function parseContributionContracts(body: string): Map<string, XmlContributionContract> {
  const out = new Map<string, XmlContributionContract>();
  for (const match of body.matchAll(CONTRIBUTION_CONTRACT_REGEX)) {
    const attrs = parseAttributes(match[1] ?? "");
    const contractBody = match[2] ?? "";
    const key = normalizeString(attrs.get("For")) ?? normalizeString(attrs.get("Name")) ?? normalizeString(attrs.get("Id"));
    if (!key) {
      continue;
    }

    const summary = normalizeString(attrs.get("Summary"));
    const note = normalizeString(attrs.get("Note"));
    out.set(key.toLowerCase(), {
      ...(normalizeString(attrs.get("Id")) ? { id: normalizeString(attrs.get("Id")) } : {}),
      key,
      ...(normalizeContributionKind(attrs.get("Kind")) ? { kind: normalizeContributionKind(attrs.get("Kind")) } : {}),
      ...(summary ? { summary } : {}),
      ...(note ? { note } : {}),
      provides: parseSymbolSection(contractBody, "Provides"),
      expects: parseSymbolSection(contractBody, "Expects"),
      expectsXPath: parseXPathSection(contractBody, "ExpectsXPath", "ExpectsXPaths"),
      requires: parseDependencySection(contractBody, "Requires"),
      touches: parseDependencySection(contractBody, "Touches")
    });
  }
  return out;
}

function parseInlineContributionContract(body: string): XmlContributionContract {
  return {
    provides: parseSymbolSection(body, "Provides"),
    expects: parseSymbolSection(body, "Expects"),
    expectsXPath: parseXPathSection(body, "ExpectsXPath", "ExpectsXPaths"),
    requires: parseDependencySection(body, "Requires"),
    touches: parseDependencySection(body, "Touches")
  };
}

function parseXPathSection(body: string, ...tagNames: string[]): string[] {
  for (const tagName of tagNames) {
    const block = extractSectionBody(body, tagName);
    if (!block) {
      continue;
    }

    const out: string[] = [];
    const regex = /<\s*XPath\b[^>]*>([\s\S]*?)<\/\s*XPath\s*>/gi;
    for (const match of block.matchAll(regex)) {
      const value = normalizeString(match[1]);
      if (value) {
        out.push(value);
      }
    }

    return uniqueStrings(out);
  }
  return [];
}

function parseSymbolSection(body: string, tagName: string): FeatureManifestSymbolRef[] {
  const block = extractSectionBody(body, tagName);
  if (!block) {
    return [];
  }

  const out: FeatureManifestSymbolRef[] = [];
  for (const match of block.matchAll(SYMBOL_ITEM_REGEX)) {
    const attrs = parseAttributes(match[1] ?? "");
    const kind = normalizeSymbolKind(attrs.get("Kind"));
    const ident = normalizeString(attrs.get("Ident"));
    if (!kind || !ident) {
      continue;
    }

    const note = normalizeString(attrs.get("Note"));
    out.push({
      kind,
      ident,
      ...(note ? { note } : {})
    });
  }

  return uniqueSymbols(out);
}

function parseDependencySection(body: string, tagName: string): FeatureManifestDependencyRef[] {
  const block = extractSectionBody(body, tagName);
  if (!block) {
    return [];
  }

  const out: FeatureManifestDependencyRef[] = [];
  for (const match of block.matchAll(REF_ITEM_REGEX)) {
    const attrs = parseAttributes(match[1] ?? "");
    const kind = normalizeReferenceKind(attrs.get("Kind"));
    const ident = normalizeString(attrs.get("Ident"));
    if (!kind || !ident) {
      continue;
    }

    const note = normalizeString(attrs.get("Note"));
    out.push({
      kind,
      ident,
      ...(note ? { note } : {})
    });
  }

  return uniqueDependencies(out);
}

function extractSectionBody(body: string, tagName: string): string | undefined {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<\\s*${escaped}\\b[^>]*>([\\s\\S]*?)<\\/\\s*${escaped}\\s*>`, "i");
  const match = regex.exec(body);
  return match?.[1];
}

function selectContributionContract(
  contractsByKey: ReadonlyMap<string, XmlContributionContract>,
  name: string | undefined,
  index: number
): XmlContributionContract | undefined {
  if (name) {
    return contractsByKey.get(name.toLowerCase());
  }

  return contractsByKey.get(index.toString());
}

function buildContributionId(
  name: string | undefined,
  targetXPath: string | undefined,
  insert: string | undefined,
  kind: FeatureManifestContributionKind,
  index: number
): string {
  return [name, targetXPath, insert, kind, index.toString()].filter((value) => value && value.length > 0).join("|");
}

function inferContributionKind(
  insert: string | undefined,
  targetXPath: string | undefined,
  content: string
): FeatureManifestContributionKind {
  const normalizedInsert = normalizeString(insert)?.toLowerCase();
  if (normalizedInsert === "placeholder") {
    return "placeholder";
  }

  if (normalizedInsert === "before" || normalizedInsert === "after") {
    return "decorate";
  }

  const normalizedTarget = normalizeString(targetXPath)?.toLowerCase() ?? "";
  if (normalizedTarget.includes("@ident=")) {
    return "extend-existing";
  }

  if (/<string>\s*~\//i.test(content) || /ExternalJavaScriptRelativePaths/i.test(content)) {
    return "asset";
  }

  return "provide";
}

function parseContributionContexts(rawRoot: string | undefined): FeatureContextKind[] {
  if (!rawRoot) {
    return [];
  }

  const values = rawRoot
    .split(/[,;| ]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const out: FeatureContextKind[] = [];
  for (const value of values) {
    if (
      value === "form" ||
      value === "workflow" ||
      value === "dataview" ||
      value === "view" ||
      value === "filter" ||
      value === "component"
    ) {
      const context = value as FeatureContextKind;
      if (!out.includes(context)) {
        out.push(context);
      }
    }
  }

  return out;
}

function parseAttributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of raw.matchAll(ATTR_REGEX)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }

    out.set(key, (match[2] ?? match[3] ?? "").trim());
  }

  return out;
}

function inferFeatureNameFromRelativePath(relativePath: string): string {
  const stem = stripFeatureFileExtension(path.basename(relativePath).replace(/\\/g, "/"));
  const firstSegment = stem.split(".")[0]?.trim();
  return firstSegment || stem;
}

function inferContextsFromStem(stem: string): FeatureContextKind[] {
  const lower = stem.toLowerCase();
  if (lower.includes(".workflow")) {
    return ["workflow"];
  }
  if (lower.includes(".dataview")) {
    return ["dataview"];
  }
  if (lower.includes(".view")) {
    return ["view"];
  }
  if (lower.includes(".filter")) {
    return ["filter"];
  }
  if (lower.includes(".component")) {
    return ["component"];
  }
  return ["form"];
}

function stripFeatureFileExtension(fileName: string): string {
  return fileName
    .replace(/\.feature\.xml$/i, "")
    .replace(/\.component\.xml$/i, "")
    .replace(/\.xml$/i, "");
}

function uniqueSymbols(values: FeatureManifestSymbolRef[]): FeatureManifestSymbolRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestSymbolRef[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.ident}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueDependencies(values: FeatureManifestDependencyRef[]): FeatureManifestDependencyRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestDependencyRef[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.ident}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueContexts(values: FeatureContextKind[]): FeatureContextKind[] {
  const out: FeatureContextKind[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || out.includes(normalized)) {
      continue;
    }

    out.push(normalized);
  }

  return out;
}

function collectTagsFromParts(parts: readonly FeatureManifestPart[]): string[] {
  const tags = new Set<string>();
  for (const part of parts) {
    for (const context of part.appliesTo) {
      tags.add(context);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function parseDelimitedValues(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return uniqueStrings(
    raw
      .split(/[,;|]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function normalizeString(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed || undefined;
}

function normalizeContributionKind(raw: string | undefined): FeatureManifestContributionKind | undefined {
  const normalized = normalizeString(raw)?.toLowerCase();
  if (
    normalized === "provide" ||
    normalized === "extend-existing" ||
    normalized === "placeholder" ||
    normalized === "decorate" ||
    normalized === "asset" ||
    normalized === "other"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeSymbolKind(raw: string | undefined): FeatureSymbolKind | undefined {
  const normalized = normalizeString(raw) as FeatureSymbolKind | undefined;
  if (
    normalized === "control" ||
    normalized === "button" ||
    normalized === "section" ||
    normalized === "actionShareCode" ||
    normalized === "buttonShareCode" ||
    normalized === "controlShareCode" ||
    normalized === "column" ||
    normalized === "component" ||
    normalized === "datasource" ||
    normalized === "parameter" ||
    normalized === "other"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeReferenceKind(raw: string | undefined): FeatureReferenceKind | undefined {
  const normalized = normalizeString(raw) as FeatureReferenceKind | undefined;
  if (
    normalized === "feature" ||
    normalized === "control" ||
    normalized === "button" ||
    normalized === "section" ||
    normalized === "actionShareCode" ||
    normalized === "buttonShareCode" ||
    normalized === "controlShareCode" ||
    normalized === "column" ||
    normalized === "component" ||
    normalized === "datasource" ||
    normalized === "parameter" ||
    normalized === "other"
  ) {
    return normalized;
  }

  return undefined;
}

function walk(dir: string, out: AutoManifestSourceFile[], rootDir: string): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out, rootDir);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".feature.xml") && !lower.endsWith(".component.xml")) {
      continue;
    }

    out.push({
      filePath: fullPath,
      relativePath: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
      text: fs.readFileSync(fullPath, "utf8")
    });
  }
}
