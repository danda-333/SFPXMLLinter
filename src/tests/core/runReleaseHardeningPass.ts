import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type HardeningStep = {
  id: string;
  command: string;
};

type StepResult = {
  id: string;
  ok: boolean;
  elapsedMs: number;
  exitCode: number | null;
};

const STEPS: HardeningStep[] = [
  { id: "contracts", command: "npm run -s test:contracts" },
  { id: "hardening-e2e", command: "npm run -s test:hardening" },
  { id: "linter-perf", command: "npm run -s test:linter:perf" },
  { id: "template-perf", command: "npm run -s test:templates:perf" }
];

function run(): void {
  const projectRoot = resolveProjectRoot();
  const startedAt = Date.now();
  const results: StepResult[] = [];

  for (const step of STEPS) {
    const stepStart = Date.now();
    console.log(`\x1b[36m[release-hardening] START ${step.id}\x1b[0m`);
    const child = spawnSync(step.command, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: true
    });
    const elapsedMs = Date.now() - stepStart;
    const ok = (child.status ?? 1) === 0;
    results.push({
      id: step.id,
      ok,
      elapsedMs,
      exitCode: child.status
    });
    console.log(
      `${ok ? "\x1b[32m" : "\x1b[31m"}[release-hardening] ${ok ? "PASS" : "FAIL"} ${step.id} (${elapsedMs} ms, exit=${child.status ?? -1})\x1b[0m`
    );
    if (!ok) {
      break;
    }
  }

  const totalMs = Date.now() - startedAt;
  const passed = results.filter((item) => item.ok).length;
  const failed = results.length - passed;

  console.log("\n[release-hardening] Summary:");
  for (const result of results) {
    console.log(
      ` - ${result.id}: ${result.ok ? "PASS" : "FAIL"} (${result.elapsedMs} ms, exit=${result.exitCode ?? -1})`
    );
  }
  console.log(`[release-hardening] total=${totalMs} ms, passed=${passed}, failed=${failed}`);

  assert.equal(
    failed,
    0,
    `Release hardening pass failed: ${results.filter((item) => !item.ok).map((item) => item.id).join(", ")}`
  );
  console.log("\x1b[32mRelease hardening pass completed successfully.\x1b[0m");
}

function resolveProjectRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../..")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return process.cwd();
}

run();
