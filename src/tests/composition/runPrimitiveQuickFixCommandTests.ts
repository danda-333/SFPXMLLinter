import { strict as assert } from "node:assert";
import {
  applyCompositionPrimitiveQuickFix,
  CompositionPrimitiveCodeAction,
  CompositionPrimitiveDiagnostic
} from "../../composition/primitiveQuickFix";

interface State {
  diagnostics: CompositionPrimitiveDiagnostic[];
  actions: CompositionPrimitiveCodeAction[];
  appliedEditCount: number;
  executedCommands: string[];
  validateCount: number;
  openCount: number;
  askRevalidateCalls: number;
  revalidateAnswers: boolean[];
}

async function run(): Promise<void> {
  await testApplyParamQuickFixWithoutRetry();
  await testRetryWhenDiagnosticMissing();
  await testUnknownPrimitiveUsesCreateAction();
  await testNoActionWithoutRevalidate();
  console.log("Primitive quick-fix command tests passed.");
}

async function testApplyParamQuickFixWithoutRetry(): Promise<void> {
  const state = createState({
    diagnostics: [
      {
        source: "sfp-xml-linter",
        code: "primitive-missing-param",
        message: "UsePrimitive 'Common/Dialogs/DialogWithParam' is missing required parameter 'DialogIdent'.",
        range: "r1"
      }
    ],
    actions: [{ title: "Add missing parameter 'DialogIdent'", edit: { id: "e1" } }]
  });
  const result = await applyCompositionPrimitiveQuickFix(
    { uri: "u1", kind: "param", name: "DialogIdent", primitiveKey: "Common/Dialogs/DialogWithParam" },
    createDeps(state)
  );
  assert.equal(result, "applied");
  assert.equal(state.appliedEditCount, 1);
  assert.equal(state.validateCount, 1);
  assert.equal(state.askRevalidateCalls, 0);
}

async function testRetryWhenDiagnosticMissing(): Promise<void> {
  const state = createState({
    diagnostics: [],
    actions: [{ title: "Add missing Slot 'Body'", edit: { id: "e2" } }],
    revalidateAnswers: [true]
  });
  let diagnosticsCall = 0;
  const deps = createDeps(state, {
    getDiagnostics() {
      diagnosticsCall += 1;
      if (diagnosticsCall > 1) {
        return [
          {
            source: "sfp-xml-linter",
            code: "primitive-missing-slot",
            message: "UsePrimitive 'Common/Dialogs/DialogWithSlot' is missing required Slot 'Body'.",
            range: "r2"
          }
        ];
      }
      return [];
    }
  });
  const result = await applyCompositionPrimitiveQuickFix(
    { uri: "u2", kind: "slot", name: "Body", primitiveKey: "Common/Dialogs/DialogWithSlot" },
    deps
  );
  assert.equal(result, "applied");
  assert.equal(state.askRevalidateCalls, 1);
  assert.equal(state.validateCount, 2);
}

async function testUnknownPrimitiveUsesCreateAction(): Promise<void> {
  const state = createState({
    diagnostics: [
      {
        source: "sfp-xml-linter",
        code: "unknown-primitive",
        message: "Primitive 'Common/Missing/Primitive' was not found in XML_Primitives/XML_Components.",
        range: "r3"
      }
    ],
    actions: [{ title: "Create primitive 'Common/Missing/Primitive'", edit: { id: "e3" } }]
  });
  const result = await applyCompositionPrimitiveQuickFix(
    { uri: "u3", kind: "unknown", name: "Common/Missing/Primitive", primitiveKey: "Common/Missing/Primitive" },
    createDeps(state)
  );
  assert.equal(result, "applied");
  assert.equal(state.appliedEditCount, 1);
}

async function testNoActionWithoutRevalidate(): Promise<void> {
  const state = createState({
    diagnostics: [
      {
        source: "sfp-xml-linter",
        code: "primitive-missing-slot",
        message: "UsePrimitive 'Common/Dialogs/DialogWithSlot' is missing required Slot 'Body'.",
        range: "r4"
      }
    ],
    actions: [],
    revalidateAnswers: [false]
  });
  const result = await applyCompositionPrimitiveQuickFix(
    { uri: "u4", kind: "slot", name: "Body", primitiveKey: "Common/Dialogs/DialogWithSlot" },
    createDeps(state)
  );
  assert.equal(result, "missing-action");
  assert.equal(state.appliedEditCount, 0);
  assert.equal(state.askRevalidateCalls, 1);
}

function createState(seed?: Partial<State>): State {
  return {
    diagnostics: seed?.diagnostics ?? [],
    actions: seed?.actions ?? [],
    appliedEditCount: 0,
    executedCommands: [],
    validateCount: 0,
    openCount: 0,
    askRevalidateCalls: 0,
    revalidateAnswers: seed?.revalidateAnswers ?? []
  };
}

function createDeps(
  state: State,
  overrides?: Partial<{
    getDiagnostics: (uri: unknown) => CompositionPrimitiveDiagnostic[];
    getCodeActions: (uri: unknown, range: unknown) => Promise<CompositionPrimitiveCodeAction[]>;
  }>
) {
  return {
    getDiagnostics(uri: unknown): CompositionPrimitiveDiagnostic[] {
      return overrides?.getDiagnostics ? overrides.getDiagnostics(uri) : state.diagnostics;
    },
    async getCodeActions(uri: unknown, range: unknown): Promise<CompositionPrimitiveCodeAction[]> {
      return overrides?.getCodeActions ? overrides.getCodeActions(uri, range) : state.actions;
    },
    async applyEdit(_edit: unknown): Promise<void> {
      state.appliedEditCount += 1;
    },
    async executeCommand(command: string): Promise<void> {
      state.executedCommands.push(command);
    },
    async openDocument(uri: unknown): Promise<unknown> {
      state.openCount += 1;
      return uri;
    },
    async validateDocument(_document: unknown): Promise<void> {
      state.validateCount += 1;
    },
    async askRevalidate(_message: string): Promise<boolean> {
      state.askRevalidateCalls += 1;
      const answer = state.revalidateAnswers.shift();
      return answer ?? false;
    }
  };
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
