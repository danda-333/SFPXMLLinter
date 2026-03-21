import fs from "node:fs";
import path from "node:path";
import Module = require("node:module");

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter-performance");

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
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "linter-performance-fixture", index: 0 }],
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

  const componentPath = path.join(workspaceRoot, "XML_Components/Common/Buttons/SaveGroupButton.component.xml");
  const formPath = path.join(workspaceRoot, "XML_Templates/800_ITSMInovation/ITSMInovation.xml");
  const workflowPath = path.join(workspaceRoot, "XML_Templates/800_ITSMInovation/ITSMInovationWorkFlow.xml");

  const componentDoc = new MockTextDocument(componentPath, fs.readFileSync(componentPath, "utf8"));
  const formDoc = new MockTextDocument(formPath, fs.readFileSync(formPath, "utf8"));
  const workflowDoc = new MockTextDocument(workflowPath, fs.readFileSync(workflowPath, "utf8"));

  indexer.refreshComponentDocument(componentDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(formDoc as unknown as import("vscode").TextDocument);
  indexer.refreshFormDocument(workflowDoc as unknown as import("vscode").TextDocument);

  const formFacts = parseDocumentFactsFromText(formDoc.getText());
  const diagnostics = engine.buildDiagnostics(formDoc as unknown as import("vscode").TextDocument, indexer.getIndex(), {
    parsedFacts: formFacts,
    standaloneMode: true
  });

  const violating = diagnostics.filter((item) => {
    const code = String(item.code ?? "");
    const message = String(item.message ?? "");
    return (
      code === "missing-feature-expected-xpath" &&
      message.includes("Common/Buttons/SaveGroupButton") &&
      message.includes("ButtonShareCodes")
    );
  });

  if (violating.length > 0) {
    throw new Error(
      `Expected no SaveGroupButton missing-feature-expected-xpath diagnostics, got ${violating.length}: ${violating
        .map((item) => item.message)
        .join(" | ")}`
    );
  }

  console.log("\x1b[32mITSMInovation expected XPath regression tests passed.\x1b[0m");
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

