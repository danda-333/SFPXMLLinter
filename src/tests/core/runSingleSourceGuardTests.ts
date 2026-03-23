import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const DIRECT_PATTERNS: ReadonlyArray<{ key: string; regex: RegExp }> = [
  { key: "parsedFactsByUri.get(", regex: /\bparsedFactsByUri\.get\(/ },
  { key: "formsByIdent.get(", regex: /\bformsByIdent\.get\(/ },
  { key: "parsedFactsByUri.entries(", regex: /\bparsedFactsByUri\.entries\(/ },
  { key: "formsByIdent.values(", regex: /\bformsByIdent\.values\(/ },
  { key: "formsByIdent.has(", regex: /\bformsByIdent\.has\(/ },
  { key: "formsByIdent.size", regex: /\bformsByIdent\.size\b/ },
  { key: "componentsByKey.get(", regex: /\bcomponentsByKey\.get\(/ },
  { key: "componentsByKey.values(", regex: /\bcomponentsByKey\.values\(/ },
  { key: "componentsByKey.keys(", regex: /\bcomponentsByKey\.keys\(/ },
  { key: "componentsByKey.size", regex: /\bcomponentsByKey\.size\b/ },
  { key: "componentKeysByBaseName.get(", regex: /\bcomponentKeysByBaseName\.get\(/ },
  { key: "parseDocumentFacts(...)", regex: /\bparseDocumentFacts\(\s*[a-zA-Z_$][\w$]*\s*\)/ },
  { key: "mode: \"fallback-parse\"", regex: /\bmode\s*:\s*"fallback-parse"/ },
  { key: "\"index-fallback\"", regex: /"index-fallback"/ }
];

const ALLOWLIST = new Set<string>([
  normalize("src/core/model/indexAccess.ts"),
  normalize("src/core/validation/documentValidationService.ts"),
  normalize("src/indexer/componentResolve.ts"),
  normalize("src/indexer/workspaceIndexer.ts")
]);

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function walk(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }
    out.push(fullPath);
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
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of DIRECT_PATTERNS) {
      if (!pattern.regex.test(content)) {
        continue;
      }
      if (ALLOWLIST.has(rel)) {
        continue;
      }
      violations.push(`${rel}: forbidden direct access '${pattern.key}'`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Single-source guard failed (${violations.length} violation(s)).\n` +
        violations.map((item) => ` - ${item}`).join("\n")
    );
  }

  console.log("\u001b[32mSingle source guard tests passed.\u001b[0m");
}

run();
