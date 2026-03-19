import path from "node:path";
import Module = require("node:module");

type VscodeMockState = {
  workspaceRoot: string;
};

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");
const state: VscodeMockState = {
  workspaceRoot
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

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "linter-fixture", index: 0 }],
    getConfiguration(section: string) {
      if (section !== "sfpXmlLinter") {
        return {
          get<T>(_key: string, defaultValue: T): T {
            return defaultValue;
          }
        };
      }

      return {
        get<T>(_key: string, defaultValue: T): T {
          return defaultValue;
        }
      };
    },
    getWorkspaceFolder(uri: Uri) {
      const root = path.resolve(state.workspaceRoot).replace(/\\/g, "/").toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(state.workspaceRoot), name: "linter-fixture", index: 0 } : undefined;
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
const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

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
  const index = createEmptyIndex();

  const formUri = Uri.file(path.join(workspaceRoot, "XML_Templates/100_Test/ComposedRefForm.xml"));
  const formRange = new Range(new Position(0, 0), new Position(0, 1));
  index.formsByIdent.set("ComposedRefForm", {
    ident: "ComposedRefForm",
    uri: formUri,
    controls: new Set(["ExistingControl"]),
    buttons: new Set(["LocalButton"]),
    sections: new Set<string>(),
    formIdentLocation: new Location(formUri, formRange),
    controlDefinitions: new Map([["ExistingControl", new Location(formUri, formRange)]]),
    buttonDefinitions: new Map([["LocalButton", new Location(formUri, formRange)]]),
    sectionDefinitions: new Map()
  } as unknown as import("../../indexer/types").IndexedForm);

  const templateWorkflowText = [
    "<WorkFlow FormIdent=\"ComposedRefForm\">",
    "  <Button Ident=\"LocalButton\" />",
    "</WorkFlow>"
  ].join("\n");
  const runtimeWorkflowText = [
    "<WorkFlow FormIdent=\"ComposedRefForm\">",
    "  <Button Ident=\"InjectedMissingButton\" />",
    "</WorkFlow>"
  ].join("\n");

  const templateDoc = new MockTextDocument(path.join(workspaceRoot, "XML_Templates/100_Test/ComposedRefFormWorkFlow.xml"), templateWorkflowText);
  const templateFacts = parseDocumentFactsFromText(templateWorkflowText);
  const runtimeFacts = parseDocumentFactsFromText(runtimeWorkflowText);

  const localDiagnostics = engine.buildDiagnostics(templateDoc as unknown as import("vscode").TextDocument, index, {
    parsedFacts: templateFacts,
    standaloneMode: true,
    workflowReferenceMode: "local"
  });
  assertNoRule(localDiagnostics, "unknown-form-button-ident");

  const injectedDiagnostics = engine.buildDiagnostics(templateDoc as unknown as import("vscode").TextDocument, index, {
    parsedFacts: templateFacts,
    standaloneMode: true,
    injectedWorkflowReferences: runtimeFacts.workflowReferences,
    workflowReferenceMode: "injected"
  });
  assertHasRule(injectedDiagnostics, "unknown-form-button-ident");
}

function assertHasRule(diagnostics: readonly import("vscode").Diagnostic[], code: string): void {
  if (!diagnostics.some((item) => item.code === code)) {
    const allCodes = diagnostics.map((item) => String(item.code ?? "unknown")).join(", ");
    throw new Error(`Expected diagnostic '${code}', got [${allCodes}]`);
  }
}

function assertNoRule(diagnostics: readonly import("vscode").Diagnostic[], code: string): void {
  if (diagnostics.some((item) => item.code === code)) {
    throw new Error(`Did not expect diagnostic '${code}'.`);
  }
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function createEmptyIndex(): import("../../indexer/types").WorkspaceIndex {
  return {
    formsByIdent: new Map(),
    formIdentByUri: new Map(),
    componentsByKey: new Map(),
    componentKeyByUri: new Map(),
    componentKeysByBaseName: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

run();
console.log("\x1b[32mComposed workflow reference tests passed.\x1b[0m");
