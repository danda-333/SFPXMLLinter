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
  constructor(range: Range, message: string, severity: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
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

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

async function measureIndex(
  label: string,
  indexer: WorkspaceIndexer,
  scope: "bootstrap" | "all"
): Promise<number> {
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
  return durationMs;
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
): Promise<number> {
  const engine = new DiagnosticsEngine();
  const uris = collectAllLinterUris().filter((uri) => getIndexDomainForUri(uri) !== "other");
  const CONCURRENCY = 8;
  let diagnosticsCount = 0;
  let filesWithDiagnostics = 0;

  const started = Date.now();
  for (let i = 0; i < uris.length; i += CONCURRENCY) {
    const batch = uris.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (uri) => {
        const text = readWorkspaceFileText(uri.fsPath);
        const doc = createVirtualXmlDocument(uri, text);
        const domain = getIndexDomainForUri(uri);
        const index = domain === "runtime" ? runtimeIndexer.getIndex() : templateIndexer.getIndex();
        const diagnostics = engine.buildDiagnostics(doc as unknown as import("vscode").TextDocument, index);
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
  return durationMs;
}

async function measureXmlRebuild(): Promise<number> {
  const workspaceFolder = vscodeMock.workspace.workspaceFolders[0];
  const service = new BuildXmlTemplatesService();
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
    generatorUserScriptsRoots: ["XML_Generators"]
  });
  const durationMs = Date.now() - started;
  const summary = result.summary ?? { updated: 0, skipped: 0, errors: 0 };
  console.log(
    `[linter:perf] xml/rebuild: ${durationMs} ms (updated=${summary.updated}, skipped=${summary.skipped}, errors=${summary.errors})`
  );
  return durationMs;
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

  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);

  const templateBootstrapMs = await measureIndex("template/bootstrap", templateIndexer, "bootstrap");
  const templateFullMs = await measureIndex("template/full", templateIndexer, "all");
  const runtimeFullMs = await measureIndex("runtime/full", runtimeIndexer, "all");
  const backgroundValidationMs = await measureBackgroundValidation(templateIndexer, runtimeIndexer);
  const xmlRebuildMs = await measureXmlRebuild();

  const violations: string[] = [];
  if (templateBootstrapMs > maxPhaseMs) {
    violations.push(`template/bootstrap=${templateBootstrapMs} ms`);
  }
  if (templateFullMs > maxPhaseMs) {
    violations.push(`template/full=${templateFullMs} ms`);
  }
  if (runtimeFullMs > maxPhaseMs) {
    violations.push(`runtime/full=${runtimeFullMs} ms`);
  }
  if (backgroundValidationMs > maxBackgroundValidationMs) {
    violations.push(`background/validation=${backgroundValidationMs} ms`);
  }
  if (xmlRebuildMs > maxXmlRebuildMs) {
    violations.push(`xml/rebuild=${xmlRebuildMs} ms`);
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
