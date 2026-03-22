import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const ALLOWLIST_DIAGNOSTICS_MUTATIONS = new Set<string>([
  "src/core/validation/diagnosticsPublisherService.ts"
]);

const ALLOWLIST_CREATE_COLLECTION = new Set<string>([
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

    const mutatesDiagnosticsCollection =
      /\bdiagnostics\.(set|delete|clear)\(/.test(source) ||
      /\bDiagnosticCollection\b/.test(source) && /\.(set|delete|clear)\(/.test(source);

    if (mutatesDiagnosticsCollection && !ALLOWLIST_DIAGNOSTICS_MUTATIONS.has(rel)) {
      violations.push(`${rel}: direct DiagnosticCollection mutation detected (use DiagnosticsPublisherService).`);
    }

    const createsCollection = /\bvscode\.languages\.createDiagnosticCollection\(/.test(source);
    if (createsCollection && !ALLOWLIST_CREATE_COLLECTION.has(rel)) {
      violations.push(`${rel}: createDiagnosticCollection(...) is allowed only in extension.ts.`);
    }
  }

  assert.equal(
    violations.length,
    0,
    `Diagnostics publisher contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mDiagnostics publisher contract tests passed.\x1b[0m");
}

run();

