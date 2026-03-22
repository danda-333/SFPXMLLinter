import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(PROJECT_ROOT, "src");
const EXTENSION_PATH = path.join(SRC_ROOT, "extension.ts");

interface PatternRule {
  key: string;
  regex: RegExp;
  allowlist: Set<string>;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

const PATTERN_RULES: ReadonlyArray<PatternRule> = [
  {
    key: "documentValidationService.validateDocument(...)",
    regex: /\bdocumentValidationService\.validateDocument\(/,
    allowlist: new Set([
      normalize("src/extension.ts"),
      normalize("src/core/validation/documentValidationService.ts")
    ])
  },
  {
    key: "buildService.run(...)",
    regex: /\bbuildService\.run\(/,
    allowlist: new Set([
      normalize("src/extension.ts"),
      normalize("src/core/template/manualTemplateBuildCommandsService.ts")
    ])
  },
  {
    key: "buildService.runForPath(...)",
    regex: /\bbuildService\.runForPath\(/,
    allowlist: new Set([
      normalize("src/extension.ts"),
      normalize("src/core/template/manualTemplateBuildCommandsService.ts")
    ])
  },
  {
    key: "templateBuildOrchestrator.queueBuild(...)",
    regex: /\btemplateBuildOrchestrator\.queueBuild\(/,
    allowlist: new Set([normalize("src/extension.ts")])
  },
  {
    key: "templateBuildOrchestrator.queueBuildBatch(...)",
    regex: /\btemplateBuildOrchestrator\.queueBuildBatch\(/,
    allowlist: new Set([normalize("src/extension.ts")])
  }
];

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

function extractFunctionBody(source: string, functionName: string): string {
  const fnStart = source.indexOf(`function ${functionName}(`);
  if (fnStart < 0) {
    throw new Error(`Function '${functionName}' not found in extension.ts`);
  }
  const braceStart = source.indexOf("{", fnStart);
  if (braceStart < 0) {
    throw new Error(`Function '${functionName}' body start not found`);
  }
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  throw new Error(`Function '${functionName}' body end not found`);
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
    for (const rule of PATTERN_RULES) {
      if (!rule.regex.test(content)) {
        continue;
      }
      if (rule.allowlist.has(rel)) {
        continue;
      }
      violations.push(`${rel}: forbidden orchestration call '${rule.key}'`);
    }
  }

  const extensionSource = fs.readFileSync(EXTENSION_PATH, "utf8");
  const saveBody = extractFunctionBody(extensionSource, "handleSaveDocument");
  const textChangedBody = extractFunctionBody(extensionSource, "handleTextChangedDiagnostics");
  const openDiagBody = extractFunctionBody(extensionSource, "handleOpenDocumentDiagnostics");

  assert.ok(
    /\bupdateOrchestrator\.handleDocumentSave\(/.test(saveBody),
    "handleSaveDocument must route save updates through updateOrchestrator.handleDocumentSave(...)."
  );
  assert.ok(
    !/\bbuildService\.run\(/.test(saveBody) &&
      !/\bbuildService\.runForPath\(/.test(saveBody) &&
      !/\btemplateBuildOrchestrator\.queueBuild/.test(saveBody),
    "handleSaveDocument must not run template builds directly."
  );

  assert.ok(
    !/\bbuildService\.run\(/.test(textChangedBody) &&
      !/\bbuildService\.runForPath\(/.test(textChangedBody) &&
      !/\btemplateBuildOrchestrator\.queueBuild/.test(textChangedBody),
    "handleTextChangedDiagnostics must not invoke template build directly."
  );

  assert.ok(
    !/\bbuildService\.run\(/.test(openDiagBody) &&
      !/\bbuildService\.runForPath\(/.test(openDiagBody) &&
      !/\btemplateBuildOrchestrator\.queueBuild/.test(openDiagBody),
    "handleOpenDocumentDiagnostics must not invoke template build directly."
  );

  assert.equal(
    violations.length,
    0,
    `Orchestration entry contract failed (${violations.length} violation(s)).\n${violations
      .map((item) => ` - ${item}`)
      .join("\n")}`
  );

  console.log("\x1b[32mOrchestration entry contract tests passed.\x1b[0m");
}

run();
