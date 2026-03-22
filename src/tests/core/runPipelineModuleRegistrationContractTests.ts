import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const EXTENSION_PATH = path.join(PROJECT_ROOT, "src/extension.ts");

const REQUIRED_MODULES_IN_ORDER = [
  "ModelSyncModule",
  "DocumentEventsModule",
  "DiagnosticsEventsModule",
  "SaveBuildModule",
  "FilesystemEventsModule",
  "ConfigurationEventsModule"
] as const;

function run(): void {
  const source = fs.readFileSync(EXTENSION_PATH, "utf8");
  const registerRegex = /pipelineModuleHost\.register\(new\s+([A-Za-z0-9_]+)\s*\(/g;
  const registered: string[] = [];
  for (const match of source.matchAll(registerRegex)) {
    const name = match[1] ?? "";
    if (name) {
      registered.push(name);
    }
  }

  for (const moduleName of REQUIRED_MODULES_IN_ORDER) {
    const count = registered.filter((item) => item === moduleName).length;
    assert.equal(count, 1, `Pipeline module '${moduleName}' must be registered exactly once (found ${count}).`);
  }

  const positions = REQUIRED_MODULES_IN_ORDER.map((moduleName) => registered.indexOf(moduleName));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i - 1] < positions[i],
      `Pipeline module order violation: '${REQUIRED_MODULES_IN_ORDER[i - 1]}' must be before '${REQUIRED_MODULES_IN_ORDER[i]}'.`
    );
  }

  assert.ok(
    registered.length >= REQUIRED_MODULES_IN_ORDER.length,
    `Expected at least ${REQUIRED_MODULES_IN_ORDER.length} pipeline module registrations, found ${registered.length}.`
  );

  console.log("Pipeline module registration contract tests passed.");
}

run();

