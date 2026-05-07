import { strict as assert } from "node:assert";
import * as path from "node:path";
import Module = require("node:module");
import type { WorkspaceIndex } from "../../indexer/types";

class Uri {
  public readonly fsPath: string;
  public readonly scheme: string;
  private constructor(fsPath: string, scheme = "file") {
    this.fsPath = path.resolve(fsPath);
    this.scheme = scheme;
  }
  public static file(fsPath: string): Uri {
    return new Uri(fsPath, "file");
  }
  public static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      return new Uri(value.slice("file://".length), "file");
    }
    return new Uri(value);
  }
  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

class Position {
  public constructor(public readonly line: number, public readonly character: number) {}
}

class Range {
  public constructor(public readonly start: Position, public readonly end: Position) {}
}

class Location {
  public constructor(public readonly uri: Uri, public readonly range: Range) {}
}

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");
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

function makeRange(line: number): Range {
  return new Range(new Position(line, 0), new Position(line, 10));
}

function createBaseIndex(): WorkspaceIndex {
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

function run(): void {
  const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
  const { findFormSymbolDeclaration } = require("../../providers/referenceModelUtils") as typeof import("../../providers/referenceModelUtils");

  // Regression A: parsed facts declaration is preferred when available.
  {
    const index = createBaseIndex();
    const formUri = Uri.file(path.join(workspaceRoot, "XML_Templates/100_Test/RefModelA.xml")) as unknown as import("vscode").Uri;
    const xml = [
      "<Form Ident=\"FormA\">",
      "  <Controls>",
      "    <Control Ident=\"ControlA\" />",
      "  </Controls>",
      "</Form>"
    ].join("\n");
    const facts = parseDocumentFactsFromText(xml);
    index.parsedFactsByUri.set((formUri as unknown as Uri).toString(), facts);

    const formRange = makeRange(0) as unknown as import("vscode").Range;
    const fallbackRange = makeRange(20) as unknown as import("vscode").Range;
    index.formsByIdent.set("FormA", {
      ident: "FormA",
      uri: formUri,
      controls: new Set(["ControlA"]),
      buttons: new Set(),
      sections: new Set(),
      formIdentLocation: new Location(formUri as unknown as Uri, formRange as unknown as Range) as unknown as import("vscode").Location,
      controlDefinitions: new Map([["ControlA", new Location(formUri as unknown as Uri, fallbackRange as unknown as Range) as unknown as import("vscode").Location]]),
      buttonDefinitions: new Map(),
      sectionDefinitions: new Map()
    });

    const found = findFormSymbolDeclaration(index, "FormA", "control", "ControlA");
    assert.ok(found, "Expected control declaration from parsed facts.");
    assert.equal((found!.uri as unknown as Uri).toString(), (formUri as unknown as Uri).toString());
    assert.notEqual(
      (found!.range as unknown as Range).start.line,
      (fallbackRange as unknown as Range).start.line,
      "Parsed-facts range should win over indexed fallback range."
    );
  }

  // Regression B: case-insensitive form ident lookup falls back to indexed form definitions.
  {
    const index = createBaseIndex();
    const formUri = Uri.file(path.join(workspaceRoot, "XML_Templates/100_Test/RefModelB.xml")) as unknown as import("vscode").Uri;
    const buttonRange = makeRange(7) as unknown as import("vscode").Range;
    index.formsByIdent.set("ITSMRequest", {
      ident: "ITSMRequest",
      uri: formUri,
      controls: new Set(),
      buttons: new Set(["SaveButton"]),
      sections: new Set(),
      formIdentLocation: new Location(formUri as unknown as Uri, makeRange(0) as unknown as Range) as unknown as import("vscode").Location,
      controlDefinitions: new Map(),
      buttonDefinitions: new Map([["SaveButton", new Location(formUri as unknown as Uri, buttonRange as unknown as Range) as unknown as import("vscode").Location]]),
      sectionDefinitions: new Map()
    });

    const found = findFormSymbolDeclaration(index, "itsmrequest", "button", "SaveButton");
    assert.ok(found, "Expected case-insensitive lookup to find indexed fallback definition.");
    assert.equal((found!.uri as unknown as Uri).toString(), (formUri as unknown as Uri).toString());
    assert.equal((found!.range as unknown as Range).start.line, (buttonRange as unknown as Range).start.line);
  }
}

run();
console.log("\x1b[32mReference model utils tests passed.\x1b[0m");

