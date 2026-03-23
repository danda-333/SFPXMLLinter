import * as fs from "node:fs";
import * as path from "node:path";
import Module = require("node:module");

const configuredFixture = process.env.SFP_LINTER_PERF_FIXTURE?.trim();
const workspaceRoot = configuredFixture && configuredFixture.length > 0
  ? path.resolve(configuredFixture)
  : path.resolve(__dirname, "../../../tests/fixtures/linter-performance");
// Defaults tuned for larger real-world workspaces (hundreds of XML files).
// Keep env overrides for stricter local/CI experiments.
const maxPhaseMs = Number(process.env.SFP_LINTER_PERF_LIMIT_MS ?? "2000");
const maxBackgroundValidationMs = Number(process.env.SFP_LINTER_PERF_BG_LIMIT_MS ?? "4500");
const maxXmlRebuildMs = Number(process.env.SFP_LINTER_PERF_REBUILD_LIMIT_MS ?? "5000");
const maxRealStartupMs = parseOptionalThreshold(process.env.SFP_LINTER_PERF_REAL_STARTUP_LIMIT_MS);
const openDocsValidationCount = Math.max(0, Number(process.env.SFP_LINTER_PERF_OPEN_DOCS_COUNT ?? "25"));
const reportJsonPath = process.env.SFP_LINTER_PERF_REPORT_JSON?.trim();

type VscodeMockState = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

const state: VscodeMockState = {
  workspaceRoot,
  config: {
    workspaceRoots: ["XML", "XML_Templates", "XML_Components", "XML_Primitives"],
    resourcesRoots: ["Resources"],
    hoverDocsFiles: [],
    rules: {},
    incompleteMode: false,
    "formatter.maxConsecutiveBlankLines": 2,
    "templateBuilder.autoBuildOnSave": true,
    "templateBuilder.componentSaveBuildScope": "dependents"
  }
};

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

class RelativePattern {
  public readonly baseUri: Uri;
  public readonly pattern: string;
  constructor(base: Uri | { uri: Uri }, pattern: string) {
    this.baseUri = base instanceof Uri ? base : base.uri;
    this.pattern = pattern;
  }
}

class Position {
  public readonly line: number;
  public readonly character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

class Location {
  public readonly uri: Uri;
  public readonly range: Range;
  constructor(uri: Uri, range: Range) {
    this.uri = uri;
    this.range = range;
  }
}

enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

class Diagnostic {
  public readonly range: Range;
  public readonly message: string;
  public readonly severity: DiagnosticSeverity;
  public source?: string;
  public code?: string | number;
  public relatedInformation?: DiagnosticRelatedInformation[];
  constructor(range: Range, message: string, severity: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class DiagnosticRelatedInformation {
  public readonly location: Location;
  public readonly message: string;
  constructor(location: Location, message: string) {
    this.location = location;
    this.message = message;
  }
}

class TextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(uri: Uri, text: string) {
    this.uri = uri;
    this.text = text;
    this.lineStarts = computeLineStarts(text);
  }

  public getText(): string {
    return this.text;
  }

  public positionAt(offset: number): Position {
    const safe = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.lineStarts[mid];
      const next = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
      if (safe < start) {
        high = mid - 1;
      } else if (safe >= next) {
        low = mid + 1;
      } else {
        return new Position(mid, safe - start);
      }
    }

    return new Position(0, safe);
  }
}

const documentCache = new Map<string, TextDocument>();

function loadDocument(uri: Uri): TextDocument {
  const key = uri.toString();
  const cached = documentCache.get(key);
  if (cached) {
    return cached;
  }

  const text = fs.readFileSync(uri.fsPath, "utf8");
  const doc = new TextDocument(uri, text);
  documentCache.set(key, doc);
  return doc;
}

function collectXmlFiles(baseDir: string): Uri[] {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const out: Uri[] = [];
  const stack: string[] = [baseDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && /\.xml$/i.test(entry.name)) {
        out.push(Uri.file(fullPath));
      }
    }
  }

  return out;
}

function parseRootFromPattern(globPattern: string): string | undefined {
  const normalized = globPattern.replace(/\\/g, "/");
  const withoutPrefix = normalized.replace(/^\*\*\//, "");
  const root = withoutPrefix.split("/")[0];
  return root && root.length > 0 ? root : undefined;
}

function resolvePatternInput(pattern: string | RelativePattern): { baseDir: string; pattern: string } {
  if (typeof pattern === "string") {
    return { baseDir: state.workspaceRoot, pattern };
  }

  return { baseDir: pattern.baseUri.fsPath, pattern: pattern.pattern };
}

const vscodeMock = {
  Uri,
  RelativePattern,
  Position,
  Range,
  Location,
  DiagnosticSeverity,
  Diagnostic,
  DiagnosticRelatedInformation,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "linter-perf-fixture", index: 0 }],
    fs: {
      async readFile(uri: Uri): Promise<Uint8Array> {
        const content = await fs.promises.readFile(uri.fsPath);
        return new Uint8Array(content);
      },
      async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        await fs.promises.writeFile(uri.fsPath, Buffer.from(content));
      },
      async createDirectory(uri: Uri): Promise<void> {
        await fs.promises.mkdir(uri.fsPath, { recursive: true });
      }
    },
    async findFiles(pattern: string | RelativePattern): Promise<Uri[]> {
      const { baseDir, pattern: patternText } = resolvePatternInput(pattern);
      const root = parseRootFromPattern(patternText);
      if (!root) {
        return [];
      }

      const target = path.join(baseDir, root);
      return collectXmlFiles(target);
    },
    async openTextDocument(uri: Uri): Promise<TextDocument> {
      return loadDocument(uri);
    },
    getWorkspaceFolder(uri: Uri) {
      const root = path.resolve(state.workspaceRoot).replace(/\\/g, "/").toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(state.workspaceRoot), name: "linter-perf-fixture", index: 0 } : undefined;
    },
    asRelativePath(uri: Uri, _includeWorkspaceFolder: boolean): string {
      return path.relative(state.workspaceRoot, uri.fsPath).replace(/\\/g, "/");
    },
    getConfiguration(section: string) {
      if (section !== "sfpXmlLinter") {
        return {
          get<T>(_key: string, defaultValue: T): T {
            return defaultValue;
          }
        };
      }

      return {
        get<T>(key: string, defaultValue: T): T {
          const value = state.config[key];
          return (value as T | undefined) ?? defaultValue;
        }
      };
    }
  }
};

type RebuildIndexProgressEvent = import("../../indexer/workspaceIndexer").RebuildIndexProgressEvent;
type WorkspaceIndexer = import("../../indexer/workspaceIndexer").WorkspaceIndexer;
type DiagnosticsEngine = import("../../diagnostics/engine").DiagnosticsEngine;
type BuildXmlTemplatesService = import("../../template/buildXmlTemplatesService").BuildXmlTemplatesService;
type loadFeatureManifestRegistryFromRootsFn = typeof import("../../composition/workspace").loadFeatureManifestRegistryFromRoots;

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as {
  WorkspaceIndexer: new (roots?: readonly string[]) => WorkspaceIndexer;
};
const { DiagnosticsEngine } = require("../../diagnostics/engine") as {
  DiagnosticsEngine: new () => DiagnosticsEngine;
};
const { BuildXmlTemplatesService } = require("../../template/buildXmlTemplatesService") as {
  BuildXmlTemplatesService: new () => BuildXmlTemplatesService;
};
const { loadFeatureManifestRegistryFromRoots } = require("../../composition/workspace") as {
  loadFeatureManifestRegistryFromRoots: loadFeatureManifestRegistryFromRootsFn;
};

type DurationStats = {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
  totalMs: number;
};

type ParsedIndexDoneDetails = {
  forms?: number;
  components?: number;
  discoverMs?: number;
  parseMs?: number;
  componentsMs?: number;
  formsMs?: number;
  refsMs?: number;
  traceMs?: number;
};

type IndexMetric = {
  label: string;
  totalMs: number;
  doneMessage?: string;
  doneDetails?: ParsedIndexDoneDetails;
};

type BackgroundValidationMetric = {
  totalMs: number;
  files: number;
  filesWithDiagnostics: number;
  diagnosticsCount: number;
  totalPerFileStats: DurationStats;
  readPerFileStats: DurationStats;
  diagnosticsPerFileStats: DurationStats;
};

type OpenDocsValidationMetric = {
  totalMs: number;
  docs: number;
  diagnosticsCount: number;
  totalPerDocStats: DurationStats;
};

type XmlRebuildMetric = {
  totalMs: number;
  updated: number;
  skipped: number;
  errors: number;
  cache?: {
    fastHits: number;
    fastTotal: number;
    traceHits: number;
    traceTotal: number;
    componentLibrary: "hit" | "miss" | "unknown";
    raw: string;
  };
};

type FeatureRegistryMetric = {
  totalMs: number;
  features: number;
  issues: number;
};

type RealStartupMetric = {
  totalMs: number;
  bootstrapMs: number;
  fullMs: number;
  openDocsMs: number;
  backgroundMs: number;
  parts: {
    templateBootstrap: IndexMetric;
    runtimeBootstrap: IndexMetric;
    templateFull: IndexMetric;
    runtimeFull: IndexMetric;
    registryBootstrap: FeatureRegistryMetric;
    registryFull: FeatureRegistryMetric;
    openDocs: OpenDocsValidationMetric;
    backgroundValidation: BackgroundValidationMetric;
  };
};

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function parseOptionalThreshold(raw: string | undefined): number | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parseIndexDoneDetails(message: string | undefined): ParsedIndexDoneDetails | undefined {
  if (!message) {
    return undefined;
  }

  const readInt = (regex: RegExp): number | undefined => {
    const match = regex.exec(message);
    if (!match?.[1]) {
      return undefined;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : undefined;
  };

  return {
    forms: readInt(/forms=(\d+)/i),
    components: readInt(/components=(\d+)/i),
    discoverMs: readInt(/discover=(\d+)\s*ms/i),
    parseMs: readInt(/parse=(\d+)\s*ms/i),
    componentsMs: readInt(/components=(\d+)\s*ms/i),
    formsMs: readInt(/forms=(\d+)\s*ms/i),
    refsMs: readInt(/refs=(\d+)\s*ms/i),
    traceMs: readInt(/trace=(\d+)\s*ms/i)
  };
}

function summarizeDurations(values: readonly number[]): DurationStats {
  if (values.length === 0) {
    return {
      count: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      avgMs: 0,
      totalMs: 0
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  const percentile = (p: number): number => {
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    const index = Math.max(0, Math.min(sorted.length - 1, rank));
    return sorted[index];
  };

  return {
    count: sorted.length,
    minMs: sorted[0],
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    maxMs: sorted[sorted.length - 1],
    avgMs: total / sorted.length,
    totalMs: total
  };
}

async function measureIndex(
  label: string,
  indexer: WorkspaceIndexer,
  scope: "bootstrap" | "all"
): Promise<IndexMetric> {
  let lastDoneMessage = "";
  const started = Date.now();
  await indexer.rebuildIndex({
    scope,
    onProgress: (event: RebuildIndexProgressEvent) => {
      if (event.phase === "done" && event.message) {
        lastDoneMessage = event.message;
      }
    }
  });
  const durationMs = Date.now() - started;
  console.log(`[linter:perf] ${label}: ${durationMs} ms`);
  if (lastDoneMessage) {
    console.log(`[linter:perf] ${label} details: ${lastDoneMessage}`);
  }
  return {
    label,
    totalMs: durationMs,
    doneMessage: lastDoneMessage || undefined,
    doneDetails: parseIndexDoneDetails(lastDoneMessage)
  };
}

function getIndexDomainForUri(uri: Uri): "template" | "runtime" | "other" {
  const rel = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)xml_templates\//.test(rel) || /(^|\/)xml_components\//.test(rel)) {
    return "template";
  }
  if (/(^|\/)xml\//.test(rel)) {
    return "runtime";
  }
  return "other";
}

function collectAllLinterUris(): Uri[] {
  return [
    ...collectXmlFiles(path.join(workspaceRoot, "XML_Templates")),
    ...collectXmlFiles(path.join(workspaceRoot, "XML_Components")),
    ...collectXmlFiles(path.join(workspaceRoot, "XML_Primitives")),
    ...collectXmlFiles(path.join(workspaceRoot, "XML"))
  ];
}

async function measureBackgroundValidation(
  templateIndexer: WorkspaceIndexer,
  runtimeIndexer: WorkspaceIndexer
): Promise<BackgroundValidationMetric> {
  const engine = new DiagnosticsEngine();
  const uris = collectAllLinterUris().filter((uri) => getIndexDomainForUri(uri) !== "other");
  const CONCURRENCY = 8;
  let diagnosticsCount = 0;
  let filesWithDiagnostics = 0;
  const totalPerFileMs: number[] = [];
  const readPerFileMs: number[] = [];
  const diagnosticsPerFileMs: number[] = [];

  const started = Date.now();
  for (let i = 0; i < uris.length; i += CONCURRENCY) {
    const batch = uris.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (uri) => {
        const fileStartedAt = Date.now();
        const readStartedAt = Date.now();
        const text = readWorkspaceFileText(uri.fsPath);
        const readMs = Date.now() - readStartedAt;
        const doc = createVirtualXmlDocument(uri, text);
        const domain = getIndexDomainForUri(uri);
        const index = domain === "runtime" ? runtimeIndexer.getIndex() : templateIndexer.getIndex();
        const diagnosticsStartedAt = Date.now();
        const diagnostics = engine.buildDiagnostics(doc as unknown as import("vscode").TextDocument, index);
        const diagnosticsMs = Date.now() - diagnosticsStartedAt;
        const totalMs = Date.now() - fileStartedAt;
        totalPerFileMs.push(totalMs);
        readPerFileMs.push(readMs);
        diagnosticsPerFileMs.push(diagnosticsMs);
        diagnosticsCount += diagnostics.length;
        if (diagnostics.length > 0) {
          filesWithDiagnostics += 1;
        }
      })
    );
    const processed = Math.min(i + CONCURRENCY, uris.length);
    if (processed % 200 === 0 || processed === uris.length) {
      console.log(`[linter:perf] background/validation progress ${processed}/${uris.length}`);
      await sleep(1);
    }
  }
  const durationMs = Date.now() - started;
  console.log(
    `[linter:perf] background/validation: ${durationMs} ms (files=${uris.length}, filesWithDiagnostics=${filesWithDiagnostics}, diagnostics=${diagnosticsCount})`
  );
  return {
    totalMs: durationMs,
    files: uris.length,
    filesWithDiagnostics,
    diagnosticsCount,
    totalPerFileStats: summarizeDurations(totalPerFileMs),
    readPerFileStats: summarizeDurations(readPerFileMs),
    diagnosticsPerFileStats: summarizeDurations(diagnosticsPerFileMs)
  };
}

async function measureFeatureRegistryRebuild(): Promise<FeatureRegistryMetric> {
  const roots = [workspaceRoot];
  const started = Date.now();
  const registry = loadFeatureManifestRegistryFromRoots(roots);
  const durationMs = Date.now() - started;
  console.log(
    `[linter:perf] composition/registry-rebuild: ${durationMs} ms (features=${registry.manifestsByFeature.size}, issues=${registry.issues.length})`
  );
  return {
    totalMs: durationMs,
    features: registry.manifestsByFeature.size,
    issues: registry.issues.length
  };
}

async function measureOpenDocumentsValidation(
  templateIndexer: WorkspaceIndexer,
  runtimeIndexer: WorkspaceIndexer,
  maxDocs: number
): Promise<OpenDocsValidationMetric> {
  if (maxDocs <= 0) {
    console.log("[linter:perf] open-docs/validation: 0 ms (docs=0)");
    return {
      totalMs: 0,
      docs: 0,
      diagnosticsCount: 0,
      totalPerDocStats: summarizeDurations([])
    };
  }

  const engine = new DiagnosticsEngine();
  const uris = collectAllLinterUris()
    .filter((uri) => getIndexDomainForUri(uri) !== "other")
    .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
    .slice(0, maxDocs);

  let diagnosticsCount = 0;
  const perDocMs: number[] = [];
  const started = Date.now();
  for (const uri of uris) {
    const docStartedAt = Date.now();
    const text = readWorkspaceFileText(uri.fsPath);
    const doc = createVirtualXmlDocument(uri, text);
    const domain = getIndexDomainForUri(uri);
    const index = domain === "runtime" ? runtimeIndexer.getIndex() : templateIndexer.getIndex();
    const diagnostics = engine.buildDiagnostics(doc as unknown as import("vscode").TextDocument, index);
    perDocMs.push(Date.now() - docStartedAt);
    diagnosticsCount += diagnostics.length;
  }

  const durationMs = Date.now() - started;
  console.log(`[linter:perf] open-docs/validation: ${durationMs} ms (docs=${uris.length}, diagnostics=${diagnosticsCount})`);
  return {
    totalMs: durationMs,
    docs: uris.length,
    diagnosticsCount,
    totalPerDocStats: summarizeDurations(perDocMs)
  };
}

async function measureXmlRebuild(): Promise<XmlRebuildMetric> {
  const workspaceFolder = vscodeMock.workspace.workspaceFolders[0];
  const service = new BuildXmlTemplatesService();
  let cacheRaw = "";
  const started = Date.now();
  const result = await service.run(workspaceFolder as unknown as import("vscode").WorkspaceFolder, {
    silent: true,
    mode: "fast",
    postBuildFormat: true,
    provenanceMode: "off",
    formatterMaxConsecutiveBlankLines: 2,
    generatorsEnabled: true,
    generatorTimeoutMs: 300,
    generatorEnableUserScripts: true,
    generatorUserScriptsRoots: ["XML_Generators"],
    onLogLine: (line: string) => {
      if (/^Done\./i.test(line) && line.includes("Cache:")) {
        cacheRaw = line.trim();
      }
    }
  });
  const durationMs = Date.now() - started;
  const summary = result.summary ?? { updated: 0, skipped: 0, errors: 0 };
  const cache = parseBuildCacheSummary(cacheRaw);
  console.log(
    `[linter:perf] xml/rebuild: ${durationMs} ms (updated=${summary.updated}, skipped=${summary.skipped}, errors=${summary.errors}${cache ? `, fast=${cache.fastHits}/${cache.fastTotal}, trace=${cache.traceHits}/${cache.traceTotal}, componentLibrary=${cache.componentLibrary}` : ""})`
  );
  return {
    totalMs: durationMs,
    updated: summary.updated,
    skipped: summary.skipped,
    errors: summary.errors,
    cache
  };
}

function parseBuildCacheSummary(line: string): XmlRebuildMetric["cache"] | undefined {
  const text = line.trim();
  if (text.length === 0) {
    return undefined;
  }
  const fastMatch = /fast=(\d+)\/(\d+)/i.exec(text);
  const traceMatch = /trace=(\d+)\/(\d+)/i.exec(text);
  const componentMatch = /componentLibrary=(hit|miss)/i.exec(text);
  if (!fastMatch || !traceMatch) {
    return undefined;
  }

  const fastHits = Number(fastMatch[1]);
  const fastTotal = Number(fastMatch[2]);
  const traceHits = Number(traceMatch[1]);
  const traceTotal = Number(traceMatch[2]);
  const componentLibrary = (componentMatch?.[1]?.toLowerCase() ?? "unknown") as "hit" | "miss" | "unknown";

  return {
    fastHits: Number.isFinite(fastHits) ? fastHits : 0,
    fastTotal: Number.isFinite(fastTotal) ? fastTotal : 0,
    traceHits: Number.isFinite(traceHits) ? traceHits : 0,
    traceTotal: Number.isFinite(traceTotal) ? traceTotal : 0,
    componentLibrary,
    raw: text
  };
}

async function measureRealStartupPipeline(): Promise<RealStartupMetric> {
  documentCache.clear();

  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components", "XML_Primitives"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);

  const started = Date.now();

  const bootstrapTemplate = await measureIndex("startup/template/bootstrap", templateIndexer, "bootstrap");
  const bootstrapRuntime = await measureIndex("startup/runtime/bootstrap", runtimeIndexer, "bootstrap");
  const bootstrapRegistry = await measureFeatureRegistryRebuild();

  const fullTemplate = await measureIndex("startup/template/full", templateIndexer, "all");
  const fullRuntime = await measureIndex("startup/runtime/full", runtimeIndexer, "all");
  const fullRegistry = await measureFeatureRegistryRebuild();

  const openDocs = await measureOpenDocumentsValidation(templateIndexer, runtimeIndexer, openDocsValidationCount);
  const background = await measureBackgroundValidation(templateIndexer, runtimeIndexer);
  const totalMs = Date.now() - started;
  const bootstrapMs = bootstrapTemplate.totalMs + bootstrapRuntime.totalMs + bootstrapRegistry.totalMs;
  const fullMs = fullTemplate.totalMs + fullRuntime.totalMs + fullRegistry.totalMs;

  console.log(
    `[linter:perf] real-startup: ${totalMs} ms (bootstrap=${bootstrapMs} ms, full=${fullMs} ms, openDocs=${openDocs.totalMs} ms, background=${background.totalMs} ms)`
  );

  return {
    totalMs,
    bootstrapMs,
    fullMs,
    openDocsMs: openDocs.totalMs,
    backgroundMs: background.totalMs,
    parts: {
      templateBootstrap: bootstrapTemplate,
      runtimeBootstrap: bootstrapRuntime,
      templateFull: fullTemplate,
      runtimeFull: fullRuntime,
      registryBootstrap: bootstrapRegistry,
      registryFull: fullRegistry,
      openDocs,
      backgroundValidation: background
    }
  };
}

function readWorkspaceFileText(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function createVirtualXmlDocument(uri: Uri, text: string): TextDocument {
  return new TextDocument(uri, text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  if (!fs.existsSync(workspaceRoot)) {
    throw new Error(`Performance fixture not found: ${workspaceRoot}`);
  }

  console.log(`[linter:perf] Fixture: ${workspaceRoot}`);
  console.log(`[linter:perf] Threshold per startup phase: ${maxPhaseMs} ms`);
  console.log(`[linter:perf] Threshold background validation: ${maxBackgroundValidationMs} ms`);
  console.log(`[linter:perf] Threshold XML rebuild: ${maxXmlRebuildMs} ms`);
  if (maxRealStartupMs) {
    console.log(`[linter:perf] Threshold real startup: ${maxRealStartupMs} ms`);
  }

  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);

  const templateBootstrap = await measureIndex("template/bootstrap", templateIndexer, "bootstrap");
  const templateFull = await measureIndex("template/full", templateIndexer, "all");
  const runtimeFull = await measureIndex("runtime/full", runtimeIndexer, "all");
  const backgroundValidation = await measureBackgroundValidation(templateIndexer, runtimeIndexer);
  const xmlRebuild = await measureXmlRebuild();
  const realStartup = await measureRealStartupPipeline();

  const report = {
    fixture: workspaceRoot,
    thresholds: {
      phaseMs: maxPhaseMs,
      backgroundValidationMs: maxBackgroundValidationMs,
      xmlRebuildMs: maxXmlRebuildMs,
      realStartupMs: maxRealStartupMs
    },
    metrics: {
      templateBootstrap,
      templateFull,
      runtimeFull,
      backgroundValidation,
      xmlRebuild,
      realStartup
    }
  };
  console.log("[linter:perf] metrics-summary");
  console.log(JSON.stringify(report, null, 2));
  if (reportJsonPath && reportJsonPath.length > 0) {
    const target = path.resolve(reportJsonPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[linter:perf] metrics written: ${target}`);
  }

  const violations: string[] = [];
  if (templateBootstrap.totalMs > maxPhaseMs) {
    violations.push(`template/bootstrap=${templateBootstrap.totalMs} ms`);
  }
  if (templateFull.totalMs > maxPhaseMs) {
    violations.push(`template/full=${templateFull.totalMs} ms`);
  }
  if (runtimeFull.totalMs > maxPhaseMs) {
    violations.push(`runtime/full=${runtimeFull.totalMs} ms`);
  }
  if (backgroundValidation.totalMs > maxBackgroundValidationMs) {
    violations.push(`background/validation=${backgroundValidation.totalMs} ms`);
  }
  if (xmlRebuild.totalMs > maxXmlRebuildMs) {
    violations.push(`xml/rebuild=${xmlRebuild.totalMs} ms`);
  }
  if (maxRealStartupMs && realStartup.totalMs > maxRealStartupMs) {
    violations.push(`real-startup=${realStartup.totalMs} ms`);
  }

  if (violations.length > 0) {
    throw new Error(
      `Startup performance threshold exceeded (${maxPhaseMs} ms): ${violations.join(", ")}`
    );
  }

  console.log("[linter:perf] PASS all startup phases are within threshold.");
}

void run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[linter:perf] FAIL ${message}`);
  process.exitCode = 1;
});
