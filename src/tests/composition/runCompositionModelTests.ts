import { strict as assert } from "node:assert";
import { buildEffectiveCompositionModel, matchesExpectedXPathInEffectiveModel } from "../../composition/effectiveModel";
import { buildFeatureCapabilityReport, normalizeFeatureManifest, parseFeatureManifestText } from "../../composition/manifest";
import { emptyFeatureManifestRegistry } from "../../composition/workspace";

function run(): void {
  const manifest = normalizeFeatureManifest(
    {
      feature: "Assign",
      description: "Assign feature",
      tags: ["itsm", "assign", "itsm"],
      parts: [
        {
          file: "Assign.Form.feature.xml",
          provides: ["control:AssignedGroupID"]
        },
        {
          file: "Assign.WorkFlow.feature.xml",
          provides: ["actionShareCode:AssignAction", "buttonShareCode:AssignButton", "buttonShareCode:AssignButton"],
          expects: ["control:AssignedGroupID"],
          contributions: [
            {
              name: "ActionShareCodes",
              kind: "provide",
              summary: "Adds workflow action share codes.",
              expectsXPath: ["//Form/Controls/Control[@Ident='AssignedGroupID']"],
              provides: ["actionShareCode:AssignAction"],
              requires: ["feature:FolderGroupSegment"]
            }
          ],
          ordering: {
            group: "workflow-actions",
            before: ["ResolveAction"],
            after: ["PrepareAction"]
          }
        }
      ],
      requires: ["feature:FolderGroupSegment", "feature:FolderGroupSegment"],
      expects: ["control:AssignedGroupID", { kind: "button", ident: "AssignButton" }]
    },
    "Assign.feature.json"
  );

  assert.equal(manifest.version, 1);
  assert.equal(manifest.feature, "Assign");
  assert.deepEqual(manifest.tags, ["itsm", "assign"]);
  assert.equal(manifest.parts.length, 2);
  assert.equal(manifest.parts[0]?.id, "Assign.Form");
  assert.deepEqual(manifest.parts[0]?.appliesTo, ["form"]);
  assert.deepEqual(manifest.parts[1]?.appliesTo, ["workflow"]);
  assert.equal(manifest.parts[1]?.provides.length, 2);
  assert.equal(manifest.parts[1]?.contributions.length, 1);
  assert.equal(manifest.parts[1]?.contributions[0]?.kind, "provide");
  assert.deepEqual(manifest.parts[1]?.contributions[0]?.expectsXPath, ["//Form/Controls/Control[@Ident='AssignedGroupID']"]);
  assert.deepEqual(manifest.parts[1]?.contributions[0]?.requires, [{ kind: "feature", ident: "FolderGroupSegment" }]);
  assert.deepEqual(manifest.requires, [{ kind: "feature", ident: "FolderGroupSegment" }]);

  const report = buildFeatureCapabilityReport(manifest);
  assert.equal(report.feature, "Assign");
  assert.deepEqual(report.provides, [
    { kind: "control", ident: "AssignedGroupID" },
    { kind: "actionShareCode", ident: "AssignAction" },
    { kind: "buttonShareCode", ident: "AssignButton" }
  ]);
  assert.deepEqual(report.expects, [
    { kind: "control", ident: "AssignedGroupID" },
    { kind: "button", ident: "AssignButton" }
  ]);
  assert.equal(report.parts.length, 2);
  assert.equal(report.parts[1]?.contributions.length, 1);

  const registry = emptyFeatureManifestRegistry();
  registry.manifestsByFeature.set(manifest.feature, manifest);
  registry.capabilityReportsByFeature.set(manifest.feature, report);
  const effectiveModel = buildEffectiveCompositionModel(manifest, registry);
  assert.ok(effectiveModel.items.some((item) => item.key === "actionShareCode:AssignAction"));
  assert.ok(effectiveModel.conflicts.some((conflict) => conflict.code === "missing-dependency"));
  assert.ok(
    matchesExpectedXPathInEffectiveModel(
      "//Form/Controls/Control[@Ident='AssignedGroupID']",
      effectiveModel.items,
      report
    )
  );
  assert.ok(
    effectiveModel.contributions.some(
      (contribution) => contribution.name === "ActionShareCodes" && contribution.usage === "effective"
    )
  );

  const unusedManifest = normalizeFeatureManifest(
    {
      feature: "UnusedFeature",
      parts: [
        {
          file: "Unused.Form.feature.xml",
          contributions: [
            {
              name: "UnusedContribution",
              kind: "provide",
              targetXPath: "//MissingRoot/Nowhere"
            }
          ]
        }
      ]
    },
    "Unused.feature.json"
  );
  const unusedRegistry = emptyFeatureManifestRegistry();
  unusedRegistry.manifestsByFeature.set(unusedManifest.feature, unusedManifest);
  unusedRegistry.capabilityReportsByFeature.set(unusedManifest.feature, buildFeatureCapabilityReport(unusedManifest));
  const unusedModel = buildEffectiveCompositionModel(unusedManifest, unusedRegistry);
  assert.ok(
    unusedModel.contributions.some(
      (contribution) => contribution.name === "UnusedContribution" && contribution.usage === "unused"
    )
  );

  const parsed = parseFeatureManifestText(
    JSON.stringify({
      feature: "Approval",
      parts: [
        {
          file: "Approval.View.feature.xml",
          appliesTo: ["view", "filter"],
          provides: ["column:ApprovalState"],
          contributions: [
            {
              for: "Columns",
              kind: "extend-existing",
              expectsXPath: ["//DataView/Columns"],
              touches: ["column:ApprovalState"]
            }
          ]
        }
      ]
    }),
    "Approval.feature.json"
  );

  assert.equal(parsed.feature, "Approval");
  assert.deepEqual(parsed.parts[0]?.appliesTo, ["view", "filter"]);
  assert.deepEqual(parsed.parts[0]?.provides, [{ kind: "column", ident: "ApprovalState" }]);
  assert.equal(parsed.parts[0]?.contributions[0]?.kind, "extend-existing");
  assert.deepEqual(parsed.parts[0]?.contributions[0]?.expectsXPath, ["//DataView/Columns"]);
  assert.deepEqual(parsed.parts[0]?.contributions[0]?.touches, [{ kind: "column", ident: "ApprovalState" }]);

  assert.throws(
    () =>
      normalizeFeatureManifest(
        {
          feature: "Broken",
          requires: ["FolderGroupSegment"]
        },
        "Broken.feature.json"
      ),
    /kind:ident/
  );

  assert.throws(
    () =>
      normalizeFeatureManifest(
        {
          feature: "",
          parts: []
        },
        "Broken.feature.json"
      ),
    /non-empty 'feature'/
  );

  console.log("Composition model tests passed.");
}

run();
