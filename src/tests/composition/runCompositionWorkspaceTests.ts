import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { FeatureRegistryStore } from "../../composition/registry";
import { discoverFeatureManifestFiles, loadFeatureManifestRegistry } from "../../composition/workspace";

function run(): void {
  const fixtureRoot = path.resolve(__dirname, "../../../tests/fixtures/composition");
  const files = discoverFeatureManifestFiles(fixtureRoot);
  assert.equal(files.length, 0);

  const registry = loadFeatureManifestRegistry(fixtureRoot);
  assert.equal(registry.manifestsByFeature.size, 1);
  assert.equal(registry.manifestsBySource.size, 1);
  assert.equal(registry.capabilityReportsByFeature.size, 1);
  assert.equal(registry.effectiveModelsByFeature.size, 1);
  assert.equal(registry.issues.length, 0);

  const assign = registry.manifestsByFeature.get("Assign");
  assert.ok(assign);
  assert.equal(assign?.source, "auto:Assign");
  assert.equal(assign?.parts.length, 5);
  assert.equal(assign?.entrypoint, "Common/Features/Assign/Assign.feature.xml");
  const entrypointFile = path.join(fixtureRoot, assign?.entrypoint?.replace(/\//g, path.sep) ?? "");
  assert.equal(fs.existsSync(entrypointFile), true, `Expected entrypoint fixture to exist: ${assign?.entrypoint}`);
  for (const part of assign?.parts ?? []) {
    const partFile = path.join(fixtureRoot, part.file.replace(/\//g, path.sep));
    assert.equal(fs.existsSync(partFile), true, `Expected part fixture to exist: ${part.file}`);
  }

  const report = registry.capabilityReportsByFeature.get("Assign");
  assert.ok(report);
  assert.equal(report?.provides.length, 0);
  assert.equal(report?.requires.length, 0);
  const formPart = assign?.parts.find((part) => part.file.endsWith("Assign.Form.feature.xml"));
  assert.ok(formPart);
  const formControlsContribution = formPart?.contributions.find((item) => item.name === "Controls");
  assert.ok(formControlsContribution);
  assert.ok(
    formControlsContribution?.expectsXPath.some(
      (item) => item === "//Form/Controls/Control[@Ident='ITSMCompanyIdent']"
    )
  );
  const workflowPart = assign?.parts.find((part) => part.file.endsWith("Assign.WorkFlow.feature.xml"));
  assert.ok(workflowPart);
  const actionShareCodesContribution = workflowPart?.contributions.find((item) => item.name === "ActionShareCodes");
  assert.ok(actionShareCodesContribution);
  assert.equal(actionShareCodesContribution?.kind, "provide");
  assert.ok(
    actionShareCodesContribution?.expectsXPath.some(
      (item) => item === "//Form/Controls/Control[@Ident='DialogAssignedGroupID']"
    )
  );
  const effectiveModel = registry.effectiveModelsByFeature.get("Assign");
  assert.ok(effectiveModel);
  assert.equal(effectiveModel?.items.length, 0);
  assert.ok(effectiveModel?.conflicts.some((conflict) => conflict.code === "missing-expected-xpath"));
  assert.ok(
    effectiveModel?.contributions.some(
      (contribution) => contribution.name === "Buttons" && contribution.usage === "effective"
    )
  );
  assert.ok(
    effectiveModel?.contributions.some(
      (contribution) => contribution.name === "Controls" && contribution.usage === "partial"
    )
  );
  assert.ok(
    effectiveModel?.contributions.some(
      (contribution) => contribution.name === "ActionShareCodes" && contribution.usage === "partial"
    )
  );

  const store = new FeatureRegistryStore();
  const rebuilt = store.rebuild(fixtureRoot);
  assert.equal(rebuilt.manifestsByFeature.size, 1);
  assert.equal(store.getManifest("Assign")?.feature, "Assign");
  assert.equal(store.getCapabilityReport("Assign")?.feature, "Assign");
  assert.equal(store.getEffectiveModel("Assign")?.activeFeatures[0], "Assign");
  assert.equal(store.getIssues().length, 0);

  console.log("Composition workspace tests passed.");
}

run();
