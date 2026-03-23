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

  public static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      const raw = value.slice("file://".length);
      return new Uri(raw.replace(/\//g, "\\"));
    }
    return new Uri(value);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }

  public get scheme(): string {
    return "file";
  }
}

const vscodeMock = {
  Uri
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ValidationQueueOrchestrator } = require("../../core/validation/validationQueueOrchestrator") as typeof import("../../core/validation/validationQueueOrchestrator");

type Outcome = import("../../core/validation/documentValidationService").IndexedValidationOutcome;

async function run(): Promise<void> {
  await testStaleInFlightHighValidationIsNotPublished();
  await testLowForceDoesNotCancelQueuedHighValidation();
  console.log("\x1b[32mValidationQueueOrchestrator tests passed.\x1b[0m");
}

async function testStaleInFlightHighValidationIsNotPublished(): Promise<void> {
  const targetUri = Uri.file("C:\\repo\\XML_Templates\\200_Test\\A.xml") as unknown as import("vscode").Uri;
  const publishCalls: Array<ReadonlyArray<[import("vscode").Uri, readonly import("vscode").Diagnostic[] | undefined]>> = [];
  const signatures = new Map<string, string>();

  let firstGateResolve: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    firstGateResolve = resolve;
  });

  let computeCallCount = 0;
  const preferFsReadCalls: boolean[] = [];
  const queue = new ValidationQueueOrchestrator({
    log: () => {
      // no-op
    },
    publishDiagnosticsBatch: (updates) => {
      publishCalls.push(updates);
    },
    async computeIndexedValidationOutcome(_uri, _options): Promise<Outcome | undefined> {
      computeCallCount++;
      preferFsReadCalls.push(_options?.preferFsRead === true);
      if (computeCallCount === 1) {
        await firstGate;
        return {
          uri: targetUri,
          diagnostics: [{ code: "stale" } as import("vscode").Diagnostic],
          signature: "s1",
          shouldLog: true,
          relOrPath: "XML_Templates/200_Test/A.xml",
          totalMs: 1,
          readMs: 0,
          diagnosticsMs: 1,
          pathMode: "open",
          cacheMiss: false
        };
      }

      return {
        uri: targetUri,
        diagnostics: [{ code: "fresh" } as import("vscode").Diagnostic],
        signature: "s2",
        shouldLog: true,
        relOrPath: "XML_Templates/200_Test/A.xml",
        totalMs: 1,
        readMs: 0,
        diagnosticsMs: 1,
        pathMode: "open",
        cacheMiss: false
      };
    },
    shouldValidateUriForActiveProjects: () => true,
    getBackgroundSettingsSnapshot: () => ({} as never),
    getBackgroundMetadataSnapshot: () => ({} as never),
    getIndexedValidationLogSignature: (key) => signatures.get(key),
    setIndexedValidationLogSignature: (key, signature) => {
      signatures.set(key, signature);
    },
    sleep: async () => undefined
  });

  queue.enqueueValidation(targetUri, "high");
  await sleep(0);
  queue.enqueueValidation(targetUri, "high", { force: true });

  firstGateResolve?.();
  await sleep(30);

  assert.equal(computeCallCount >= 2, true, "Expected stale and fresh high validation runs.");
  assert.equal(preferFsReadCalls.every((value) => value), true, "High-priority queue must validate via FS snapshot.");
  const flattened = publishCalls.flatMap((batch) => batch);
  assert.equal(flattened.length, 1, "Only fresh generation should be published.");
  const publishedDiagnostics = flattened[0][1] ?? [];
  assert.equal(publishedDiagnostics.length, 1);
  assert.equal(String(publishedDiagnostics[0].code), "fresh");

  queue.dispose();
}

async function testLowForceDoesNotCancelQueuedHighValidation(): Promise<void> {
  const targetUri = Uri.file("C:\\repo\\XML_Templates\\200_Test\\B.xml") as unknown as import("vscode").Uri;
  const signatures = new Map<string, string>();
  const publishCalls: Array<ReadonlyArray<[import("vscode").Uri, readonly import("vscode").Diagnostic[] | undefined]>> = [];

  let computeCalls = 0;
  const queue = new ValidationQueueOrchestrator({
    log: () => {
      // no-op
    },
    publishDiagnosticsBatch: (updates) => {
      publishCalls.push(updates);
    },
    async computeIndexedValidationOutcome(uri): Promise<Outcome | undefined> {
      computeCalls++;
      return {
        uri,
        diagnostics: [{ code: "ok" } as import("vscode").Diagnostic],
        signature: `s${computeCalls}`,
        shouldLog: true,
        relOrPath: "XML_Templates/200_Test/B.xml",
        totalMs: 1,
        readMs: 0,
        diagnosticsMs: 1,
        pathMode: "open",
        cacheMiss: false
      };
    },
    shouldValidateUriForActiveProjects: () => true,
    getBackgroundSettingsSnapshot: () => ({} as never),
    getBackgroundMetadataSnapshot: () => ({} as never),
    getIndexedValidationLogSignature: (key) => signatures.get(key),
    setIndexedValidationLogSignature: (key, signature) => {
      signatures.set(key, signature);
    },
    sleep: async () => undefined
  });

  queue.enqueueValidation(targetUri, "high", { force: true });
  queue.enqueueValidation(targetUri, "low", { force: true });
  await sleep(30);

  const flattened = publishCalls.flatMap((batch) => batch);
  assert.equal(flattened.length >= 1, true, "Expected queued high validation to be published even after low(force).");
  assert.equal(computeCalls >= 1, true);
  queue.dispose();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void run();
