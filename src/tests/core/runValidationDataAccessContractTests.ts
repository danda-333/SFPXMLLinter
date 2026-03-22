import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const VALIDATION_ROOT = path.join(PROJECT_ROOT, "src/core/validation");

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

function run(): void {
  const files: string[] = [];
  walk(VALIDATION_ROOT, files);
  const violations: string[] = [];

  const forbiddenImportPatterns: ReadonlyArray<{ key: string; regex: RegExp }> = [
    { key: "workspace indexer import", regex: /from\s+["'][^"']*indexer\/workspaceIndexer["']/ },
    { key: "orchestrator update import", regex: /from\s+["'][^"']*orchestrator\/updateOrchestrator["']/ },
    { key: "template build orchestrator import", regex: /from\s+["'][^"']*templateBuildOrchestrator["']/ }
  ];

  const forbiddenDirectMapAccessPatterns: ReadonlyArray<{ key: string; regex: RegExp }> = [
    { key: "direct formsByIdent map access", regex: /\bformsByIdent\.(get|set|has|entries|values|keys)\(/ },
    { key: "direct componentsByKey map access", regex: /\bcomponentsByKey\.(get|set|has|entries|values|keys)\(/ },
    { key: "direct parsedFactsByUri map access", regex: /\bparsedFactsByUri\.(get|set|has|entries|values|keys)\(/ },
    { key: "direct componentKeyByUri map access", regex: /\bcomponentKeyByUri\.(get|set|has|entries|values|keys)\(/ },
    { key: "direct formIdentByUri map access", regex: /\bformIdentByUri\.(get|set|has|entries|values|keys)\(/ }
  ];

  for (const file of files) {
    const rel = normalize(path.relative(PROJECT_ROOT, file));
    if (rel.includes("/tests/")) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");

    for (const pattern of forbiddenImportPatterns) {
      if (pattern.regex.test(source)) {
        violations.push(`${rel}: forbidden ${pattern.key}`);
      }
    }

    for (const pattern of forbiddenDirectMapAccessPatterns) {
      if (pattern.regex.test(source)) {
        violations.push(`${rel}: forbidden ${pattern.key}`);
      }
    }
  }

  const validationModulesPath = path.join(VALIDATION_ROOT, "validationModules.ts");
  const validationModulesSource = fs.readFileSync(validationModulesPath, "utf8");
  assert.ok(
    /\bcreateValidationModules\s*\(/.test(validationModulesSource),
    "validationModules.ts must expose createValidationModules(...) factory."
  );
  assert.ok(
    !/\bnew\s+DiagnosticsEngine\s*\(/.test(validationModulesSource),
    "validationModules.ts must not instantiate DiagnosticsEngine directly; use injected ValidationRunnerDeps."
  );
  assert.ok(
    /\bdeps\.runSource\(/.test(validationModulesSource) && /\bdeps\.runComposed\(/.test(validationModulesSource),
    "validationModules.ts must use injected deps.runSource/deps.runComposed pipelines."
  );

  assert.equal(
    violations.length,
    0,
    `Validation data access contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mValidation data access contract tests passed.\x1b[0m");
}

run();

