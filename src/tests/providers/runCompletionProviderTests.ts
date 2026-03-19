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

class CompletionItem {
  public readonly label: string;
  public readonly kind: number;
  public insertText?: string;
  public detail?: string;
  public sortText?: string;
  public filterText?: string;
  public range?: Range;
  constructor(label: string, kind: number) {
    this.label = label;
    this.kind = kind;
  }
}

class CompletionList {
  public readonly items: CompletionItem[];
  public readonly isIncomplete: boolean;
  constructor(items: CompletionItem[], isIncomplete = false) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

class SnippetString {
  public readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  Enum = 12,
  Keyword = 13,
  Snippet = 15,
  File = 17,
  Reference = 18,
  EnumMember = 20
}

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(filePath: string, text: string) {
    this.uri = Uri.file(filePath);
    this.text = text;
    this.lineStarts = computeLineStarts(text);
  }

  public getText(range?: Range): string {
    if (!range) {
      return this.text;
    }
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this.text.slice(start, end);
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

  public lineAt(line: number | Position): { text: string } {
    const lineNo = typeof line === "number" ? line : line.line;
    const safeLine = Math.max(0, Math.min(lineNo, this.lineStarts.length - 1));
    const start = this.lineStarts[safeLine] ?? 0;
    const end = safeLine + 1 < this.lineStarts.length ? this.lineStarts[safeLine + 1] : this.text.length;
    return { text: this.text.slice(start, end).replace(/\r?\n$/, "") };
  }
}

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");

const vscodeMock = {
  Uri,
  Position,
  Range,
  CompletionItem,
  CompletionList,
  CompletionItemKind,
  SnippetString,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "fixture", index: 0 }],
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
          if (key === "workspaceRoots") {
            return ["XML", "XML_Templates", "XML_Components", "XML_Primitives"] as T;
          }
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

async function run(): Promise<void> {
  const { SfpXmlCompletionProvider } = require("../../providers/completionProvider") as typeof import("../../providers/completionProvider");
  const provider = new SfpXmlCompletionProvider(() => createIndex());

  const keyDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionPlaceholderForm.xml",
    "<Form Ident=\"A\"><Host>{{FeÂ¦}}</Host></Form>"
  );
  const keyItems = toItems(await provider.provideCompletionItems(keyDoc.document as unknown as import("vscode").TextDocument, keyDoc.position as unknown as import("vscode").Position));
  assert.ok(keyItems.some((item) => item.label === "Feature"), "Expected placeholder key completion to suggest 'Feature'.");
  assert.ok(keyItems.some((item) => item.insertText === "Feature:"), "Expected key completion insertText to include ':'.");

  const keyAfterFeatureDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionPlaceholderForm.xml",
    "<Form Ident=\"A\"><Host>{{Feature:Shared/Sample,ConÂ¦}}</Host></Form>"
  );
  const keyAfterFeatureItems = toItems(await provider.provideCompletionItems(keyAfterFeatureDoc.document as unknown as import("vscode").TextDocument, keyAfterFeatureDoc.position as unknown as import("vscode").Position));
  assert.ok(keyAfterFeatureItems.some((item) => item.label === "Contribution"), "Expected placeholder key completion to suggest 'Contribution'.");

  const keyRequiredParamDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionPlaceholderForm.xml",
    "<Form Ident=\"A\"><Host>{{Feature:Shared/Sample,Contribution:Controls,CuÂ¦}}</Host></Form>"
  );
  const keyRequiredParamItems = toItems(await provider.provideCompletionItems(keyRequiredParamDoc.document as unknown as import("vscode").TextDocument, keyRequiredParamDoc.position as unknown as import("vscode").Position));
  assert.ok(keyRequiredParamItems.some((item) => item.label === "CustomParam"), "Expected required contribution param key completion ('CustomParam').");

  const valueDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionPlaceholderForm.xml",
    "<Form Ident=\"A\"><Host>{{Feature:Shared/Sample,Contribution:Â¦}}</Host></Form>"
  );
  const valueItems = toItems(await provider.provideCompletionItems(valueDoc.document as unknown as import("vscode").TextDocument, valueDoc.position as unknown as import("vscode").Position));
  assert.ok(valueItems.some((item) => item.label === "Controls"), "Expected contribution value completion to include root-relevant 'Controls'.");
  assert.ok(valueItems.some((item) => item.label === "ActionShareCodes"), "Expected contribution value completion to include filtered 'ActionShareCodes'.");

  const primitiveValueDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionPlaceholderForm.xml",
    "<Form Ident=\"A\"><Host>{{Primitive:Common/Dialogs/DialogWithSlot,Template:Â¦}}</Host></Form>"
  );
  const primitiveValueItems = toItems(await provider.provideCompletionItems(primitiveValueDoc.document as unknown as import("vscode").TextDocument, primitiveValueDoc.position as unknown as import("vscode").Position));
  assert.ok(primitiveValueItems.some((item) => item.label === "Main"), "Expected primitive template value completion to include 'Main'.");
  assert.ok(primitiveValueItems.some((item) => item.label === "Compact"), "Expected primitive template value completion to include 'Compact'.");

  const workflowButtonIdentDoc = createDocFromCursor(
    "XML_Templates/100_Test/CompletionWorkflow.xml",
    "<WorkFlow FormIdent=\"FormA\"><Steps><Step><Groups><Group><Buttons><Button Ident=\"Â¦\" /></Buttons></Group></Groups></Step></Steps></WorkFlow>"
  );
  const workflowButtonIdentItems = toItems(await provider.provideCompletionItems(workflowButtonIdentDoc.document as unknown as import("vscode").TextDocument, workflowButtonIdentDoc.position as unknown as import("vscode").Position));
  assert.ok(
    workflowButtonIdentItems.some((item) => item.label === "InjectedButton"),
    "Expected workflow button Ident completion to include owner Form effective injected button ('InjectedButton')."
  );

  console.log("Completion provider placeholder tests passed.");
}

function createDocFromCursor(relativePath: string, withCursor: string): { document: MockTextDocument; position: Position } {
  const marker = "Â¦";
  const offset = withCursor.indexOf(marker);
  if (offset < 0) {
    throw new Error("Missing cursor marker.");
  }

  const text = withCursor.slice(0, offset) + withCursor.slice(offset + marker.length);
  const filePath = path.join(workspaceRoot, ...relativePath.split("/"));
  const document = new MockTextDocument(filePath, text);
  return {
    document,
    position: document.positionAt(offset)
  };
}

function createIndex(): import("../../indexer/types").WorkspaceIndex {
  const contributionSummaries = new Map<string, import("../../indexer/types").IndexedComponentContributionSummary>();
  contributionSummaries.set("Controls", {
    contributionName: "Controls",
    root: "form",
    rootExpression: "form",
    insert: "append",
    targetXPath: "//Form/Controls",
    allowMultipleInserts: false,
    hasContent: true,
    formControlCount: 1,
    formButtonCount: 0,
    formSectionCount: 0,
    workflowActionShareCodeCount: 0,
    workflowControlShareCodeCount: 0,
    workflowButtonShareCodeCount: 0,
    formControlIdents: new Set(["X"]),
    formButtonIdents: new Set(),
    formSectionIdents: new Set(),
    workflowReferencedActionShareCodeIdents: new Set(),
    workflowActionShareCodeIdents: new Set(),
    workflowControlShareCodeIdents: new Set(),
    workflowButtonShareCodeIdents: new Set(),
    requiredParamNames: new Set(["CustomParam"]),
    primitiveUsageCountByKey: new Map(),
    primitiveTemplateNamesByKey: new Map(),
    primitiveProvidedParamNamesByKey: new Map(),
    primitiveProvidedSlotNamesByKey: new Map()
  });
  contributionSummaries.set("Buttons", {
    contributionName: "Buttons",
    root: "form",
    rootExpression: "form",
    insert: "append",
    targetXPath: "//Form/Buttons",
    allowMultipleInserts: false,
    hasContent: true,
    formControlCount: 0,
    formButtonCount: 1,
    formSectionCount: 0,
    workflowActionShareCodeCount: 0,
    workflowControlShareCodeCount: 0,
    workflowButtonShareCodeCount: 0,
    formControlIdents: new Set(),
    formButtonIdents: new Set(["InjectedButton"]),
    formSectionIdents: new Set(),
    workflowReferencedActionShareCodeIdents: new Set(),
    workflowActionShareCodeIdents: new Set(),
    workflowControlShareCodeIdents: new Set(),
    workflowButtonShareCodeIdents: new Set(),
    requiredParamNames: new Set(),
    primitiveUsageCountByKey: new Map(),
    primitiveTemplateNamesByKey: new Map(),
    primitiveProvidedParamNamesByKey: new Map(),
    primitiveProvidedSlotNamesByKey: new Map()
  });
  contributionSummaries.set("ActionShareCodes", {
    contributionName: "ActionShareCodes",
    root: "workflow",
    rootExpression: "workflow",
    insert: "append",
    targetXPath: "//WorkFlow/ActionShareCodes",
    allowMultipleInserts: false,
    hasContent: true,
    formControlCount: 0,
    formButtonCount: 0,
    formSectionCount: 0,
    workflowActionShareCodeCount: 1,
    workflowControlShareCodeCount: 0,
    workflowButtonShareCodeCount: 0,
    formControlIdents: new Set(),
    formButtonIdents: new Set(),
    formSectionIdents: new Set(),
    workflowReferencedActionShareCodeIdents: new Set(),
    workflowActionShareCodeIdents: new Set(["WF_Action"]),
    workflowControlShareCodeIdents: new Set(),
    workflowButtonShareCodeIdents: new Set(),
    requiredParamNames: new Set(),
    primitiveUsageCountByKey: new Map(),
    primitiveTemplateNamesByKey: new Map(),
    primitiveProvidedParamNamesByKey: new Map(),
    primitiveProvidedSlotNamesByKey: new Map()
  });

  const component: import("../../indexer/types").IndexedComponent = {
    key: "Shared/Sample",
    uri: Uri.file(path.join(workspaceRoot, "XML_Components", "Shared", "Sample.feature.xml")) as unknown as import("vscode").Uri,
    contributions: new Set(["Controls", "Buttons", "ActionShareCodes"]),
    componentLocation: { uri: Uri.file(workspaceRoot), range: new Range(new Position(0, 0), new Position(0, 0)) } as unknown as import("vscode").Location,
    contributionDefinitions: new Map(),
    contributionSummaries,
    formControlDefinitions: new Map([["X", { uri: Uri.file(workspaceRoot), range: new Range(new Position(0, 0), new Position(0, 0)) } as unknown as import("vscode").Location]]),
    formButtonDefinitions: new Map(),
    formSectionDefinitions: new Map(),
    workflowActionShareCodeDefinitions: new Map([["WF_Action", { uri: Uri.file(workspaceRoot), range: new Range(new Position(0, 0), new Position(0, 0)) } as unknown as import("vscode").Location]]),
    workflowControlShareCodeDefinitions: new Map(),
    workflowButtonShareCodeDefinitions: new Map(),
    workflowButtonShareCodeButtonIdents: new Map()
  };

  const componentsByKey = new Map<string, import("../../indexer/types").IndexedComponent>([["Shared/Sample", component]]);
  const primitiveContributionSummaries = new Map<string, import("../../indexer/types").IndexedComponentContributionSummary>();
  primitiveContributionSummaries.set("Main", {
    contributionName: "Main",
    root: "form",
    rootExpression: "form",
    insert: "placeholder",
    targetXPath: undefined,
    allowMultipleInserts: false,
    hasContent: true,
    formControlCount: 0,
    formButtonCount: 0,
    formSectionCount: 0,
    workflowActionShareCodeCount: 0,
    workflowControlShareCodeCount: 0,
    workflowButtonShareCodeCount: 0,
    formControlIdents: new Set(),
    formButtonIdents: new Set(),
    formSectionIdents: new Set(),
    workflowReferencedActionShareCodeIdents: new Set(),
    workflowActionShareCodeIdents: new Set(),
    workflowControlShareCodeIdents: new Set(),
    workflowButtonShareCodeIdents: new Set(),
    requiredParamNames: new Set(["DialogIdent"]),
    primitiveUsageCountByKey: new Map(),
    primitiveTemplateNamesByKey: new Map(),
    primitiveProvidedParamNamesByKey: new Map(),
    primitiveProvidedSlotNamesByKey: new Map()
  });
  primitiveContributionSummaries.set("Compact", {
    contributionName: "Compact",
    root: "form",
    rootExpression: "form",
    insert: "placeholder",
    targetXPath: undefined,
    allowMultipleInserts: false,
    hasContent: true,
    formControlCount: 0,
    formButtonCount: 0,
    formSectionCount: 0,
    workflowActionShareCodeCount: 0,
    workflowControlShareCodeCount: 0,
    workflowButtonShareCodeCount: 0,
    formControlIdents: new Set(),
    formButtonIdents: new Set(),
    formSectionIdents: new Set(),
    workflowReferencedActionShareCodeIdents: new Set(),
    workflowActionShareCodeIdents: new Set(),
    workflowControlShareCodeIdents: new Set(),
    workflowButtonShareCodeIdents: new Set(),
    requiredParamNames: new Set(),
    primitiveUsageCountByKey: new Map(),
    primitiveTemplateNamesByKey: new Map(),
    primitiveProvidedParamNamesByKey: new Map(),
    primitiveProvidedSlotNamesByKey: new Map()
  });
  const primitiveComponent: import("../../indexer/types").IndexedComponent = {
    key: "Common/Dialogs/DialogWithSlot",
    uri: Uri.file(path.join(workspaceRoot, "XML_Primitives", "Common", "Dialogs", "DialogWithSlot.primitive.xml")) as unknown as import("vscode").Uri,
    contributions: new Set(["Main", "Compact"]),
    componentLocation: { uri: Uri.file(workspaceRoot), range: new Range(new Position(0, 0), new Position(0, 0)) } as unknown as import("vscode").Location,
    contributionDefinitions: new Map(),
    contributionSummaries: primitiveContributionSummaries,
    formControlDefinitions: new Map(),
    formButtonDefinitions: new Map(),
    formSectionDefinitions: new Map(),
    workflowActionShareCodeDefinitions: new Map(),
    workflowControlShareCodeDefinitions: new Map(),
    workflowButtonShareCodeDefinitions: new Map(),
    workflowButtonShareCodeButtonIdents: new Map()
  };
  componentsByKey.set("Common/Dialogs/DialogWithSlot", primitiveComponent);
  const componentKeysByBaseName = new Map<string, Set<string>>([["Sample", new Set(["Shared/Sample"])]]);
  componentKeysByBaseName.set("DialogWithSlot", new Set(["Common/Dialogs/DialogWithSlot"]));

  const { parseDocumentFacts } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
  const formUri = Uri.file(path.join(workspaceRoot, "XML_Templates", "100_Test", "FormA.xml")) as unknown as import("vscode").Uri;
  const formDocument = new MockTextDocument(
    path.join(workspaceRoot, "XML_Templates", "100_Test", "FormA.xml"),
    "<Form Ident=\"FormA\"><Usings><Using Feature=\"Shared/Sample\" Contribution=\"Buttons\" /></Usings><Buttons></Buttons></Form>"
  );

  return {
    formsByIdent: new Map([
      [
        "FormA",
        {
          ident: "FormA",
          uri: formUri,
          controls: new Set<string>(),
          buttons: new Set<string>(),
          sections: new Set<string>(),
          formIdentLocation: { uri: formUri, range: new Range(new Position(0, 0), new Position(0, 0)) } as unknown as import("vscode").Location,
          controlDefinitions: new Map(),
          buttonDefinitions: new Map(),
          sectionDefinitions: new Map()
        } satisfies import("../../indexer/types").IndexedForm
      ]
    ]),
    componentsByKey,
    componentKeysByBaseName,
    parsedFactsByUri: new Map([
      [formUri.toString(), parseDocumentFacts(formDocument as unknown as import("vscode").TextDocument)]
    ]),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

function toItems(
  result: import("vscode").CompletionItem[] | import("vscode").CompletionList | undefined
): Array<{ label: string; insertText?: string }> {
  if (!result) {
    return [];
  }

  const list = Array.isArray(result)
    ? result
    : result.items;
  return list.map((item) => ({
    label: String(item.label),
    insertText: typeof item.insertText === "string" ? item.insertText : undefined
  }));
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

void run().catch((error) => {
  console.error("Completion provider placeholder tests failed.");
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
