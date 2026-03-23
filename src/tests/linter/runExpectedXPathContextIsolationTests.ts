import path from "node:path";
import Module = require("node:module");

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");

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
    getConfiguration() {
      return {
        get<T>(_key: string, defaultValue: T): T {
          return defaultValue;
        }
      };
    },
    asRelativePath(uri: Uri): string {
      return path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/");
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
const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as typeof import("../../indexer/workspaceIndexer");
const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly version = 1;
  private readonly text: string;
  private readonly lineStarts: number[];
  public readonly lineCount: number;

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
    return { text: this.text.slice(start, end) };
  }
}

function run(): void {
  const engine = new DiagnosticsEngine();
  const indexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);

  const componentPath = path.join(workspaceRoot, "XML_Components/Shared/ExpectedXPathScope.feature.xml");
  const formPath = path.join(workspaceRoot, "XML_Templates/100_Test/ScopeForm.xml");
  const workflowSameDirPath = path.join(workspaceRoot, "XML_Templates/100_Test/ScopeFormWorkFlow.xml");
  const workflowOtherDirPath = path.join(workspaceRoot, "XML_Templates/900_Other/ScopeFormWorkFlow.xml");
  const componentButtonPath = path.join(workspaceRoot, "XML_Components/Shared/ExpectedXPathButtonShare.feature.xml");
  const formButtonPath = path.join(workspaceRoot, "XML_Templates/100_Test/ScopeButtonForm.xml");
  const workflowButtonPath = path.join(workspaceRoot, "XML_Templates/100_Test/ScopeButtonFormWorkFlow.xml");

  const featureText = [
    "<Feature>",
    "  <Contributions>",
    "    <Contribution Name=\"ControlShareCodes\" Root=\"workflow\" Insert=\"append\" TargetXPath=\"//WorkFlow/ControlShareCodes\">",
    "      <ControlShareCode Ident=\"InjectedControlShare\">",
    "        <Controls />",
    "      </ControlShareCode>",
    "    </Contribution>",
    "  </Contributions>",
    "</Feature>"
  ].join("\n");

  const formText = [
    "<Form Ident=\"ScopeForm\">",
    "  <Usings>",
    "    <Using Feature=\"Shared/ExpectedXPathScope\" />",
    "  </Usings>",
    "  <Controls />",
    "</Form>"
  ].join("\n");

  const workflowSameDirText = [
    "<WorkFlow FormIdent=\"ScopeForm\">",
    "  <ControlShareCodes />",
    "</WorkFlow>"
  ].join("\n");

  const workflowOtherDirText = [
    "<WorkFlow FormIdent=\"ScopeForm\">",
    "  <Steps />",
    "</WorkFlow>"
  ].join("\n");
  const featureButtonText = [
    "<Feature>",
    "  <Contributions>",
    "    <Contribution Name=\"ButtonShareCodes\" Root=\"workflow\" Insert=\"append\" TargetXPath=\"//WorkFlow/ButtonShareCodes\">",
    "      <ButtonShareCode Ident=\"InjectedButtonShare\">",
    "        <Buttons />",
    "      </ButtonShareCode>",
    "    </Contribution>",
    "  </Contributions>",
    "</Feature>"
  ].join("\n");
  const formButtonText = [
    "<Form Ident=\"ScopeButtonForm\">",
    "  <Usings>",
    "    <Using Feature=\"Shared/ExpectedXPathButtonShare\" />",
    "  </Usings>",
    "  <Buttons />",
    "</Form>"
  ].join("\n");
  const workflowButtonText = [
    "<WorkFlow FormIdent=\"ScopeButtonForm\">",
    "  <ButtonShareCodes />",
    "</WorkFlow>"
  ].join("\n");

  const featureDoc = new MockTextDocument(componentPath, featureText);
  const formDoc = new MockTextDocument(formPath, formText);
  const workflowSameDirDoc = new MockTextDocument(workflowSameDirPath, workflowSameDirText);
  const workflowOtherDirDoc = new MockTextDocument(workflowOtherDirPath, workflowOtherDirText);
  const featureButtonDoc = new MockTextDocument(componentButtonPath, featureButtonText);
  const formButtonDoc = new MockTextDocument(formButtonPath, formButtonText);
  const workflowButtonDoc = new MockTextDocument(workflowButtonPath, workflowButtonText);

  indexer.refreshComponentDocument(featureDoc as unknown as import("vscode").TextDocument);
  indexer.refreshComponentDocument(featureButtonDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(workflowSameDirDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(workflowOtherDirDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formButtonDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(workflowButtonDoc as unknown as import("vscode").TextDocument);

  const standaloneFormFacts = parseDocumentFactsFromText(formText);
  const diagnostics = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: standaloneFormFacts,
    standaloneMode: true
  });
  const buttonFacts = parseDocumentFactsFromText(formButtonText);
  const buttonDiagnostics = engine.buildDiagnostics(formButtonDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: buttonFacts,
    standaloneMode: true
  });

  assertNoRule(diagnostics, "missing-feature-expected-xpath");
  assertNoRule(buttonDiagnostics, "missing-feature-expected-xpath");
  console.log("\x1b[32mExpected XPath context isolation tests passed.\x1b[0m");
}

function assertNoRule(diagnostics: readonly import("vscode").Diagnostic[], ruleId: string): void {
  const hit = diagnostics.find((d) => String(d.code ?? "") === ruleId);
  if (!hit) {
    return;
  }
  throw new Error(`Expected no '${ruleId}' diagnostic, got: ${hit.message}`);
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
