import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "../../..");
const registrationPath = path.join(projectRoot, "src/core/facts/registerDefaultFactsAndSymbols.ts");

function run(): void {
  const registrationSource = fs.readFileSync(registrationPath, "utf8");
  const factKinds = extractQuotedKinds(registrationSource, /kind:\s*"fact\.[^"]+"/g);
  const symbolKinds = extractQuotedKinds(registrationSource, /kind:\s*"(?:control|button|section|controlShareCode|actionShareCode|buttonShareCode)"/g);

  const searchFiles = collectTsFiles(path.join(projectRoot, "src"))
    .filter((file) => path.resolve(file) !== path.resolve(registrationPath));
  const corpus = searchFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

  const uncoveredFacts = factKinds.filter((kind) => !corpus.includes(kind));
  const uncoveredSymbols = symbolKinds.filter((kind) => !corpus.includes(kind));

  assert.deepEqual(
    uncoveredFacts,
    [],
    `Facts wiring coverage contract failed; registered fact kinds have no runtime/test references outside registration file:\n${uncoveredFacts.join("\n")}`
  );
  assert.deepEqual(
    uncoveredSymbols,
    [],
    `Symbols wiring coverage contract failed; registered symbol kinds have no runtime/test references outside registration file:\n${uncoveredSymbols.join("\n")}`
  );
  console.log("\x1b[32mFacts/symbols wiring coverage contract tests passed.\x1b[0m");
}

function extractQuotedKinds(source: string, pattern: RegExp): string[] {
  const out = new Set<string>();
  const matches = source.match(pattern) ?? [];
  for (const match of matches) {
    const quoted = match.match(/"([^"]+)"/);
    if (!quoted?.[1]) {
      continue;
    }
    out.add(quoted[1]);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function collectTsFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && full.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

run();
