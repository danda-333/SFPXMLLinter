import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const COMPOSITION_ROOT = path.join(PROJECT_ROOT, "src/composition");
const TREE_VIEW_FILE = path.join(COMPOSITION_ROOT, "treeView.ts");

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
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
  walk(COMPOSITION_ROOT, files);
  const violations: string[] = [];

  const forbiddenImportPatterns: ReadonlyArray<{ key: string; regex: RegExp }> = [
    { key: "workspace indexer import", regex: /from\s+["'][^"']*indexer\/workspaceIndexer["']/ },
    { key: "diagnostics engine import", regex: /from\s+["'][^"']*diagnostics\/engine["']/ },
    { key: "extension import", regex: /from\s+["'][^"']*extension["']/ },
    { key: "orchestrator import", regex: /from\s+["'][^"']*orchestrator\// },
    { key: "template build orchestrator import", regex: /from\s+["'][^"']*templateBuildOrchestrator["']/ }
  ];

  const forbiddenMapAccessPatterns: ReadonlyArray<{ key: string; regex: RegExp }> = [
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

    for (const pattern of forbiddenMapAccessPatterns) {
      if (pattern.regex.test(source)) {
        violations.push(`${rel}: forbidden ${pattern.key}`);
      }
    }
  }

  const treeViewSource = fs.readFileSync(TREE_VIEW_FILE, "utf8");
  assert.ok(
    /from\s+"\.\/treeProjectionAdapter"/.test(treeViewSource) && /\bbuildCompositionProjection(?:<[^>]+>)?\s*\(/.test(treeViewSource),
    "treeView.ts must build nodes via treeProjectionAdapter.buildCompositionProjection(...)."
  );
  assert.ok(
    /from\s+"\.\.\/core\/model\/indexAccess"/.test(treeViewSource),
    "treeView.ts must use shared index access helpers from ../core/model/indexAccess."
  );
  assert.ok(
    /ComposedDocumentSnapshotRegistry/.test(treeViewSource),
    "treeView.ts must use composed snapshot registry as primary facts source."
  );

  assert.equal(
    violations.length,
    0,
    `Composition datasource contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mComposition datasource contract tests passed.\x1b[0m");
}

run();
