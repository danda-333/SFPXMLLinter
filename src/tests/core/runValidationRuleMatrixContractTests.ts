import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

type RuleGroups = Record<string, string[]>;

function run(): void {
  const repoRoot = path.resolve(__dirname, "../../..");
  const validationSource = fs.readFileSync(path.join(repoRoot, "src/core/validation/validationModules.ts"), "utf8");
  const engineSource = fs.readFileSync(path.join(repoRoot, "src/diagnostics/engine.ts"), "utf8");
  const settingsSource = fs.readFileSync(path.join(repoRoot, "src/config/settings.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    contributes?: { configuration?: { properties?: Record<string, unknown> } };
  };

  const ruleGroups = parseValidationRuleGroups(validationSource);
  const requiredGroups = ["duplicates", "references", "using", "conventions", "feature", "primitives", "composedReference"];
  for (const group of requiredGroups) {
    assert.ok(Array.isArray(ruleGroups[group]), `Missing validation rule group '${group}'.`);
  }

  const sourceCandidates = new Set<string>([
    ...ruleGroups.duplicates,
    ...ruleGroups.references,
    ...ruleGroups.using,
    ...ruleGroups.conventions,
    ...ruleGroups.feature,
    ...ruleGroups.primitives
  ]);
  const composedCandidates = new Set<string>(ruleGroups.composedReference);
  const dual = new Set<string>(Array.from(sourceCandidates).filter((id) => composedCandidates.has(id)));
  const sourceOnly = new Set<string>(Array.from(sourceCandidates).filter((id) => !dual.has(id)));
  const composedOnly = new Set<string>(Array.from(composedCandidates).filter((id) => !dual.has(id)));
  const matrixAll = new Set<string>([...sourceOnly, ...composedOnly, ...dual]);

  const defaultRulesSettings = parseDefaultRulesFromSettings(settingsSource);
  const defaultRulesPackage = parseDefaultRulesFromPackage(packageJson);
  const engineRules = parseRuleIdsFromEngine(engineSource);

  assert.deepEqual(
    Array.from(defaultRulesSettings).sort((a, b) => a.localeCompare(b)),
    Array.from(defaultRulesPackage).sort((a, b) => a.localeCompare(b)),
    "DEFAULT_RULES in settings.ts must match package.json default rules."
  );

  for (const ruleId of engineRules) {
    assert.ok(matrixAll.has(ruleId), `Engine-emitted rule '${ruleId}' is missing from validation rule matrix/groups.`);
  }

  for (const ruleId of matrixAll) {
    assert.ok(defaultRulesSettings.has(ruleId), `Validation matrix rule '${ruleId}' is missing in settings DEFAULT_RULES.`);
    assert.ok(defaultRulesPackage.has(ruleId), `Validation matrix rule '${ruleId}' is missing in package.json default rules.`);
  }

  assert.ok(
    composedOnly.has("missing-feature-expected-xpath"),
    "'missing-feature-expected-xpath' must stay composed-only."
  );

  console.log(
    `Validation rule matrix contract passed. sourceOnly=${sourceOnly.size}, composedOnly=${composedOnly.size}, dual=${dual.size}`
  );
}

function parseValidationRuleGroups(source: string): RuleGroups {
  const start = source.indexOf("export const VALIDATION_RULE_GROUPS = {");
  const end = source.indexOf("} as const;", start);
  assert.ok(start >= 0 && end > start, "Could not locate VALIDATION_RULE_GROUPS block.");
  const block = source.slice(start, end);
  const groups: RuleGroups = {};
  const groupRegex = /(\w+):\s*\[([\s\S]*?)\],?/g;
  for (const match of block.matchAll(groupRegex)) {
    const name = match[1] ?? "";
    const body = match[2] ?? "";
    if (!name) {
      continue;
    }
    groups[name] = Array.from(body.matchAll(/"([^"]+)"/g)).map((item) => item[1] ?? "").filter((value) => value.length > 0);
  }
  return groups;
}

function parseDefaultRulesFromSettings(source: string): Set<string> {
  const start = source.indexOf("export const DEFAULT_RULES");
  const objStart = source.indexOf("{", start);
  const objEnd = source.indexOf("};", objStart);
  assert.ok(start >= 0 && objStart > start && objEnd > objStart, "Could not locate DEFAULT_RULES block in settings.ts.");
  const block = source.slice(objStart, objEnd);
  return new Set(Array.from(block.matchAll(/"([^"]+)"\s*:/g)).map((match) => match[1] ?? "").filter((id) => id.length > 0));
}

function parseDefaultRulesFromPackage(pkg: {
  contributes?: { configuration?: { properties?: Record<string, unknown> } };
}): Set<string> {
  const rulesProperty = pkg.contributes?.configuration?.properties?.["sfpXmlLinter.rules"] as { default?: Record<string, unknown> } | undefined;
  assert.ok(rulesProperty?.default, "Missing package.json configuration property sfpXmlLinter.rules.default.");
  return new Set(Object.keys(rulesProperty.default ?? {}));
}

function parseRuleIdsFromEngine(source: string): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/ruleId:\s*"([^"]+)"/g)) {
    const ruleId = match[1] ?? "";
    if (ruleId.length > 0) {
      out.add(ruleId);
    }
  }
  return out;
}

run();
