import { strict as assert } from "node:assert";
import * as path from "node:path";
import Module = require("node:module");
import type { WorkspaceIndex, IndexedComponent, IndexedForm } from "../../indexer/types";

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
  public static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      return new Uri(value.slice("file://".length));
    }
    return new Uri(value);
  }
}

class Position {
  public constructor(public readonly line: number, public readonly character: number) {}
  public translate(lineDelta = 0, charDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + charDelta);
  }
}

class Range {
  public constructor(public readonly start: Position, public readonly end: Position) {}
  public contains(position: Position): boolean {
    const beforeStart =
      position.line < this.start.line ||
      (position.line === this.start.line && position.character < this.start.character);
    const afterEnd =
      position.line > this.end.line ||
      (position.line === this.end.line && position.character > this.end.character);
    return !beforeStart && !afterEnd;
  }
}

class Location {
  public constructor(public readonly uri: Uri, public readonly range: Range) {}
}

class CompletionItem {
  public insertText?: string;
  public detail?: string;
  public sortText?: string;
  public filterText?: string;
  public range?: Range;
  public constructor(public readonly label: string, public readonly kind: number) {}
}

class CompletionList {
  public constructor(public readonly items: CompletionItem[], public readonly isIncomplete = false) {}
}

class SnippetString {
  public constructor(public readonly value: string) {}
}

class WorkspaceEdit {
  private readonly entries: Array<{ uri: Uri; range: Range; text: string }> = [];
  public replace(uri: Uri, range: Range, text: string): void {
    this.entries.push({ uri, range, text });
  }
  public size(): number {
    return this.entries.length;
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 15,
  File: 17,
  Reference: 18,
  EnumMember: 20
} as const;

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  private readonly lineStarts: number[];
  public constructor(filePath: string, private readonly text: string) {
    this.uri = Uri.file(filePath);
    this.lineStarts = computeLineStarts(text);
  }
  public getText(range?: Range): string {
    if (!range) {
      return this.text;
    }
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }
  public offsetAt(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.lineStarts.length - 1));
    const lineStart = this.lineStarts[line] ?? 0;
    return Math.max(0, Math.min(this.text.length, lineStart + Math.max(0, position.character)));
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
    const start = this.lineStarts[line] ?? 0;
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
    return { text: this.text.slice(start, end).replace(/\r?\n$/, "") };
  }
}

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");
const vscodeMock = {
  Uri,
  Position,
  Range,
  Location,
  CompletionItem,
  CompletionList,
  CompletionItemKind,
  SnippetString,
  WorkspaceEdit,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "fixture", index: 0 }],
    getConfiguration() {
      return {
        get<T>(_key: string, defaultValue: T): T {
          return defaultValue;
        }
      };
    },
    getWorkspaceFolder(uri: Uri) {
      const normalized = uri.fsPath.replace(/\\/g, "/").toLowerCase();
      const rootNormalized = workspaceRoot.replace(/\\/g, "/").toLowerCase();
      return normalized.startsWith(rootNormalized) ? { uri: Uri.file(workspaceRoot), name: "fixture", index: 0 } : undefined;
    },
    asRelativePath(uri: Uri): string {
      return path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/");
    }
  },
  window: {
    visibleTextEditors: [],
    activeTextEditor: undefined
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

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function createIndex(document: MockTextDocument): WorkspaceIndex {
  const formRange = new Range(new Position(0, 0), new Position(0, 4));
  const form: IndexedForm = {
    ident: "A",
    uri: document.uri as unknown as import("vscode").Uri,
    controls: new Set(["ControlA"]),
    buttons: new Set(["ButtonA"]),
    sections: new Set(["SectionA"]),
    formIdentLocation: new Location(document.uri, formRange) as unknown as import("vscode").Location,
    controlDefinitions: new Map(),
    buttonDefinitions: new Map(),
    sectionDefinitions: new Map()
  };
  const componentRange = new Range(new Position(0, 0), new Position(0, 4));
  const component: IndexedComponent = {
    key: "Common/X",
    uri: document.uri as unknown as import("vscode").Uri,
    contributions: new Set(["Buttons"]),
    componentLocation: new Location(document.uri, componentRange) as unknown as import("vscode").Location,
    contributionDefinitions: new Map([["Buttons", new Location(document.uri, componentRange) as unknown as import("vscode").Location]]),
    contributionSummaries: new Map(),
    formControlDefinitions: new Map(),
    formButtonDefinitions: new Map(),
    formSectionDefinitions: new Map(),
    workflowActionShareCodeDefinitions: new Map(),
    workflowControlShareCodeDefinitions: new Map(),
    workflowButtonShareCodeDefinitions: new Map(),
    workflowButtonShareCodeButtonIdents: new Map()
  };
  return {
    formsByIdent: new Map([["A", form]]),
    formIdentByUri: new Map([[document.uri.toString(), "A"]]),
    componentsByKey: new Map([["Common/X", component]]),
    componentKeyByUri: new Map([[document.uri.toString(), "Common/X"]]),
    componentKeysByBaseName: new Map([["X", new Set(["Common/X"])]]),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

async function run(): Promise<void> {
  const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
  const { SfpXmlCompletionProvider } = require("../../providers/completionProvider") as typeof import("../../providers/completionProvider");
  const { SfpXmlReferencesProvider } = require("../../providers/referencesProvider") as typeof import("../../providers/referencesProvider");
  const { SfpXmlDefinitionProvider } = require("../../providers/definitionProvider") as typeof import("../../providers/definitionProvider");
  const { SfpXmlRenameProvider } = require("../../providers/renameProvider") as typeof import("../../providers/renameProvider");

  const docText = `<Form Ident="A"><Using Component="Common/X" Section="Buttons" /></Form>`;
  const doc = new MockTextDocument(path.join(workspaceRoot, "XML_Templates/100_Test/ProviderSnapshotForm.xml"), docText);
  const facts = parseDocumentFactsFromText(docText);
  const componentValueOffset = docText.indexOf("Common/X");
  const componentPos = doc.positionAt(componentValueOffset + 1);
  const formIdentOffset = docText.indexOf("A");
  const formIdentPos = doc.positionAt(formIdentOffset);
  const index = createIndex(doc);

  // 1) Snapshot-only: accessor present but returns undefined => no fallback parsing.
  const refSnapshotOnly = new SfpXmlReferencesProvider(() => index, () => undefined, () => undefined, () => [], () => 1);
  const refs = refSnapshotOnly.provideReferences(
    doc as unknown as import("vscode").TextDocument,
    componentPos as unknown as import("vscode").Position,
    { includeDeclaration: true } as unknown as import("vscode").ReferenceContext
  );
  assert.deepEqual(refs, []);

  const defSnapshotOnly = new SfpXmlDefinitionProvider(() => index, () => undefined, () => undefined, () => 1);
  const def = defSnapshotOnly.provideDefinition(
    doc as unknown as import("vscode").TextDocument,
    componentPos as unknown as import("vscode").Position
  );
  assert.equal(def, undefined);

  const renameSnapshotOnly = new SfpXmlRenameProvider(() => index, () => undefined, () => undefined, () => [], () => 1);
  const rename = await renameSnapshotOnly.provideRenameEdits(
    doc as unknown as import("vscode").TextDocument,
    formIdentPos as unknown as import("vscode").Position,
    "B"
  );
  assert.equal(rename, undefined);

  const completionSnapshotOnly = new SfpXmlCompletionProvider(() => index, undefined, () => undefined, () => undefined, () => [], () => 1);
  const completionItems = await completionSnapshotOnly.provideCompletionItems(
    doc as unknown as import("vscode").TextDocument,
    componentPos as unknown as import("vscode").Position
  );
  if (completionItems instanceof CompletionList) {
    assert.equal(completionItems.items.length, 0);
  } else if (Array.isArray(completionItems)) {
    assert.equal(completionItems.length, 0);
  }

  // 2) Version contract: when version changes mid-request, provider recomputes.
  let modelVersionCalls = 0;
  const versionAccessor = (): number => {
    modelVersionCalls++;
    return modelVersionCalls === 1 ? 1 : 2;
  };

  let factsCalls = 0;
  const factsAccessor = () => {
    factsCalls++;
    return facts;
  };

  const refRetry = new SfpXmlReferencesProvider(() => index, factsAccessor, () => facts, () => [], versionAccessor);
  const refResult = refRetry.provideReferences(
    doc as unknown as import("vscode").TextDocument,
    componentPos as unknown as import("vscode").Position,
    { includeDeclaration: true } as unknown as import("vscode").ReferenceContext
  );
  assert.ok(Array.isArray(refResult));
  assert.ok(factsCalls >= 2, "Expected references provider to re-run when model version changed.");

  let defFactsCalls = 0;
  const defRetry = new SfpXmlDefinitionProvider(
    () => index,
    () => {
      defFactsCalls++;
      return facts;
    },
    () => facts,
    (() => {
      let calls = 0;
      return () => (++calls === 1 ? 10 : 11);
    })()
  );
  const defResult = defRetry.provideDefinition(
    doc as unknown as import("vscode").TextDocument,
    componentPos as unknown as import("vscode").Position
  );
  assert.ok(defResult);
  assert.ok(defFactsCalls >= 2, "Expected definition provider to re-run when model version changed.");

  console.log("Provider snapshot consistency tests passed.");
}

void run();
