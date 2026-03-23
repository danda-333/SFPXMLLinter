import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

interface ProviderContract {
  file: string;
  requireFactsResolutionImport: boolean;
  requireStrictAccessorMode: boolean;
  requireIndexAccessImport: boolean;
}

const PROVIDER_CONTRACTS: ProviderContract[] = [
  {
    file: "src/providers/completionProvider.ts",
    requireFactsResolutionImport: true,
    requireStrictAccessorMode: true,
    requireIndexAccessImport: true
  },
  {
    file: "src/providers/definitionProvider.ts",
    requireFactsResolutionImport: true,
    requireStrictAccessorMode: true,
    requireIndexAccessImport: true
  },
  {
    file: "src/providers/referencesProvider.ts",
    requireFactsResolutionImport: true,
    requireStrictAccessorMode: true,
    requireIndexAccessImport: true
  },
  {
    file: "src/providers/renameProvider.ts",
    requireFactsResolutionImport: true,
    requireStrictAccessorMode: true,
    requireIndexAccessImport: true
  },
  {
    file: "src/providers/referenceModelUtils.ts",
    requireFactsResolutionImport: false,
    requireStrictAccessorMode: false,
    requireIndexAccessImport: true
  }
];

const FORBIDDEN_PATTERNS: ReadonlyArray<{ key: string; regex: RegExp }> = [
  { key: "fallback parse mode", regex: /\bmode\s*:\s*"fallback-parse"/ },
  { key: "index fallback mode", regex: /"index-fallback"/ },
  { key: "direct formsByIdent map access", regex: /\bformsByIdent\.(get|set|has|entries|values|keys)\(/ },
  { key: "direct parsedFactsByUri map access", regex: /\bparsedFactsByUri\.(get|set|has|entries|values|keys)\(/ },
  { key: "direct componentsByKey map access", regex: /\bcomponentsByKey\.(get|set|has|entries|values|keys)\(/ }
];

function run(): void {
  const violations: string[] = [];

  for (const contract of PROVIDER_CONTRACTS) {
    const absPath = path.join(PROJECT_ROOT, contract.file);
    const content = fs.readFileSync(absPath, "utf8");

    if (contract.requireFactsResolutionImport) {
      if (!/from\s+"..\/core\/model\/factsResolution"/.test(content)) {
        violations.push(`${contract.file}: missing import from ../core/model/factsResolution`);
      }
      if (!/\bresolveDocumentFacts\s*\(/.test(content)) {
        violations.push(`${contract.file}: missing resolveDocumentFacts(...) call`);
      }
    }

    if (contract.requireStrictAccessorMode) {
      if (!/\bmode\s*:\s*"strict-accessor"/.test(content)) {
        violations.push(`${contract.file}: missing mode: "strict-accessor" in facts resolution call`);
      }
    }

    if (contract.requireIndexAccessImport) {
      if (!/from\s+"..\/core\/model\/indexAccess"/.test(content)) {
        violations.push(`${contract.file}: missing import from ../core/model/indexAccess`);
      }
    }

    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (forbidden.regex.test(content)) {
        violations.push(`${contract.file}: forbidden ${forbidden.key}`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Provider access contract failed (${violations.length} violation(s)).\n${violations.map((item) => ` - ${item}`).join("\n")}`
  );

  console.log("\x1b[32mProvider access contract tests passed.\x1b[0m");
}

run();
