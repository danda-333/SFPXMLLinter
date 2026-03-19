import { strict as assert } from "node:assert";
import Module = require("node:module");

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = fsPath;
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

const vscodeMock = {
  Uri,
  workspace: {
    asRelativePath(uri: Uri): string {
      return uri.fsPath.replace(/\\/g, "/");
    }
  }
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { UpdateOrchestrator } = require("../../orchestrator/updateOrchestrator") as typeof import("../../orchestrator/updateOrchestrator");

async function run(): Promise<void> {
  await testBuildCompletesBeforeDependentValidationEnqueue();
  await testSkipWhenNoContentChanges();
  await testNonRelevantUriOnlyTriggersBuild();
  console.log("\x1b[32mUpdateOrchestrator tests passed.\x1b[0m");
}

async function testBuildCompletesBeforeDependentValidationEnqueue(): Promise<void> {
  const callOrder: string[] = [];
  let buildCompleted = false;

  const orchestrator = new UpdateOrchestrator({
    log() {
      // no-op
    },
    isReindexRelevantUri() {
      return true;
    },
    refreshIncremental() {
      callOrder.push("refresh");
      return {
        updated: true,
        reason: "updated",
        rootKind: "component",
        componentKey: "Common/Controls/AdditionalFields"
      };
    },
    collectAffectedFormIdentsForComponent() {
      return new Set<string>(["ITSMIncident"]);
    },
    enqueueDependentValidationForFormIdents(formIdents) {
      callOrder.push("enqueue");
      assert.equal(buildCompleted, true, "Dependent validation enqueue must happen after build completion.");
      assert.equal(formIdents.has("ITSMIncident"), true);
      return undefined;
    },
    async triggerAutoBuild() {
      callOrder.push("build-start");
      await sleep(5);
      buildCompleted = true;
      callOrder.push("build-done");
    },
    queueFullReindex() {
      // no-op
    }
  });

  await orchestrator.handleDocumentSave(
    {
      uri: Uri.file("C:/repo/XML_Components/Common/Controls/AdditionalFields.component.xml")
    } as never,
    true
  );

  assert.deepEqual(callOrder, ["refresh", "build-start", "build-done", "enqueue"]);
}

async function testSkipWhenNoContentChanges(): Promise<void> {
  let called = false;
  const orchestrator = new UpdateOrchestrator({
    log() {
      // no-op
    },
    isReindexRelevantUri() {
      return true;
    },
    refreshIncremental() {
      called = true;
      return { updated: true, reason: "updated", rootKind: "form" };
    },
    collectAffectedFormIdentsForComponent() {
      called = true;
      return new Set();
    },
    enqueueDependentValidationForFormIdents() {
      called = true;
      return undefined;
    },
    async triggerAutoBuild() {
      called = true;
    },
    queueFullReindex() {
      called = true;
    }
  });

  await orchestrator.handleDocumentSave({ uri: Uri.file("C:/repo/XML_Templates/A.xml") } as never, false);
  assert.equal(called, false, "No orchestrator actions expected when save has no content changes.");
}

async function testNonRelevantUriOnlyTriggersBuild(): Promise<void> {
  const calls: string[] = [];
  const orchestrator = new UpdateOrchestrator({
    log() {
      // no-op
    },
    isReindexRelevantUri() {
      return false;
    },
    refreshIncremental() {
      calls.push("refresh");
      return { updated: true, reason: "updated", rootKind: "other" };
    },
    collectAffectedFormIdentsForComponent() {
      calls.push("collect");
      return new Set();
    },
    enqueueDependentValidationForFormIdents() {
      calls.push("enqueue");
      return undefined;
    },
    async triggerAutoBuild() {
      calls.push("build");
    },
    queueFullReindex() {
      calls.push("reindex");
    }
  });

  await orchestrator.handleDocumentSave({ uri: Uri.file("C:/repo/Other.txt") } as never, true);
  assert.deepEqual(calls, ["build"]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void run();
