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

  const duplicateAllowedManifest = normalizeFeatureManifest(
    {
      feature: "AssignFilter",
      parts: [
        {
          id: "Assign.Form",
          file: "Assign.Form.feature.xml",
          appliesTo: ["form"],
          contributions: [
            {
              id: "controls-form",
              name: "Controls",
              appliesTo: ["form"],
              provides: ["control:AssignedGroupID"]
            }
          ]
        },
        {
          id: "Assign.Filter",
          file: "Assign.Filter.feature.xml",
          appliesTo: ["filter"],
          contributions: [
            {
              id: "controls-filter",
              name: "Controls",
              appliesTo: ["filter"],
              provides: ["control:AssignedGroupID"]
            }
          ]
        }
      ]
    },
    "AssignFilter.feature.json"
  );
  const duplicateAllowedRegistry = emptyFeatureManifestRegistry();
  duplicateAllowedRegistry.manifestsByFeature.set(duplicateAllowedManifest.feature, duplicateAllowedManifest);
  duplicateAllowedRegistry.capabilityReportsByFeature.set(
    duplicateAllowedManifest.feature,
    buildFeatureCapabilityReport(duplicateAllowedManifest)
  );
  const duplicateAllowedModel = buildEffectiveCompositionModel(duplicateAllowedManifest, duplicateAllowedRegistry);
  assert.ok(!duplicateAllowedModel.conflicts.some((conflict) => conflict.code === "duplicate-provider"));

  const duplicateConflictManifest = normalizeFeatureManifest(
    {
      feature: "AssignWorkflowDup",
      parts: [
        {
          id: "Assign.Form",
          file: "Assign.Form.feature.xml",
          appliesTo: ["form"],
          contributions: [
            {
              id: "controls-form",
              name: "Controls",
              appliesTo: ["form"],
              provides: ["control:AssignedGroupID"]
            }
          ]
        },
        {
          id: "Assign.WorkFlow",
          file: "Assign.WorkFlow.feature.xml",
          appliesTo: ["form"],
          contributions: [
            {
              id: "controls-wf",
              name: "Controls",
              appliesTo: ["form"],
              provides: ["control:AssignedGroupID"]
            }
          ]
        }
      ]
    },
    "AssignWorkflowDup.feature.json"
  );
  const duplicateConflictRegistry = emptyFeatureManifestRegistry();
  duplicateConflictRegistry.manifestsByFeature.set(duplicateConflictManifest.feature, duplicateConflictManifest);
  duplicateConflictRegistry.capabilityReportsByFeature.set(
    duplicateConflictManifest.feature,
    buildFeatureCapabilityReport(duplicateConflictManifest)
  );
  const duplicateConflictModel = buildEffectiveCompositionModel(duplicateConflictManifest, duplicateConflictRegistry);
  const duplicateConflict = duplicateConflictModel.conflicts.find((conflict) => conflict.code === "duplicate-provider");
  assert.ok(duplicateConflict);
  assert.ok(duplicateConflict?.message.includes("Assign.Form.feature.xml"));
  assert.ok(duplicateConflict?.message.includes("Assign.WorkFlow.feature.xml"));

  const orderingConflictManifest = normalizeFeatureManifest(
    {
      feature: "OrderingConflict",
      parts: [
        {
          id: "A",
          file: "A.Form.feature.xml",
          ordering: {
            before: ["MissingPart"],
            after: ["B"]
          }
        },
        {
          id: "B",
          file: "B.Form.feature.xml",
          ordering: {
            after: ["A"]
          }
        }
      ]
    },
    "OrderingConflict.feature.json"
  );
  const orderingConflictRegistry = emptyFeatureManifestRegistry();
  orderingConflictRegistry.manifestsByFeature.set(orderingConflictManifest.feature, orderingConflictManifest);
  orderingConflictRegistry.capabilityReportsByFeature.set(
    orderingConflictManifest.feature,
    buildFeatureCapabilityReport(orderingConflictManifest)
  );
  const orderingConflictModel = buildEffectiveCompositionModel(orderingConflictManifest, orderingConflictRegistry);
  const orderingConflicts = orderingConflictModel.conflicts.filter((conflict) => conflict.code === "ordering-conflict");
  assert.ok(orderingConflicts.length >= 2);
  assert.ok(orderingConflicts.some((conflict) => conflict.message.includes("target part was not found")));
  assert.ok(orderingConflicts.some((conflict) => conflict.message.includes("Conflicting ordering")));

  const orderingCycleManifest = normalizeFeatureManifest(
    {
      feature: "OrderingCycle",
      parts: [
        {
          id: "A",
          file: "A.Form.feature.xml",
          ordering: {
            before: ["B"]
          }
        },
        {
          id: "B",
          file: "B.Form.feature.xml",
          ordering: {
            before: ["C"]
          }
        },
        {
          id: "C",
          file: "C.Form.feature.xml",
          ordering: {
            before: ["A"]
          }
        }
      ]
    },
    "OrderingCycle.feature.json"
  );
  const orderingCycleRegistry = emptyFeatureManifestRegistry();
  orderingCycleRegistry.manifestsByFeature.set(orderingCycleManifest.feature, orderingCycleManifest);
  orderingCycleRegistry.capabilityReportsByFeature.set(
    orderingCycleManifest.feature,
    buildFeatureCapabilityReport(orderingCycleManifest)
  );
  const orderingCycleModel = buildEffectiveCompositionModel(orderingCycleManifest, orderingCycleRegistry);
  assert.ok(orderingCycleModel.conflicts.some((conflict) => conflict.code === "ordering-conflict" && conflict.message.includes("cycle")));

  const orderingUnresolvedManifest = normalizeFeatureManifest(
    {
      feature: "OrderingUnresolved",
      parts: [
        {
          id: "FormButtons",
          file: "FormButtons.Form.feature.json",
          ordering: {
            group: "form-buttons",
            before: ["WorkflowActions"]
          }
        },
        {
          id: "WorkflowActions",
          file: "WorkflowActions.WorkFlow.feature.json",
          ordering: {
            group: "workflow-actions"
          }
        }
      ]
    },
    "OrderingUnresolved.feature.json"
  );
  const orderingUnresolvedRegistry = emptyFeatureManifestRegistry();
  orderingUnresolvedRegistry.manifestsByFeature.set(orderingUnresolvedManifest.feature, orderingUnresolvedManifest);
  orderingUnresolvedRegistry.capabilityReportsByFeature.set(
    orderingUnresolvedManifest.feature,
    buildFeatureCapabilityReport(orderingUnresolvedManifest)
  );
  const orderingUnresolvedModel = buildEffectiveCompositionModel(orderingUnresolvedManifest, orderingUnresolvedRegistry);
  assert.ok(
    orderingUnresolvedModel.conflicts.some(
      (conflict) => conflict.code === "ordering-conflict" && conflict.message.includes("Unresolved ordering")
    )
  );

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
