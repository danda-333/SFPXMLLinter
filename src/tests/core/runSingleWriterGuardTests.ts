import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const MUTATION_PATTERNS: ReadonlyArray<{ key: string; regex: RegExp }> = [
  { key: "modelCore.upsertNode(", regex: /\bmodelCore\.upsertNode\(/ },
  { key: "modelCore.removeNode(", regex: /\bmodelCore\.removeNode\(/ },
  { key: "factRegistry.invalidateNode(", regex: /\bfactRegistry\.invalidateNode\(/ },
  { key: "symbolRegistry.refreshNode(", regex: /\bsymbolRegistry\.refreshNode\(/ },
  { key: "factRegistry.register(", regex: /\bfactRegistry\.register\(/ },
  { key: "symbolRegistry.registerResolver(", regex: /\bsymbolRegistry\.registerResolver\(/ }
];

const ALLOWLIST = new Set<string>([
  normalize("src/core/model/modelWriteGateway.ts"),
  normalize("src/core/facts/registerDefaultFactsAndSymbols.ts")
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
    for (const pattern of MUTATION_PATTERNS) {
      if (!pattern.regex.test(content)) {
        continue;
      }
      if (ALLOWLIST.has(rel)) {
        continue;
      }
      violations.push(`${rel}: forbidden single-writer mutation '${pattern.key}'`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Single-writer guard failed (${violations.length} violation(s)).\n` +
        violations.map((item) => ` - ${item}`).join("\n")
    );
  }

  console.log("\u001b[32mSingle writer guard tests passed.\u001b[0m");
}

run();
