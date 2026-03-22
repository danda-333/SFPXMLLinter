import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../../..");

type Rule = {
  key: string;
  regex: RegExp;
};

const bannedPatterns: Rule[] = [
  { key: "fallback parse mode", regex: /\bfallback-parse\b/ },
  { key: "direct parseDocumentFacts call", regex: /\bparseDocumentFacts\s*\(/ }
];

const auditedRoots = [
  path.resolve(workspaceRoot, "src/composition"),
  path.resolve(workspaceRoot, "src/providers")
];

function run(): void {
  const violations: string[] = [];

  for (const root of auditedRoots) {
    for (const filePath of collectTsFiles(root)) {
      const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
      const source = fs.readFileSync(filePath, "utf8");
      for (const rule of bannedPatterns) {
        if (rule.regex.test(source)) {
          violations.push(`${rel}: contains banned token '${rule.key}'.`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Consumer fallback-heuristics contract violated:\n${violations.join("\n")}`);
  console.log("\x1b[32mConsumer no-fallback heuristics contract tests passed.\x1b[0m");
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
