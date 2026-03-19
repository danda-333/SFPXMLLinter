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
const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as typeof import("../../indexer/workspaceIndexer");
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
  const indexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);

  const featurePath = path.join(workspaceRoot, "XML_Components/Shared/FeatureToggle.feature.xml");
  const formPath = path.join(workspaceRoot, "XML_Templates/100_Test/FeatureToggleForm.xml");
  const workflowPath = path.join(workspaceRoot, "XML_Templates/100_Test/FeatureToggleFormWorkFlow.xml");

  const featureEnabled = [
    "<Feature>",
    "  <Contributions>",
    "    <Contribution Name=\"Controls\" Root=\"form\">",
    "      <Control xsi:type=\"TextBoxControl\" Ident=\"FeatureControl\" DataType=\"String\" />",
    "    </Contribution>",
    "  </Contributions>",
    "</Feature>"
  ].join("\n");

  const featureDisabled = [
    "<Feature>",
    "  <Contributions>",
    "    <Contribution Name=\"Controls\" Root=\"form\">",
    "      <!-- <Control xsi:type=\"TextBoxControl\" Ident=\"FeatureControl\" DataType=\"String\" /> -->",
    "    </Contribution>",
    "  </Contributions>",
    "</Feature>"
  ].join("\n");

  const formText = [
    "<Form Ident=\"FeatureToggleForm\">",
    "  <Usings>",
    "    <Using Feature=\"Shared/FeatureToggle\" />",
    "  </Usings>",
    "  <Controls>",
    "    <Control xsi:type=\"HTMLTemplateControl\" Ident=\"TemplateBlock\" DataType=\"String\">",
    "      <Template>",
    "        <Control ID=\"FeatureControl\" />",
    "      </Template>",
    "    </Control>",
    "  </Controls>",
    "</Form>"
  ].join("\n");

  const workflowText = [
    "<WorkFlow FormIdent=\"FeatureToggleForm\">",
    "  <ControlShareCodes>",
    "    <ControlShareCode Ident=\"SharedControlScope\">",
    "      <Controls>",
    "        <FormControl Ident=\"FeatureControl\" IsVisible=\"true\" />",
    "      </Controls>",
    "    </ControlShareCode>",
    "  </ControlShareCodes>",
    "</WorkFlow>"
  ].join("\n");

  const featureEnabledDoc = new MockTextDocument(featurePath, featureEnabled);
  const featureDisabledDoc = new MockTextDocument(featurePath, featureDisabled);
  const formDoc = new MockTextDocument(formPath, formText);
  const workflowDoc = new MockTextDocument(workflowPath, workflowText);
  const formFacts = parseDocumentFactsFromText(formText);
  const workflowFacts = parseDocumentFactsFromText(workflowText);

  indexer.refreshComponentDocument(featureEnabledDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formDoc as unknown as import("vscode").TextDocument);
  const pass1 = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: formFacts,
    standaloneMode: true
  });
  assertNoRule(pass1, "unknown-html-template-control-ident");
  const workflowPass1 = engine.buildDiagnostics(workflowDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: workflowFacts,
    standaloneMode: true
  });
  assertNoRule(workflowPass1, "unknown-form-control-ident");

  indexer.refreshComponentDocument(featureDisabledDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formDoc as unknown as import("vscode").TextDocument);
  const pass2 = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: formFacts,
    standaloneMode: true
  });
  assertHasRule(pass2, "unknown-html-template-control-ident");
  const workflowPass2 = engine.buildDiagnostics(workflowDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: workflowFacts,
    standaloneMode: true
  });
  assertHasRule(workflowPass2, "unknown-form-control-ident");

  indexer.refreshComponentDocument(featureEnabledDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formDoc as unknown as import("vscode").TextDocument);
  const pass3 = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: formFacts,
    standaloneMode: true
  });
  assertNoRule(pass3, "unknown-html-template-control-ident");
  const workflowPass3 = engine.buildDiagnostics(workflowDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: workflowFacts,
    standaloneMode: true
  });
  assertNoRule(workflowPass3, "unknown-form-control-ident");
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

run();
console.log("\x1b[32mFeature control toggle tests passed.\x1b[0m");
