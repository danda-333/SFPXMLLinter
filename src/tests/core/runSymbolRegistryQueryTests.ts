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

  console.log("\x1b[32mSymbol registry query tests passed.\x1b[0m");
}

run();

