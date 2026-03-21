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
  await testPostSaveRunsAfterDependencyEnqueue();
  await testSameUriSavesAreSerialized();
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
  await orchestrator.waitForSaveIdle();

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

async function testPostSaveRunsAfterDependencyEnqueue(): Promise<void> {
  const callOrder: string[] = [];
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
        componentKey: "Common/Controls/AdditionalFields",
        formIdent: "ITSMIncident"
      };
    },
    collectAffectedFormIdentsForComponent() {
      callOrder.push("collect");
      return new Set<string>(["ITSMIncident"]);
    },
    enqueueDependentValidationForFormIdents(formIdents) {
      callOrder.push("enqueue");
      assert.equal(formIdents.has("ITSMIncident"), true);
      return {
        forms: formIdents.size,
        files: 2,
        immediateOpen: 1,
        queuedLow: 1,
        durationMs: 3
      };
    },
    async triggerAutoBuild() {
      callOrder.push("build");
    },
    async onPostSave(context) {
      callOrder.push("post");
      assert.equal(context.affectedFormIdents.has("ITSMIncident"), true);
      assert.equal(context.dependency?.files, 2);
    },
    queueFullReindex() {
      // no-op
    }
  });

  await orchestrator.handleDocumentSave(
    { uri: Uri.file("C:/repo/XML_Components/Common/Controls/AdditionalFields.component.xml") } as never,
    true
  );
  await orchestrator.waitForSaveIdle();

  assert.deepEqual(callOrder, ["refresh", "collect", "build", "enqueue", "post"]);
}

async function testSameUriSavesAreSerialized(): Promise<void> {
  const callOrder: string[] = [];
  let releaseFirstBuild: (() => void) | undefined;
  const firstBuildGate = new Promise<void>((resolve) => {
    releaseFirstBuild = resolve;
  });
  let buildCall = 0;

  const orchestrator = new UpdateOrchestrator({
    log() {
      // no-op
    },
    isReindexRelevantUri() {
      return true;
    },
    refreshIncremental(document) {
      const rel = document.uri.fsPath.replace(/\\/g, "/");
      callOrder.push(`refresh:${rel}`);
      return {
        updated: true,
        reason: "updated",
        rootKind: "workflow",
        formIdent: "ITSMIncident"
      };
    },
    collectAffectedFormIdentsForComponent() {
      return new Set<string>();
    },
    enqueueDependentValidationForFormIdents() {
      callOrder.push("enqueue");
      return undefined;
    },
    async triggerAutoBuild() {
      buildCall++;
      const thisCall = buildCall;
      callOrder.push(`build-start:${thisCall}`);
      if (thisCall === 1) {
        await firstBuildGate;
      }
      callOrder.push(`build-done:${thisCall}`);
    },
    queueFullReindex() {
      // no-op
    }
  });

  const doc = { uri: Uri.file("C:/repo/XML_Templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml") } as never;
  const first = orchestrator.handleDocumentSave(doc, true);
  const second = orchestrator.handleDocumentSave(doc, true);
  await sleep(5);
  assert.deepEqual(
    callOrder,
    [
      "refresh:C:/repo/XML_Templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml",
      "build-start:1"
    ],
    "Second save must wait for first save pipeline on same URI."
  );

  releaseFirstBuild?.();
  await Promise.all([first, second]);
  await orchestrator.waitForSaveIdle();

  assert.deepEqual(callOrder, [
    "refresh:C:/repo/XML_Templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml",
    "build-start:1",
    "build-done:1",
    "enqueue",
    "refresh:C:/repo/XML_Templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml",
    "build-start:2",
    "build-done:2",
    "enqueue"
  ]);
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
  await orchestrator.waitForSaveIdle();
  assert.deepEqual(calls, ["build"]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void run();
