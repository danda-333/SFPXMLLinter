import { strict as assert } from "node:assert";
import {
  ALL_VALIDATION_RULE_IDS,
  VALIDATION_RULE_MODE_MATRIX,
  createValidationModules
} from "../../core/validation/validationModules";

type FakeDiagnostic = { code: string };

function run(): void {
  const allRules = Array.from(ALL_VALIDATION_RULE_IDS);
  const allDiagnostics: FakeDiagnostic[] = allRules.map((ruleId) => ({ code: ruleId }));

  const modules = createValidationModules({
    runSource: () => allDiagnostics as unknown as import("vscode").Diagnostic[],
    runComposed: () => allDiagnostics as unknown as import("vscode").Diagnostic[]
  });

  assert.ok(modules.length > 0, "Expected at least one validation module.");

  const sourceRuleToModules = new Map<string, Set<string>>();
  const composedRuleToModules = new Map<string, Set<string>>();
  const moduleToRules = new Map<string, Set<string>>();

  for (const module of modules) {
    const produced = module.run({} as import("../../core/validation/types").ValidationRequest);
    const ruleIds = new Set(
      produced
        .map((item) => (typeof item.code === "string" ? item.code : ""))
        .filter((ruleId) => ruleId.length > 0)
    );
    moduleToRules.set(module.id, ruleIds);
    for (const ruleId of ruleIds) {
      const bucket = module.mode === "source" ? sourceRuleToModules : composedRuleToModules;
      const modulesForRule = bucket.get(ruleId) ?? new Set<string>();
      modulesForRule.add(module.id);
      bucket.set(ruleId, modulesForRule);
    }
  }

  for (const [moduleId, rules] of moduleToRules) {
    assert.ok(rules.size > 0, `Validation module '${moduleId}' does not emit any rule from matrix.`);
    for (const ruleId of rules) {
      assert.ok(
        allRules.includes(ruleId),
        `Validation module '${moduleId}' emits unknown rule '${ruleId}' outside ALL_VALIDATION_RULE_IDS.`
      );
    }
  }

  for (const ruleId of VALIDATION_RULE_MODE_MATRIX.sourceOnly) {
    assert.ok(
      (sourceRuleToModules.get(ruleId)?.size ?? 0) > 0,
      `sourceOnly rule '${ruleId}' is not covered by any source validation module.`
    );
    assert.equal(
      composedRuleToModules.get(ruleId)?.size ?? 0,
      0,
      `sourceOnly rule '${ruleId}' must not be emitted by composed-reference validation modules.`
    );
  }

  for (const ruleId of VALIDATION_RULE_MODE_MATRIX.composedOnly) {
    assert.ok(
      (composedRuleToModules.get(ruleId)?.size ?? 0) > 0,
      `composedOnly rule '${ruleId}' is not covered by any composed-reference validation module.`
    );
    assert.equal(
      sourceRuleToModules.get(ruleId)?.size ?? 0,
      0,
      `composedOnly rule '${ruleId}' must not be emitted by source validation modules.`
    );
  }

  for (const ruleId of VALIDATION_RULE_MODE_MATRIX.dual) {
    assert.ok(
      (sourceRuleToModules.get(ruleId)?.size ?? 0) > 0,
      `dual rule '${ruleId}' is missing source validation module coverage.`
    );
    assert.ok(
      (composedRuleToModules.get(ruleId)?.size ?? 0) > 0,
      `dual rule '${ruleId}' is missing composed-reference validation module coverage.`
    );
  }

  const coveredFromModules = new Set<string>([
    ...sourceRuleToModules.keys(),
    ...composedRuleToModules.keys()
  ]);
  for (const ruleId of ALL_VALIDATION_RULE_IDS) {
    assert.ok(
      coveredFromModules.has(ruleId),
      `Rule '${ruleId}' is present in matrix but not emitted by any validation module.`
    );
  }

  console.log(
    `\x1b[32mValidation module rule coverage contract passed.\x1b[0m modules=${modules.length} rules=${allRules.length}`
  );
}

run();
