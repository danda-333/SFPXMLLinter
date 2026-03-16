import { strict as assert } from "node:assert";
import Module = require("node:module");

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

const vscodeMock = {
  Position,
  Range
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

function run(): void {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<Form Ident="SampleForm">
  <Buttons>
    <UsePrimitive Name="Common/Buttons/Button" Template="CloseButton" Ident="OperatorCloseButton">
      <Arg Name="ButtonText" Value="Close as Operator" />
    </UsePrimitive>
    <UsePrimitive Name="Common/Buttons/Button" Template="CloseButton" Ident="AuthorCloseButton" />
  </Buttons>
  <Controls>
    <UsePrimitive Name="Common/Controls/DateTimePicker" Template="Picker" Ident="NotAButton" />
  </Controls>
</Form>`;

  const facts = parseDocumentFactsFromText(xml);

  const buttonIdents = new Set(facts.declaredButtonInfos.map((item) => item.ident));
  assert.equal(buttonIdents.has("OperatorCloseButton"), true, "Expected OperatorCloseButton from UsePrimitive.");
  assert.equal(buttonIdents.has("AuthorCloseButton"), true, "Expected AuthorCloseButton from UsePrimitive.");
  assert.equal(buttonIdents.has("NotAButton"), false, "Non-button primitive should not be treated as button.");

  const operatorOccurrence = facts.identOccurrences.find((item) => item.kind === "button" && item.ident === "OperatorCloseButton");
  assert.ok(operatorOccurrence, "Expected OperatorCloseButton button occurrence.");
  assert.equal((operatorOccurrence?.scopeKey ?? "").startsWith("buttons@"), true, "Expected root Buttons scope for UsePrimitive button.");

  console.log("XML facts primitive-button tests passed.");
}

run();

