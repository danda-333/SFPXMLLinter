import { strict as assert } from "node:assert";
import Module = require("node:module");

class Uri {
  public readonly fsPath: string;
  public readonly scheme: string;

  private constructor(fsPath: string, scheme = "file") {
    this.fsPath = fsPath.replace(/\\/g, "/");
    this.scheme = scheme;
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath, "file");
  }

  public toString(): string {
    return `${this.scheme}://${this.fsPath}`;
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

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as typeof import("../../indexer/workspaceIndexer");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";

  constructor(uri: Uri, private readonly text: string) {
    this.uri = uri;
  }

  public getText(): string {
    return this.text;
  }
}

function run(): void {
  const indexer = new WorkspaceIndexer([]);
  const formUri = Uri.file("C:/repo/XML/100_Test/RegressionForm.xml");
  const text = `<?xml version="1.0" encoding="utf-8"?>
<Form Ident="RegressionForm">
  <Controls>
    <Control xsi:type="HTMLTemplateControl" Ident="TemplateBlock" DataType="String">
      <Template>
        <Control ID="UserName" />
        <ControlLabel ControlID="UserName" />
        <ControlPlaceHolder ControlID="UserName" />
      </Template>
    </Control>
  </Controls>
  <ControlDataSource MappingFormIdent="RegressionForm">
    <Mappings>
      <Mapping FromIdent="ID" ToIdent="UserName" />
    </Mappings>
  </ControlDataSource>
</Form>`;

  const doc = new MockTextDocument(formUri, text);
  const result = indexer.refreshFormDocument(
    doc as unknown as import("vscode").TextDocument,
    { composedOutput: true, lightweightFormSymbols: true, skipUsingTrace: true }
  );

  assert.equal(result.updated, true, "Expected form refresh to update index.");
  const facts = indexer.getIndex().parsedFactsByUri.get(formUri.toString());
  assert.ok(facts, "Expected parsed facts for refreshed form.");

  const htmlRefs = facts?.htmlControlReferences ?? [];
  assert.equal(
    htmlRefs.some((ref) => ref.ident === "UserName"),
    true,
    "Expected HTML control references to be preserved in composed/lightweight refresh."
  );

  const mappingRefs = facts?.mappingIdentReferences ?? [];
  assert.equal(
    mappingRefs.some((ref) => ref.kind === "toIdent" && ref.ident === "UserName"),
    true,
    "Expected mapping references to be preserved in composed/lightweight refresh."
  );

  console.log("Workspace indexer composed facts regression tests passed.");
}

run();
