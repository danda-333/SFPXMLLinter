import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const FIND_FILES_ALLOWLIST = new Set<string>([
  "src/utils/paths.ts",
  "src/indexer/workspaceIndexer.ts",
  "src/template/buildXmlTemplatesService.ts",
  "src/core/template/legacyTemplateAliasMigrationCommandsService.ts"
]);

const GLOB_CONFIGURED_ALLOWLIST = new Set<string>([
  "src/utils/paths.ts",
  "src/indexer/workspaceIndexer.ts",
  "src/extension.ts"
]);

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
  walk(SRC_ROOT, files);
  const violations: string[] = [];

  for (const file of files) {
    const rel = normalize(path.relative(PROJECT_ROOT, file));
    if (rel.includes("/tests/")) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");

    const hasWorkspaceFindFiles = /\bvscode\.workspace\.findFiles\(/.test(source);
    if (hasWorkspaceFindFiles && !FIND_FILES_ALLOWLIST.has(rel)) {
      violations.push(`${rel}: direct vscode.workspace.findFiles(...) is outside scan boundary allowlist.`);
    }

    const sourceWithoutDepsGlob = source.replace(/\bthis\.deps\.globConfiguredXmlFiles\(/g, "");
    const hasDirectGlobConfigured = /\bglobConfiguredXmlFiles\(/.test(sourceWithoutDepsGlob);
    if (hasDirectGlobConfigured && !GLOB_CONFIGURED_ALLOWLIST.has(rel)) {
      violations.push(`${rel}: direct globConfiguredXmlFiles(...) is outside scan boundary allowlist.`);
    }
  }

  assert.equal(
    violations.length,
    0,
    `Workspace scan boundary contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mWorkspace scan boundary contract tests passed.\x1b[0m");
}

run();
