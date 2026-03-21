import { strict as assert } from "node:assert";
import { ValidationHost } from "../../core/validation/validationHost";
import { ValidationModule, ValidationRequest } from "../../core/validation/types";

class TestModule implements ValidationModule {
  private readonly producedDiagnostics: number;
  public constructor(
    public readonly id: string,
    public readonly mode: "source" | "composed-reference",
    public readonly needsFacts?: readonly string[],
    public readonly needsSymbols?: readonly string[],
    producedDiagnostics = 0
  ) {
    this.producedDiagnostics = producedDiagnostics;
  }

  public run(_request: ValidationRequest) {
    if (this.producedDiagnostics <= 0) {
      return [];
    }
    return Array.from({ length: this.producedDiagnostics }, () => ({} as unknown as import("vscode").Diagnostic));
  }
}

function run(): void {
  const logs: string[] = [];
  const host = new ValidationHost({
    hasFactKind: (kind) => kind === "fact.rootMeta",
    hasSymbolKind: (kind) => kind === "button",
    log: (message) => logs.push(message)
  });

  host.register(new TestModule("ok", "source", ["fact.rootMeta"], ["button"], 1));
  host.register(new TestModule("silent", "source", ["fact.rootMeta"], ["button"], 0));
  host.register(new TestModule("bad-fact", "source", ["fact.usingRefs"]));
  host.register(new TestModule("bad-symbol", "composed-reference", undefined, ["section"]));

  const disabled = host.getDisabledModuleIds();
  assert.deepEqual(disabled, ["bad-fact", "bad-symbol"]);
  assert.ok(logs.some((line) => line.includes("bad-fact") && line.includes("missingFacts=[fact.usingRefs]")));
  assert.ok(logs.some((line) => line.includes("bad-symbol") && line.includes("missingSymbols=[section]")));

  const diagnostics = host.run({} as ValidationRequest);
  assert.equal(diagnostics.length, 1);

  const stats = host.getModuleUsageStats();
  const okStats = stats.find((item) => item.moduleId === "ok");
  const silentStats = stats.find((item) => item.moduleId === "silent");
  assert.ok(okStats, "ok stats should exist");
  assert.ok(silentStats, "silent stats should exist");
  assert.equal(okStats?.runs ?? -1, 1);
  assert.equal(okStats?.diagnostics ?? -1, 1);
  assert.equal(silentStats?.runs ?? -1, 1);
  assert.equal(silentStats?.diagnostics ?? -1, 0);
  assert.ok(host.getDeadModuleIds().includes("silent"));
  console.log("\x1b[32mValidation host dependency tests passed.\x1b[0m");
}

run();
