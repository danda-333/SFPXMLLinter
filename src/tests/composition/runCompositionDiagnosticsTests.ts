import * as fs from "node:fs";
import * as path from "node:path";
import Module = require("node:module");

type VscodeMockState = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/composition");
const state: VscodeMockState = {
  workspaceRoot,
  config: {
    workspaceRoots: ["Common"],
    resourcesRoots: [],
    hoverDocsFiles: [],
    rules: {}
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

const vscodeMock = {
  Uri,
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "composition-fixture", index: 0 }],
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
    },
    getWorkspaceFolder(uri: Uri) {
      const root = path.resolve(state.workspaceRoot).replace(/\\/g, "/").toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(state.workspaceRoot), name: "composition-fixture", index: 0 } : undefined;
    },
    asRelativePath(uri: Uri, _includeWorkspaceFolder: boolean): string {
      return path.relative(state.workspaceRoot, uri.fsPath).replace(/\\/g, "/");
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

const { DiagnosticsEngine } = require("../../diagnostics/engine") as typeof import("../../diagnostics/engine");
const { loadFeatureManifestRegistry } = require("../../composition/workspace") as typeof import("../../composition/workspace");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly version = 1;
  public readonly lineCount: number;
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(filePath: string, text: string) {
    this.uri = Uri.file(filePath);
    this.text = text;
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

    return {
      text: this.text.slice(start, end)
    };
  }
}

function run(): void {
  const engine = new DiagnosticsEngine();
  const registry = loadFeatureManifestRegistry(workspaceRoot);
  const emptyIndex = createEmptyIndex();

  const entrypointPath = path.join(workspaceRoot, "Common", "Features", "Assign", "Assign.feature.xml");
  const entrypointText = fs.readFileSync(entrypointPath, "utf8").replace(
    "<Manifest Description=\"Entrypoint composition file for Assign feature.\" Tags=\"itsm, assign\">",
    "<Manifest Description=\"Entrypoint composition file for Assign feature.\" Tags=\"itsm, assign\"><Requires><Ref Kind=\"feature\" Ident=\"MissingFeature\" /></Requires>"
  );
  const entrypointDoc = new MockTextDocument(entrypointPath, entrypointText);
  const entrypointDiagnostics = engine.buildDiagnostics(entrypointDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(entrypointDiagnostics, "unknown-feature-requirement");

  const formPath = path.join(workspaceRoot, "Common", "Features", "Assign", "Assign.Form.feature.xml");
  const formText = fs.readFileSync(formPath, "utf8").replace(
    "<ExpectsXPath>",
    "<Expects><Symbol Kind=\"control\" Ident=\"MissingControl\" /></Expects><ExpectsXPath>"
  );
  const formDoc = new MockTextDocument(formPath, formText);
  const formDiagnostics = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formDiagnostics, "missing-feature-expectation");

  const formXPathText = fs.readFileSync(formPath, "utf8").replace(
    "<ExpectsXPath>",
    "<ExpectsXPath><XPath>//Form/Controls/Control[@Ident='MissingXPathControl']</XPath>"
  );
  const formXPathDoc = new MockTextDocument(formPath, formXPathText);
  const formXPathDiagnostics = engine.buildDiagnostics(formXPathDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formXPathDiagnostics, "missing-feature-expected-xpath");

  const formUsageDiagnostics = engine.buildDiagnostics(new MockTextDocument(formPath, fs.readFileSync(formPath, "utf8")) as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formUsageDiagnostics, "partial-feature-contribution");

  console.log("Composition diagnostics tests passed.");
}

function assertHasRule(diagnostics: readonly import("vscode").Diagnostic[], ruleId: string): void {
  if (diagnostics.some((d) => String(d.code) === ruleId)) {
    return;
  }

  const compact = diagnostics.map((d) => `[${String(d.code)}] ${d.message}`).join("\n");
  throw new Error(`Expected diagnostic '${ruleId}', got:\n${compact}`);
}

function createEmptyIndex(): import("../../indexer/types").WorkspaceIndex {
  return {
    formsByIdent: new Map(),
    componentsByKey: new Map(),
    componentKeysByBaseName: new Map(),
    formIdentReferenceLocations: new Map(),
    mappingFormIdentReferenceLocations: new Map(),
    controlReferenceLocationsByFormIdent: new Map(),
    buttonReferenceLocationsByFormIdent: new Map(),
    sectionReferenceLocationsByFormIdent: new Map(),
    componentReferenceLocationsByKey: new Map(),
    componentContributionReferenceLocationsByKey: new Map(),
    componentUsageFormIdentsByKey: new Map(),
    componentContributionUsageFormIdentsByKey: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
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

run();
