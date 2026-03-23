import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const FALLBACK_PARSE_ALLOWLIST = new Set<string>([
  "src/core/model/factsResolution.ts",
  "src/core/validation/documentValidationService.ts"
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
    const hasFallbackParseToken = source.includes("fallback-parse");
    if (hasFallbackParseToken && !FALLBACK_PARSE_ALLOWLIST.has(rel)) {
      violations.push(`${rel}: fallback-parse token is not allowed outside explicit boundary.`);
    }
  }

  const validationServicePath = path.join(PROJECT_ROOT, "src/core/validation/documentValidationService.ts");
  const validationServiceSource = fs.readFileSync(validationServicePath, "utf8");
  const fallbackModeMatches = validationServiceSource.match(/"fallback-parse"/g) ?? [];
  assert.equal(
    fallbackModeMatches.length,
    2,
    "documentValidationService.ts must keep exactly two fallback-parse mentions (type boundary + standalone usage)."
  );
  assert.ok(
    /resolveFactsFromDocument\(document,\s*this\.deps\.emptyIndex,\s*"fallback-parse"\)/.test(validationServiceSource),
    "documentValidationService.ts must use fallback-parse only for standalone (non-indexed) validation path."
  );

  assert.equal(
    violations.length,
    0,
    `Fallback-parse boundary contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mFallback-parse boundary contract tests passed.\x1b[0m");
}

run();

