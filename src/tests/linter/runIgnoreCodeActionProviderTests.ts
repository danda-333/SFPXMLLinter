import { strict as assert } from "node:assert";
import * as path from "node:path";
import Module = require("node:module");

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    return Uri.file(path.join(base.fsPath, ...segments));
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

  public isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }

  public intersection(other: Range): Range | undefined {
    const thisStart = positionToOffset(this.start);
    const thisEnd = positionToOffset(this.end);
    const otherStart = positionToOffset(other.start);
    const otherEnd = positionToOffset(other.end);
    const startOffset = Math.max(thisStart, otherStart);
    const endOffset = Math.min(thisEnd, otherEnd);
    if (endOffset <= startOffset) {
      return undefined;
    }

    return new Range(offsetToPosition(startOffset), offsetToPosition(endOffset));
  }
}

class Diagnostic {
  public readonly range: Range;
  public readonly message: string;
  public source?: string;
  public code?: string | number;

  constructor(range: Range, message: string) {
    this.range = range;
    this.message = message;
  }
}

class CodeAction {
  public readonly title: string;
  public readonly kind: { value: string };
  public diagnostics?: Diagnostic[];
  public isPreferred?: boolean;
  public edit?: WorkspaceEdit;
  public command?: { command: string; title: string; arguments?: unknown[] };

  constructor(title: string, kind: { value: string }) {
    this.title = title;
    this.kind = kind;
  }
}

class WorkspaceEdit {
  public readonly operations: Array<
    | { type: "insert"; uri: Uri; position: Position; text: string }
    | { type: "replace"; uri: Uri; range: Range; text: string }
    | { type: "createFile"; uri: Uri; options?: { ignoreIfExists?: boolean; overwrite?: boolean } }
  > = [];

  public insert(uri: Uri, position: Position, text: string): void {
    this.operations.push({ type: "insert", uri, position, text });
  }

  public replace(uri: Uri, range: Range, text: string): void {
    this.operations.push({ type: "replace", uri, range, text });
  }

  public createFile(uri: Uri, options?: { ignoreIfExists?: boolean; overwrite?: boolean }): void {
    this.operations.push({ type: "createFile", uri, options });
  }
}

const CodeActionKind = {
  QuickFix: { value: "quickfix" }
};

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly lineCount: number;
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(uri: Uri, text: string) {
    this.uri = uri;
    this.text = text;
    this.lineStarts = computeLineStarts(text);
    this.lineCount = this.lineStarts.length;
  }

  public getText(range?: Range): string {
    if (!range) {
      return this.text;
    }
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this.text.slice(start, end);
  }

  public lineAt(line: number): { text: string } {
    const start = this.lineStarts[Math.max(0, Math.min(this.lineCount - 1, line))] ?? 0;
    const next = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
    const raw = this.text.slice(start, next);
    return { text: raw.replace(/\r?\n$/, "") };
  }

  public offsetAt(position: Position): number {
    const lineStart = this.lineStarts[Math.max(0, Math.min(this.lineCount - 1, position.line))] ?? 0;
    return Math.max(0, Math.min(this.text.length, lineStart + position.character));
  }
}

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");
let currentDocumentText = "";
let currentLineStarts: number[] = [0];

function positionToOffset(position: Position): number {
  const lineStart = currentLineStarts[Math.max(0, Math.min(currentLineStarts.length - 1, position.line))] ?? 0;
  return lineStart + position.character;
}

function offsetToPosition(offset: number): Position {
  const safe = Math.max(0, Math.min(currentDocumentText.length, offset));
  let low = 0;
  let high = currentLineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = currentLineStarts[mid];
    const next = mid + 1 < currentLineStarts.length ? currentLineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
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

const vscodeMock = {
  Uri,
  Position,
  Range,
  Diagnostic,
  CodeAction,
  WorkspaceEdit,
  CodeActionKind,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "linter-fixture", index: 0 }],
    getWorkspaceFolder(_uri: Uri) {
      return { uri: Uri.file(workspaceRoot), name: "linter-fixture", index: 0 };
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

const { SfpXmlIgnoreCodeActionProvider } = require("../../providers/ignoreCodeActionProvider") as typeof import("../../providers/ignoreCodeActionProvider");

function run(): void {
  const provider = new SfpXmlIgnoreCodeActionProvider();

  testUnknownPrimitiveCreateAction(provider);
  testPrimitiveMissingSlotAction(provider);
  testPrimitiveMissingParamAction(provider);
  testPrimitiveCycleAction(provider);

  console.log("Ignore code action provider tests passed.");
}

function testUnknownPrimitiveCreateAction(provider: InstanceType<typeof SfpXmlIgnoreCodeActionProvider>): void {
  const text = "<Form><Controls><UsePrimitive Name=\"Common/Missing/Primitive\" /></Controls></Form>";
  const doc = createDoc("tests/fixtures/linter/XML_Templates/100_Test/CodeActionUnknownPrimitive.xml", text);
  const range = findSnippetRange(text, "<UsePrimitive Name=\"Common/Missing/Primitive\" />");
  const diagnostic = new Diagnostic(range, "[unknown-primitive] Primitive 'Common/Missing/Primitive' was not found in XML_Primitives/XML_Components.");
  diagnostic.source = "sfp-xml-linter";
  diagnostic.code = "unknown-primitive";

  const actions = provider.provideCodeActions(
    doc as unknown as import("vscode").TextDocument,
    range as unknown as import("vscode").Range,
    toCodeActionContext([diagnostic])
  ) as CodeAction[];
  const createAction = actions.find((action) => action.title.startsWith("Create primitive 'Common/Missing/Primitive'"));
  assert.ok(createAction, "Expected create primitive quick-fix action.");
  const createOp = createAction?.edit?.operations.find((op) => op.type === "createFile");
  assert.ok(createOp && createOp.type === "createFile", "Create action should create primitive file.");
}

function testPrimitiveMissingSlotAction(provider: InstanceType<typeof SfpXmlIgnoreCodeActionProvider>): void {
  const text = "<Form><Controls><UsePrimitive Name=\"Common/Dialogs/DialogWithSlot\" /></Controls></Form>";
  const doc = createDoc("tests/fixtures/linter/XML_Templates/100_Test/CodeActionMissingSlot.xml", text);
  const range = findSnippetRange(text, "<UsePrimitive Name=\"Common/Dialogs/DialogWithSlot\" />");
  const diagnostic = new Diagnostic(range, "[primitive-missing-slot] UsePrimitive 'Common/Dialogs/DialogWithSlot' is missing required Slot 'Body'.");
  diagnostic.source = "sfp-xml-linter";
  diagnostic.code = "primitive-missing-slot";

  const actions = provider.provideCodeActions(
    doc as unknown as import("vscode").TextDocument,
    range as unknown as import("vscode").Range,
    toCodeActionContext([diagnostic])
  ) as CodeAction[];
  const slotAction = actions.find((action) => action.title === "Add missing Slot 'Body'");
  assert.ok(slotAction, "Expected add missing slot quick-fix action.");
  const replace = slotAction?.edit?.operations.find((op) => op.type === "replace");
  assert.ok(replace && replace.type === "replace" && replace.text.includes("<Slot Name=\"Body\"></Slot>"), "Slot quick-fix should insert missing Slot body.");
}

function testPrimitiveMissingParamAction(provider: InstanceType<typeof SfpXmlIgnoreCodeActionProvider>): void {
  const text = "<Form><Controls><UsePrimitive Name=\"Common/Dialogs/DialogWithParam\" /></Controls></Form>";
  const doc = createDoc("tests/fixtures/linter/XML_Templates/100_Test/CodeActionMissingParam.xml", text);
  const range = findSnippetRange(text, "<UsePrimitive Name=\"Common/Dialogs/DialogWithParam\" />");
  const diagnostic = new Diagnostic(range, "[primitive-missing-param] UsePrimitive 'Common/Dialogs/DialogWithParam' is missing required parameter 'DialogIdent'.");
  diagnostic.source = "sfp-xml-linter";
  diagnostic.code = "primitive-missing-param";

  const actions = provider.provideCodeActions(
    doc as unknown as import("vscode").TextDocument,
    range as unknown as import("vscode").Range,
    toCodeActionContext([diagnostic])
  ) as CodeAction[];
  const paramAction = actions.find((action) => action.title === "Add missing parameter 'DialogIdent'");
  assert.ok(paramAction, "Expected add missing parameter quick-fix action.");
  const replace = paramAction?.edit?.operations.find((op) => op.type === "replace");
  assert.ok(replace && replace.type === "replace" && replace.text.includes("DialogIdent=\"\""), "Param quick-fix should insert missing DialogIdent attribute.");
}

function testPrimitiveCycleAction(provider: InstanceType<typeof SfpXmlIgnoreCodeActionProvider>): void {
  const text = "<Form><Controls><UsePrimitive Name=\"Common/Cycle/CycleA\" /></Controls></Form>";
  const doc = createDoc("tests/fixtures/linter/XML_Templates/100_Test/CodeActionCycle.xml", text);
  const range = findSnippetRange(text, "<UsePrimitive Name=\"Common/Cycle/CycleA\" />");
  const diagnostic = new Diagnostic(range, "[primitive-cycle] Primitive cycle detected: Common/Cycle/CycleA -> Common/Cycle/CycleB -> Common/Cycle/CycleA");
  diagnostic.source = "sfp-xml-linter";
  diagnostic.code = "primitive-cycle";

  const actions = provider.provideCodeActions(
    doc as unknown as import("vscode").TextDocument,
    range as unknown as import("vscode").Range,
    toCodeActionContext([diagnostic])
  ) as CodeAction[];
  const cycleAction = actions.find((action) => action.title === "Remove cyclic UsePrimitive");
  assert.ok(cycleAction, "Expected remove cyclic UsePrimitive quick-fix action.");
  const replace = cycleAction?.edit?.operations.find((op) => op.type === "replace");
  assert.ok(replace && replace.type === "replace" && replace.text === "", "Cycle quick-fix should remove UsePrimitive node.");
}

function createDoc(relPath: string, text: string): MockTextDocument {
  currentDocumentText = text;
  currentLineStarts = computeLineStarts(text);
  return new MockTextDocument(Uri.file(path.resolve(relPath)), text);
}

function findSnippetRange(text: string, snippet: string): Range {
  const start = text.indexOf(snippet);
  if (start < 0) {
    throw new Error(`Snippet not found: ${snippet}`);
  }
  const end = start + snippet.length;
  return new Range(offsetToPosition(start), offsetToPosition(end));
}

function toCodeActionContext(diagnostics: Diagnostic[]): import("vscode").CodeActionContext {
  return {
    diagnostics: diagnostics as unknown as import("vscode").Diagnostic[],
    triggerKind: 1
  } as unknown as import("vscode").CodeActionContext;
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
