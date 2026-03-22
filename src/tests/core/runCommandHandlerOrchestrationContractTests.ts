import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const COMMAND_REGISTRAR_FILES = [
  "src/core/ui/coreCommandsRegistrarService.ts",
  "src/core/ui/compositionCommandsRegistrarService.ts",
  "src/core/ui/workspaceMaintenanceCommandsRegistrarService.ts"
];

const EXTENSION_FILE = "src/extension.ts";

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ description: string; regex: RegExp }> = [
  { description: "direct build service import", regex: /from\s+["'][^"']*buildXmlTemplatesService["']/ },
  { description: "direct diagnostics engine import", regex: /from\s+["'][^"']*diagnostics\/engine["']/ },
  { description: "direct workspace indexer import", regex: /from\s+["'][^"']*indexer\/workspaceIndexer["']/ },
  { description: "direct update orchestrator import", regex: /from\s+["'][^"']*orchestrator\/updateOrchestrator["']/ },
  { description: "direct template build orchestrator import", regex: /from\s+["'][^"']*templateBuildOrchestrator["']/ },
  { description: "direct validation host import", regex: /from\s+["'][^"']*core\/validation\/validationHost["']/ },
  { description: "direct document validation service import", regex: /from\s+["'][^"']*documentValidationService["']/ }
];

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf8");
}

function run(): void {
  const violations: string[] = [];

  for (const file of COMMAND_REGISTRAR_FILES) {
    const source = readProjectFile(file);

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.regex.test(source)) {
        violations.push(`${file}: forbidden ${pattern.description}`);
      }
    }

    const registerMatches = source.match(/\bregisterCommand\(/g) ?? [];
    assert.ok(registerMatches.length > 0, `${file}: expected at least one registerCommand(...) call.`);

    if (!/\bthis\.deps\./.test(source)) {
      violations.push(`${file}: command handlers must use dependency facade (this.deps.*).`);
    }
  }

  const extensionSource = readProjectFile(EXTENSION_FILE);
  assert.ok(
    !/\bregisterCommand\(\s*"sfpXmlLinter\./.test(extensionSource),
    "extension.ts must not register sfpXmlLinter commands directly; use registrar services."
  );

  assert.equal(
    violations.length,
    0,
    `Command handler orchestration contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("Command handler orchestration contract tests passed.");
}

run();

