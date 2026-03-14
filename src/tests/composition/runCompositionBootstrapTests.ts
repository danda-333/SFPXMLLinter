import { strict as assert } from "node:assert";
import * as path from "node:path";
import { buildBootstrapManifestDraft } from "../../composition/bootstrapManifest";

function run(): void {
  const rootDir = path.resolve(__dirname, "../../../tests/fixtures/composition");
  const activeFile = path.resolve(
    rootDir,
    "Common/Features/Assign/Assign.Form.feature.xml"
  );

  const draft = buildBootstrapManifestDraft(rootDir, activeFile);
  assert.ok(draft, "expected bootstrap manifest draft");
  assert.equal(draft?.feature, "Assign");
  assert.ok(draft?.manifestPath.endsWith(path.join("Common", "Features", "Assign", "Assign.feature.json")));
  assert.ok((draft?.manifestText ?? "").includes("\"feature\": \"Assign\""));
  assert.ok((draft?.manifestText ?? "").includes("\"parts\""));
  assert.ok((draft?.sourceFiles ?? []).some((item) => item.endsWith("Assign.Form.feature.xml")));

  const missing = buildBootstrapManifestDraft(rootDir, path.resolve(rootDir, "not-found.feature.xml"));
  assert.equal(missing, undefined);

  console.log("Composition bootstrap tests passed.");
}

run();
