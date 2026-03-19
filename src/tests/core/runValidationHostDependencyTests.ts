import { strict as assert } from "node:assert";
import { ValidationHost } from "../../core/validation/validationHost";
import { ValidationModule, ValidationRequest } from "../../core/validation/types";

class TestModule implements ValidationModule {
  public constructor(
    public readonly id: string,
    public readonly mode: "source" | "composed-reference",
    public readonly needsFacts?: readonly string[],
    public readonly needsSymbols?: readonly string[]
  ) {}

  public run(_request: ValidationRequest) {
    return [];
  }
}

function run(): void {
  const logs: string[] = [];
  const host = new ValidationHost({
    hasFactKind: (kind) => kind === "fact.rootMeta",
    hasSymbolKind: (kind) => kind === "button",
    log: (message) => logs.push(message)
  });

  host.register(new TestModule("ok", "source", ["fact.rootMeta"], ["button"]));
  host.register(new TestModule("bad-fact", "source", ["fact.usingRefs"]));
  host.register(new TestModule("bad-symbol", "composed-reference", undefined, ["section"]));

  const disabled = host.getDisabledModuleIds();
  assert.deepEqual(disabled, ["bad-fact", "bad-symbol"]);
  assert.ok(logs.some((line) => line.includes("bad-fact") && line.includes("missingFacts=[fact.usingRefs]")));
  assert.ok(logs.some((line) => line.includes("bad-symbol") && line.includes("missingSymbols=[section]")));

  const diagnostics = host.run({} as ValidationRequest);
  assert.equal(diagnostics.length, 0);
  console.log("\x1b[32mValidation host dependency tests passed.\x1b[0m");
}

run();
