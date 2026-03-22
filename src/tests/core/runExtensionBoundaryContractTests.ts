import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const EXTENSION_PATH = path.join(PROJECT_ROOT, "src/extension.ts");

function extractFunctionBody(source: string, functionName: string): string {
  const fnStart = source.indexOf(`function ${functionName}(`);
  if (fnStart < 0) {
    throw new Error(`Function '${functionName}' not found in extension.ts`);
  }
  const paramsStart = source.indexOf("(", fnStart);
  if (paramsStart < 0) {
    throw new Error(`Function '${functionName}' params start not found`);
  }
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      parenDepth++;
      continue;
    }
    if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd < 0) {
    throw new Error(`Function '${functionName}' params end not found`);
  }
  const braceStart = source.indexOf("{", paramsEnd);
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
  const source = fs.readFileSync(EXTENSION_PATH, "utf8");

  const forbiddenGlobalPatterns: ReadonlyArray<{ key: string; regex: RegExp }> = [
    { key: "modelCore.upsertNode(", regex: /\bmodelCore\.upsertNode\(/ },
    { key: "modelCore.removeNode(", regex: /\bmodelCore\.removeNode\(/ },
    { key: "factRegistry.invalidateNode(", regex: /\bfactRegistry\.invalidateNode\(/ },
    { key: "factRegistry.register(", regex: /\bfactRegistry\.register\(/ },
    { key: "symbolRegistry.refreshNode(", regex: /\bsymbolRegistry\.refreshNode\(/ },
    { key: "symbolRegistry.registerResolver(", regex: /\bsymbolRegistry\.registerResolver\(/ }
  ];

  for (const pattern of forbiddenGlobalPatterns) {
    assert.ok(
      !pattern.regex.test(source),
      `extension.ts boundary violation: forbidden direct mutation call '${pattern.key}'.`
    );
  }

  assert.ok(
    /\bmodelWriteGateway\.upsertNode\(/.test(source),
    "extension.ts must write model nodes via modelWriteGateway.upsertNode(...)."
  );
  assert.ok(
    /\bmodelWriteGateway\.removeNode\(/.test(source),
    "extension.ts must remove model nodes via modelWriteGateway.removeNode(...)."
  );

  const saveBody = extractFunctionBody(source, "handleSaveDocument");
  const createdBody = extractFunctionBody(source, "handleFilesCreated");
  const deletedBody = extractFunctionBody(source, "handleFilesDeleted");
  const renamedBody = extractFunctionBody(source, "handleFilesRenamed");

  assert.ok(
    /\bupdateOrchestrator\.handleDocumentSave\(/.test(saveBody),
    "handleSaveDocument must route save handling through updateOrchestrator.handleDocumentSave(...)."
  );
  assert.ok(
    /\bupdateOrchestrator\.handleFilesCreated\(/.test(createdBody),
    "handleFilesCreated must route through updateOrchestrator.handleFilesCreated(...)."
  );
  assert.ok(
    /\bupdateOrchestrator\.handleFilesDeleted\(/.test(deletedBody),
    "handleFilesDeleted must route through updateOrchestrator.handleFilesDeleted(...)."
  );
  assert.ok(
    /\bupdateOrchestrator\.handleFilesRenamed\(/.test(renamedBody),
    "handleFilesRenamed must route through updateOrchestrator.handleFilesRenamed(...)."
  );

  const forbiddenDirectBuildCallsInHandlers: ReadonlyArray<{ key: string; regex: RegExp }> = [
    { key: "buildService.run(", regex: /\bbuildService\.run\(/ },
    { key: "buildService.runForPath(", regex: /\bbuildService\.runForPath\(/ },
    { key: "templateBuildOrchestrator.queueBuild(", regex: /\btemplateBuildOrchestrator\.queueBuild\(/ },
    { key: "templateBuildOrchestrator.queueBuildBatch(", regex: /\btemplateBuildOrchestrator\.queueBuildBatch\(/ }
  ];

  for (const handler of [
    { name: "handleSaveDocument", body: saveBody },
    { name: "handleFilesCreated", body: createdBody },
    { name: "handleFilesDeleted", body: deletedBody },
    { name: "handleFilesRenamed", body: renamedBody }
  ]) {
    for (const pattern of forbiddenDirectBuildCallsInHandlers) {
      assert.ok(
        !pattern.regex.test(handler.body),
        `${handler.name} must not call '${pattern.key}' directly.`
      );
    }
  }

  console.log("\x1b[32mExtension boundary contract tests passed.\x1b[0m");
}

run();
