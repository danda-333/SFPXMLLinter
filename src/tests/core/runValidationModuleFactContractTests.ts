import { strict as assert } from "node:assert";
import Module = require("node:module");
import { FactRegistry } from "../../core/facts/factRegistry";
import { registerDefaultFactsAndSymbols } from "../../core/facts/registerDefaultFactsAndSymbols";
import { createValidationModules } from "../../core/validation/validationModules";
import { SymbolRegistry } from "../../core/symbols/symbolRegistry";

class Position {
  public readonly line: number;
  public readonly character: number;
  public constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  public constructor(start: Position, end: Position) {
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

function run(): void {
  const factRegistry = new FactRegistry();
  const symbolRegistry = new SymbolRegistry();
  registerDefaultFactsAndSymbols({
    factRegistry,
    symbolRegistry,
    resolveParsedFacts: () => undefined
  });

  const modules = createValidationModules({
    runSource: () => [],
    runComposed: () => []
  });

  const providerKinds = new Set(factRegistry.getProviderKinds());
  const missingByModule: Array<{ moduleId: string; missingFacts: string[] }> = [];

  for (const module of modules) {
    const needsFacts = module.needsFacts ?? [];
    const missingFacts = needsFacts.filter((kind) => !providerKinds.has(kind));
    if (missingFacts.length > 0) {
      missingByModule.push({
        moduleId: module.id,
        missingFacts: [...new Set(missingFacts)].sort((a, b) => a.localeCompare(b))
      });
    }
  }

  assert.equal(
    missingByModule.length,
    0,
    `Validation module fact contract violation: ${JSON.stringify(missingByModule)}`
  );

  assert.ok(modules.length > 0, "Expected at least one validation module.");
  assert.ok(
    modules.some((module) => (module.needsFacts ?? []).length > 0),
    "Expected validation modules to declare fact dependencies."
  );

  console.log("\x1b[32mValidation module fact contract tests passed.\x1b[0m");
}

run();
