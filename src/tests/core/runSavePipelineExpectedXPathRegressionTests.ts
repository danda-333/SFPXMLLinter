import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import Module = require("node:module");

function resolveWorkspaceRoot(): string {
  const fromEnv = process.env.SFP_SAVE_PIPELINE_WORKSPACE?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }

  const candidates = [
    path.resolve(process.cwd(), "../../packages/packages_itsm"),
    path.resolve(process.cwd(), "../packages/packages_itsm"),
    path.resolve(__dirname, "../../../../packages/packages_itsm"),
    path.resolve(__dirname, "../../../../../packages/packages_itsm")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(__dirname, "../../../tests/fixtures/linter-performance");
}

const workspaceRoot = resolveWorkspaceRoot();

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      const raw = value.slice("file://".length);
      return new Uri(raw);
    }
    return new Uri(value);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }

  public get scheme(): string {
    return "file";
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

class Diagnostic {
  public readonly range: Range;
  public readonly message: string;
  public readonly severity: number;
  public source?: string;
  public code?: string | number;
  constructor(range: Range, message: string, severity: number) {
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

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3
} as const;

const workspaceTextDocuments: MockTextDocument[] = [];
class RelativePattern {
  public readonly base: { uri: Uri } | Uri;
  public readonly pattern: string;
  constructor(base: { uri: Uri } | Uri, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
}
const vscodeMock = {
  Uri,
  RelativePattern,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "sfp-workspace", index: 0 }],
    textDocuments: workspaceTextDocuments,
    asRelativePath(input: Uri | string): string {
      const fsPath = typeof input === "string" ? input : input.fsPath;
      return path.relative(workspaceRoot, fsPath).replace(/\\/g, "/");
    },
    getConfiguration() {
      return {
        get<T>(_key: string, defaultValue: T): T {
          return defaultValue;
        }
      };
    },
    getWorkspaceFolder(uri: Uri): { uri: Uri; name: string; index: number } | undefined {
      const candidate = uri.fsPath.replace(/\\/g, "/").toLowerCase();
      const root = workspaceRoot.replace(/\\/g, "/").toLowerCase();
      if (candidate.startsWith(root)) {
        return { uri: Uri.file(workspaceRoot), name: "linter-performance", index: 0 };
      }
      return undefined;
    },
    async findFiles(pattern: RelativePattern | string): Promise<Uri[]> {
      if (typeof pattern === "string") {
        const normalized = pattern.replace(/\\/g, "/").toLowerCase();
        const marker = normalized.includes("/xml_templates/")
          ? "xml_templates"
          : normalized.includes("/xml_components/")
            ? "xml_components"
            : normalized.includes("/xml_primitives/")
              ? "xml_primitives"
              : normalized.includes("/xml/")
                ? "xml"
                : undefined;
        if (!marker) {
          return [];
        }
        const markerToFolder: Record<string, string> = {
          xml_templates: "XML_Templates",
          xml_components: "XML_Components",
          xml_primitives: "XML_Primitives",
          xml: "XML"
        };
        const root = path.join(workspaceRoot, markerToFolder[marker]);
        return fs.existsSync(root) ? collectXmlFileUris(root) : [];
      }

      const baseUri = pattern.base instanceof Uri ? pattern.base : pattern.base.uri;
      const normalizedPattern = pattern.pattern.replace(/\\/g, "/");
      const rootPrefix = normalizedPattern.split("/**")[0];
      const searchRoot = path.join(baseUri.fsPath, rootPrefix);
      if (!fs.existsSync(searchRoot)) {
        return [];
      }
      return collectXmlFileUris(searchRoot);
    },
    fs: {
      async readFile(uri: Uri): Promise<Uint8Array> {
        return fs.readFileSync(uri.fsPath);
      }
    }
  }
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const moduleClassAny = (Module as unknown as { Module?: { _load?: (request: string, parent: unknown, isMain: boolean) => unknown } }).Module;
if (moduleClassAny?._load) {
  const originalClassLoad = moduleClassAny._load;
  moduleClassAny._load = function patchedClassLoad(request: string, parent: unknown, isMain: boolean): unknown {
    if (request === "vscode") {
      return vscodeMock;
    }
    return originalClassLoad.call(this, request, parent, isMain);
  };
}
const loadedVscode = require("vscode") as {
  Location?: unknown;
  Uri?: unknown;
  DiagnosticSeverity?: { Warning?: unknown };
  DiagnosticRelatedInformation?: unknown;
};
assert.equal(typeof loadedVscode.Location, "function", "vscode mock Location must be constructor");
assert.equal(typeof loadedVscode.Uri, "function", "vscode mock Uri must be constructor");
assert.equal(typeof loadedVscode.DiagnosticSeverity?.Warning, "number", "vscode mock DiagnosticSeverity.Warning must exist");
assert.equal(typeof loadedVscode.DiagnosticRelatedInformation, "function", "vscode mock DiagnosticRelatedInformation must exist");

const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as typeof import("../../indexer/workspaceIndexer");
const { DiagnosticsEngine } = require("../../diagnostics/engine") as typeof import("../../diagnostics/engine");
const { parseDocumentFacts } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
const { DocumentValidationService } = require("../../core/validation/documentValidationService") as typeof import("../../core/validation/documentValidationService");
const { ValidationQueueOrchestrator } = require("../../core/validation/validationQueueOrchestrator") as typeof import("../../core/validation/validationQueueOrchestrator");
const { DependencyValidationService } = require("../../core/validation/dependencyValidationService") as typeof import("../../core/validation/dependencyValidationService");
const { UpdateOrchestrator } = require("../../orchestrator/updateOrchestrator") as typeof import("../../orchestrator/updateOrchestrator");
const { BuildXmlTemplatesService } = require("../../template/buildXmlTemplatesService") as typeof import("../../template/buildXmlTemplatesService");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly version: number;
  private readonly text: string;
  private readonly lineStarts: number[];
  public readonly lineCount: number;
  constructor(filePath: string, text: string, version = 1) {
    this.uri = Uri.file(filePath);
    this.text = text;
    this.version = version;
    this.lineStarts = computeLineStarts(text);
    this.lineCount = this.lineStarts.length;
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

  public lineAt(line: number): { text: string } {
    const safeLine = Math.max(0, Math.min(line, this.lineCount - 1));
    const start = this.lineStarts[safeLine] ?? 0;
    const endWithBreak = safeLine + 1 < this.lineStarts.length ? this.lineStarts[safeLine + 1] : this.text.length;
    let end = endWithBreak;
    if (end > start && this.text.charCodeAt(end - 1) === 10) {
      end--;
    }
    if (end > start && this.text.charCodeAt(end - 1) === 13) {
      end--;
    }
    return { text: this.text.slice(start, end) };
  }
}

async function run(): Promise<void> {
  const templateIndexer = new WorkspaceIndexer(["XML_Templates", "XML_Components", "XML_Primitives"]);
  const runtimeIndexer = new WorkspaceIndexer(["XML"]);
  await templateIndexer.rebuildIndex();
  await runtimeIndexer.rebuildIndex();

  const scenarioCandidates = [
    {
      formPath: path.join(workspaceRoot, "XML_Templates/550_ITSMEventRecord/ITSMEventRecord.xml"),
      workflowPath: path.join(workspaceRoot, "XML_Templates/550_ITSMEventRecord/ITSMEventRecordWorkFlow.xml"),
      formIdent: "ITSMEventRecord"
    },
    {
      formPath: path.join(workspaceRoot, "XML_Templates/800_ITSMInovation/ITSMInovation.xml"),
      workflowPath: path.join(workspaceRoot, "XML_Templates/800_ITSMInovation/ITSMInovationWorkFlow.xml"),
      formIdent: "ITSMInovation"
    },
    {
      formPath: path.join(workspaceRoot, "XML_Templates/200_ITSMSupplierRequest/ITSMSupplierRequest.xml"),
      workflowPath: path.join(workspaceRoot, "XML_Templates/200_ITSMSupplierRequest/ITSMSupplierRequestWorkFlow.xml"),
      formIdent: "ITSMSupplierRequest"
    }
  ];
  const scenarios = scenarioCandidates.filter(
    (item) => fs.existsSync(item.formPath) && fs.existsSync(item.workflowPath)
  );
  assert.ok(scenarios.length > 0, `No save-pipeline scenarios found in workspace: ${workspaceRoot}`);

  const diagnosticsByUri = new Map<string, readonly import("vscode").Diagnostic[]>();
  const signatures = new Map<string, string>();
  const logLines: string[] = [];
  let lastPublishAt = 0;

  const getIndexForUri = (uri: import("vscode").Uri) => {
    const rel = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/").toLowerCase();
    return rel.startsWith("xml/") ? runtimeIndexer.getIndex() : templateIndexer.getIndex();
  };

  const documentValidationService = new DocumentValidationService({
    emptyIndex: {
      formsByIdent: new Map(),
      formIdentByUri: new Map(),
      componentsByKey: new Map(),
      componentKeyByUri: new Map(),
      componentKeysByBaseName: new Map(),
      parsedFactsByUri: new Map(),
      hasIgnoreDirectiveByUri: new Map(),
      formsReady: false,
      componentsReady: false,
      fullReady: false
    },
    clearDiagnostics: (uri) => {
      diagnosticsByUri.delete(uri.toString());
      lastPublishAt = Date.now();
    },
    setDiagnostics: (uri, diagnostics) => {
      diagnosticsByUri.set(uri.toString(), diagnostics);
      lastPublishAt = Date.now();
    },
    getIndexForUri,
    buildDiagnosticsForDocument: (document, currentIndex, facts) => {
      const engine = new DiagnosticsEngine();
      return engine.buildDiagnostics(document, currentIndex, { parsedFacts: facts });
    },
    shouldValidateUriForActiveProjects: () => true,
    documentInConfiguredRoots: (document) => {
      const rel = path.relative(workspaceRoot, document.uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return rel.startsWith("xml/") || rel.startsWith("xml_templates/") || rel.startsWith("xml_components/") || rel.startsWith("xml_primitives/");
    },
    isUserOpenDocument: (uri) => workspaceTextDocuments.some((d) => d.uri.toString() === uri.toString()),
    hasInitialIndex: () => true,
    openTextDocumentWithInternalFlag: async (uri) => {
      const text = fs.readFileSync(uri.fsPath, "utf8");
      return new MockTextDocument(uri.fsPath, text, 1) as unknown as import("vscode").TextDocument;
    },
    readWorkspaceFileText: async (uri) => fs.readFileSync(uri.fsPath, "utf8"),
    createVirtualXmlDocument: (uri, text) => new MockTextDocument(uri.fsPath, text, 1) as unknown as import("vscode").TextDocument,
    getRelativePath: (uri) => path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/"),
    logIndex: (message) => logLines.push(message),
    logSingleFile: (message) => logLines.push(message),
    referenceRuleFilter: () => true
  });

  const queue = new ValidationQueueOrchestrator({
    log: (message) => logLines.push(message),
    publishDiagnosticsBatch: (updates) => {
      for (const [uri, diagnostics] of updates) {
        diagnosticsByUri.set(uri.toString(), diagnostics ?? []);
      }
      lastPublishAt = Date.now();
    },
    computeIndexedValidationOutcome: (uri, options) => documentValidationService.computeIndexedValidationOutcome(uri, options),
    shouldValidateUriForActiveProjects: () => true,
    getBackgroundSettingsSnapshot: () => ({} as never),
    getBackgroundMetadataSnapshot: () => ({} as never),
    getIndexedValidationLogSignature: (uriKey) => signatures.get(uriKey),
    setIndexedValidationLogSignature: (uriKey, signature) => {
      signatures.set(uriKey, signature);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  });

  const dependencyValidationService = new DependencyValidationService({
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRuntimeIndex: () => runtimeIndexer.getIndex(),
    isReindexRelevantUri: () => true,
    shouldValidateUriForActiveProjects: () => true,
    enqueueValidationHigh: (uri, options) => queue.enqueueValidation(uri, "high", options),
    enqueueValidationLow: (uri, options) => queue.enqueueValidation(uri, "low", options),
    logIndex: (message) => logLines.push(message)
  });

  const buildService = new BuildXmlTemplatesService();
  const workspaceFolder = vscodeMock.workspace.workspaceFolders[0] as unknown as import("vscode").WorkspaceFolder;

  const updateOrchestrator = new UpdateOrchestrator({
    log: (message) => logLines.push(message),
    isReindexRelevantUri: () => true,
    refreshIncremental: (document) => {
      const refreshed = templateIndexer.refreshXmlDocument(document as unknown as import("vscode").TextDocument);
      if (refreshed.rootKind === "form" || refreshed.rootKind === "workflow" || refreshed.rootKind === "dataview") {
        dependencyValidationService.markDependentUrisDirty();
      }
      return refreshed;
    },
    collectAffectedFormIdentsForComponent: (componentKey) =>
      dependencyValidationService.collectAffectedFormIdentsForComponent(componentKey),
    enqueueDependentValidationForFormIdents: (formIdents, sourceLabel) =>
      dependencyValidationService.enqueueDependentValidationForFormIdents(formIdents, sourceLabel),
    triggerAutoBuild: async (document) => {
      await buildService.runForPath(workspaceFolder, document.uri.fsPath, { silent: true, mode: "fast" });
      await runtimeIndexer.rebuildIndex();
    },
    queueFullReindex: () => {
      // no-op in this test
    }
  });

  for (const scenario of scenarios) {
    const formUri = Uri.file(scenario.formPath) as unknown as import("vscode").Uri;
    const workflowText = fs.readFileSync(scenario.workflowPath, "utf8");
    const workflowDoc = new MockTextDocument(scenario.workflowPath, workflowText, 2);

    await runFullRevalidateForForm(
      scenario.formIdent,
      templateIndexer.getIndex(),
      runtimeIndexer.getIndex(),
      documentValidationService
    );
    const baseline = diagnosticsByUri.get(formUri.toString()) ?? [];
    const baselineMissingFeatureExpectedXPath = baseline
      .filter((d) => String(d.code ?? "") === "missing-feature-expected-xpath")
      .map((d) => d.message)
      .sort((a, b) => a.localeCompare(b));

    lastPublishAt = 0;
    await updateOrchestrator.handleDocumentSave(workflowDoc as unknown as import("vscode").TextDocument, true);
    await updateOrchestrator.waitForSaveIdle();
    await waitForQueueSettle(() => lastPublishAt, 10000);

    const afterSave = diagnosticsByUri.get(formUri.toString()) ?? [];
    const afterSaveMissingFeatureExpectedXPath = afterSave
      .filter((d) => String(d.code ?? "") === "missing-feature-expected-xpath")
      .map((d) => d.message)
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      afterSaveMissingFeatureExpectedXPath,
      baselineMissingFeatureExpectedXPath,
      `Save pipeline introduced inconsistent missing-feature-expected-xpath diagnostics on Form '${scenario.formIdent}' compared to full revalidate baseline.`
    );
  }

  queue.dispose();
  console.log(
    `\x1b[32mSave pipeline expected-xpath regression tests passed.\x1b[0m (workspace=${workspaceRoot}, scenarios=${scenarios
      .map((item) => item.formIdent)
      .join(",")})`
  );
}

async function runFullRevalidateForForm(
  formIdent: string,
  templateIndex: import("../../indexer/types").WorkspaceIndex,
  runtimeIndex: import("../../indexer/types").WorkspaceIndex,
  documentValidationService: import("../../core/validation/documentValidationService").DocumentValidationService
): Promise<void> {
  const uris = new Map<string, import("vscode").Uri>();
  const collectFrom = (index: import("../../indexer/types").WorkspaceIndex): void => {
    for (const [uriKey, facts] of index.parsedFactsByUri.entries()) {
      const root = (facts.rootTag ?? "").toLowerCase();
      const owningFormIdent =
        root === "form"
          ? facts.formIdent
          : root === "workflow"
            ? (facts.workflowFormIdent ?? facts.rootFormIdent)
            : root === "dataview"
              ? facts.rootFormIdent
              : undefined;
      if (!owningFormIdent || owningFormIdent !== formIdent) {
        continue;
      }
      const uri = Uri.parse(uriKey) as unknown as import("vscode").Uri;
      uris.set(uri.toString(), uri);
    }
  };
  collectFrom(templateIndex);
  collectFrom(runtimeIndex);
  const sorted = [...uris.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  for (const uri of sorted) {
    await documentValidationService.validateUri(uri, { preferFsRead: true, respectProjectScope: true });
  }
}

function collectXmlFileUris(root: string): Uri[] {
  return collectXmlFiles(root).map((file) => Uri.file(file));
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function collectXmlFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && full.toLowerCase().endsWith(".xml")) {
        out.push(full);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function waitForQueueSettle(getLastPublishAt: () => number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const last = getLastPublishAt();
    if (last > 0 && Date.now() - last > 250) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

void run();
