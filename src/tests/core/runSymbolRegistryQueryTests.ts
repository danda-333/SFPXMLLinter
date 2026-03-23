import * as assert from "node:assert/strict";
import { SymbolRegistry } from "../../core/symbols/symbolRegistry";

function run(): void {
  const registry = new SymbolRegistry();

  registry.registerResolver({
    kind: "control",
    collectDefs(nodeId) {
      if (nodeId === "doc://a") {
        return [{ key: "control:One", kind: "control", ident: "One", nodeId }];
      }
      if (nodeId === "doc://b") {
        return [{ key: "control:Two", kind: "control", ident: "Two", nodeId }];
      }
      return [];
    },
    collectRefs() {
      return [];
    }
  });

  registry.refreshNode("doc://a");
  registry.refreshNode("doc://b");

  assert.equal(registry.getDefsByKind("doc://a", "control").length, 1);
  assert.equal(registry.getDefsByKind("doc://b", "control").length, 1);
  assert.equal(registry.getDefsForKind("control").get("One")?.length ?? 0, 1);
  assert.equal(registry.getDefsForKind("control").get("Two")?.length ?? 0, 1);

  registry.registerResolver({
    kind: "control",
    collectDefs(nodeId) {
      if (nodeId === "doc://a") {
        return [{ key: "control:OneRenamed", kind: "control", ident: "OneRenamed", nodeId }];
      }
      if (nodeId === "doc://b") {
        return [{ key: "control:Two", kind: "control", ident: "Two", nodeId }];
      }
      return [];
    },
    collectRefs() {
      return [];
    }
  });

  registry.refreshNode("doc://a");

  assert.equal(registry.getDefsForKind("control").get("One")?.length ?? 0, 0);
  assert.equal(registry.getDefsForKind("control").get("OneRenamed")?.length ?? 0, 1);

  registry.registerResolver({
    kind: "deadResolver",
    collectDefs() {
      return [];
    },
    collectRefs() {
      return [];
    }
  });
  registry.refreshNode("doc://a");

  const usage = registry.getResolverUsageStats();
  const controlUsage = usage.find((item) => item.kind === "control");
  assert.ok(controlUsage, "control usage should be present");
  assert.ok((controlUsage?.collectCalls ?? 0) > 0, "control resolver should have collect calls");
  assert.ok((controlUsage?.defsProduced ?? 0) > 0, "control resolver should have produced defs");
  const deadResolverUsage = usage.find((item) => item.kind === "deadResolver");
  assert.ok(deadResolverUsage, "deadResolver usage should be present");
  assert.ok((deadResolverUsage?.collectCalls ?? 0) > 0, "deadResolver should have collect calls");
  assert.equal(deadResolverUsage?.defsProduced ?? -1, 0, "deadResolver should not produce defs");
  assert.equal(deadResolverUsage?.refsProduced ?? -1, 0, "deadResolver should not produce refs");
  assert.ok(
    registry.getDeadResolverKinds().includes("deadResolver"),
    "deadResolver should be reported as dead resolver"
  );

  console.log("\x1b[32mSymbol registry query tests passed.\x1b[0m");
}

run();

