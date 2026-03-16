import { strict as assert } from "node:assert";
import * as path from "node:path";
import { loadFeatureManifestRegistry } from "../../composition/workspace";

function run(): void {
  const fixtureRoot = path.resolve(__dirname, "../../../tests/fixtures/composition-ordering");
  const registry = loadFeatureManifestRegistry(fixtureRoot);

  const model = registry.effectiveModelsByFeature.get("OrderMix");
  assert.ok(model, "Expected OrderMix effective model.");
  const orderingConflicts = model?.conflicts.filter((item) => item.code === "ordering-conflict") ?? [];
  assert.equal(orderingConflicts.length, 0, `Expected no ordering conflicts, got: ${orderingConflicts.map((item) => item.message).join(" | ")}`);
  assert.ok(
    registry.manifestsByFeature.get("OrderMix")?.parts.some((part) => part.ordering?.group === "form-buttons"),
    "Expected form ordering group."
  );
  assert.ok(
    registry.manifestsByFeature.get("OrderMix")?.parts.some((part) => part.ordering?.group === "workflow-actions"),
    "Expected workflow ordering group."
  );

  console.log("Composition ordering fixture tests passed.");
}

run();
