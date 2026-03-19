import { strict as assert } from "node:assert";
import { buildCompositionProjection, CompositionProjectionSnapshot } from "../../composition/treeProjectionAdapter";

interface NodeLike {
  type: string;
  label: string;
}

function run(): void {
  testFeatureProjectionWins();
  testRegularXmlFallback();
  testUsingFallback();
  testInfoFallback();
  console.log("\x1b[32mTree projection adapter tests passed.\x1b[0m");
}

function makeSnapshot(relativePath: string): CompositionProjectionSnapshot {
  return {
    documentUri: "file:///doc.xml",
    documentVersion: 1,
    relativePath,
    facts: {} as never,
    index: {} as never,
    registry: {} as never
  };
}

function testFeatureProjectionWins(): void {
  const nodes = buildCompositionProjection<NodeLike>(
    makeSnapshot("feature.xml"),
    {
      findFeatureForRelativePath: () => ({ feature: "X" } as never),
      buildFeatureTree: () => [{ type: "feature", label: "feature-node" }],
      buildRegularXmlTree: () => [{ type: "regular", label: "regular-node" }],
      buildUsingTree: () => [{ type: "using", label: "using-node" }],
      infoNode: (label) => ({ type: "info", label })
    }
  );
  assert.equal(nodes[0]?.label, "feature-node");
}

function testRegularXmlFallback(): void {
  const nodes = buildCompositionProjection<NodeLike>(
    makeSnapshot("regular.xml"),
    {
      findFeatureForRelativePath: () => undefined,
      buildFeatureTree: () => [{ type: "feature", label: "feature-node" }],
      buildRegularXmlTree: () => [{ type: "regular", label: "regular-node" }],
      buildUsingTree: () => [{ type: "using", label: "using-node" }],
      infoNode: (label) => ({ type: "info", label })
    }
  );
  assert.equal(nodes[0]?.label, "regular-node");
}

function testUsingFallback(): void {
  const nodes = buildCompositionProjection<NodeLike>(
    makeSnapshot("using.xml"),
    {
      findFeatureForRelativePath: () => undefined,
      buildFeatureTree: () => [{ type: "feature", label: "feature-node" }],
      buildRegularXmlTree: () => [],
      buildUsingTree: () => [{ type: "using", label: "using-node" }],
      infoNode: (label) => ({ type: "info", label })
    }
  );
  assert.equal(nodes[0]?.label, "using-node");
}

function testInfoFallback(): void {
  const snapshot = makeSnapshot("empty.xml");
  const nodes = buildCompositionProjection<NodeLike>(
    snapshot,
    {
      findFeatureForRelativePath: () => undefined,
      buildFeatureTree: () => [{ type: "feature", label: "feature-node" }],
      buildRegularXmlTree: () => [],
      buildUsingTree: () => [],
      infoNode: (label) => ({ type: "info", label })
    }
  );
  assert.equal(nodes[0]?.type, "info");
  assert.ok(nodes[0]?.label.includes(snapshot.relativePath));
}

run();
