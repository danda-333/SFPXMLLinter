import { strict as assert } from "node:assert";
import { createValidationModules } from "../../core/validation/validationModules";
import { SymbolRegistry } from "../../core/symbols/symbolRegistry";
import { FactRegistry } from "../../core/facts/factRegistry";
import { registerDefaultFactsAndSymbols } from "../../core/facts/registerDefaultFactsAndSymbols";

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

  const resolverKinds = new Set(symbolRegistry.getResolverKinds());
  const missingByModule: Array<{ moduleId: string; missingSymbols: string[] }> = [];
  let modulesDeclaringSymbols = 0;

  for (const module of modules) {
    const needsSymbols = module.needsSymbols ?? [];
    if (needsSymbols.length > 0) {
      modulesDeclaringSymbols++;
    }
    const missingSymbols = needsSymbols.filter((kind) => !resolverKinds.has(kind));
    if (missingSymbols.length > 0) {
      missingByModule.push({
        moduleId: module.id,
        missingSymbols: [...new Set(missingSymbols)].sort((a, b) => a.localeCompare(b))
      });
    }
  }

  assert.equal(
    missingByModule.length,
    0,
    `Validation module symbol contract violation: ${JSON.stringify(missingByModule)}`
  );
  assert.ok(modules.length > 0, "Expected at least one validation module.");

  console.log(
    `\x1b[32mValidation module symbol contract tests passed.\x1b[0m modulesWithNeedsSymbols=${modulesDeclaringSymbols}`
  );
}

run();
