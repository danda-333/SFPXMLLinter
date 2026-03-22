import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, "package.json");

const CONTRACT_GUARD_TESTS = [
  "runSingleWriterGuardTests",
  "runSingleSourceGuardTests",
  "runCommandContractTests",
  "runValidationRuleMatrixContractTests",
  "runValidationModuleFactContractTests",
  "runValidationModuleSymbolContractTests",
  "runValidationModuleRuleCoverageContractTests",
  "runProviderAccessContractTests",
  "runOrchestrationEntryContractTests",
  "runCommandHandlerOrchestrationContractTests",
  "runPipelineModuleRegistrationContractTests",
  "runDiagnosticsPublisherContractTests",
  "runCompositionDataSourceContractTests",
  "runValidationDataAccessContractTests",
  "runExtensionBoundaryContractTests",
  "runWorkspaceScanBoundaryContractTests",
  "runFallbackParseBoundaryContractTests",
  "runConsumerNoFallbackHeuristicsContractTests",
  "runFactsAndSymbolsWiringCoverageContractTests"
] as const;

type PackageJsonLike = {
  scripts?: Record<string, string>;
};

function run(): void {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageJsonLike;
  const compositionScript = pkg.scripts?.["test:composition"] ?? "";
  assert.ok(compositionScript.length > 0, "package.json scripts.test:composition must exist.");

  const missingInScript: string[] = [];
  const missingFiles: string[] = [];

  for (const testName of CONTRACT_GUARD_TESTS) {
    const srcPath = path.join(PROJECT_ROOT, "src/tests/core", `${testName}.ts`);
    if (!fs.existsSync(srcPath)) {
      missingFiles.push(`src/tests/core/${testName}.ts`);
    }

    const outToken = `out/tests/core/${testName}.js`;
    if (!compositionScript.includes(outToken)) {
      missingInScript.push(outToken);
    }
  }

  assert.equal(
    missingFiles.length,
    0,
    `Contract guard snapshot failed: missing test files:\n${missingFiles.map((item) => ` - ${item}`).join("\n")}`
  );

  assert.equal(
    missingInScript.length,
    0,
    `Contract guard snapshot failed: tests not wired in scripts.test:composition:\n${missingInScript
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mContract guards snapshot tests passed.\x1b[0m");
  console.log(
    `\x1b[32mContract guards tracked: ${CONTRACT_GUARD_TESTS.length} (${CONTRACT_GUARD_TESTS.join(", ")})\x1b[0m`
  );
}

run();
