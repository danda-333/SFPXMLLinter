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

const vscodeMock = {
  Uri
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createPrimitiveQuickFixPayload } = require("../../composition/primitiveQuickFixPayload") as typeof import("../../composition/primitiveQuickFixPayload");

function run(): void {
  const uri = Uri.file("tests/fixtures/linter/XML_Templates/100_Test/ValidForm.xml");

  const paramPayload = createPrimitiveQuickFixPayload(uri as unknown as import("vscode").Uri, "param", "DialogIdent", "Common/Dialogs/DialogWithParam");
  assert.deepEqual(paramPayload, {
    uri,
    kind: "param",
    name: "DialogIdent",
    primitiveKey: "Common/Dialogs/DialogWithParam"
  });

  const slotPayload = createPrimitiveQuickFixPayload(uri as unknown as import("vscode").Uri, "slot", "Body", "Common/Dialogs/DialogWithSlot");
  assert.deepEqual(slotPayload, {
    uri,
    kind: "slot",
    name: "Body",
    primitiveKey: "Common/Dialogs/DialogWithSlot"
  });

  const unknownPayload = createPrimitiveQuickFixPayload(uri as unknown as import("vscode").Uri, "unknown", "Common/Missing/Primitive", "Common/Missing/Primitive");
  assert.deepEqual(unknownPayload, {
    uri,
    kind: "unknown",
    name: "Common/Missing/Primitive",
    primitiveKey: "Common/Missing/Primitive"
  });

  const cyclePayload = createPrimitiveQuickFixPayload(uri as unknown as import("vscode").Uri, "cycle", "Common/Cycle/CycleA", "Common/Cycle/CycleA");
  assert.deepEqual(cyclePayload, {
    uri,
    kind: "cycle",
    name: "Common/Cycle/CycleA",
    primitiveKey: "Common/Cycle/CycleA"
  });

  console.log("Tree quick-fix payload tests passed.");
}

run();
