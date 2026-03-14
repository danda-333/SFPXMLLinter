export interface CompositionPrimitiveQuickFixPayload {
  uri?: unknown;
  kind?: "param" | "slot" | "unknown";
  name?: string;
  primitiveKey?: string;
}

export interface CompositionPrimitiveDiagnostic {
  source?: string;
  code?: unknown;
  message: string;
  range: unknown;
}

export interface CompositionPrimitiveCodeAction {
  title: string;
  edit?: unknown;
  command?: {
    command: string;
    arguments?: unknown[];
  };
}

export interface CompositionPrimitiveQuickFixDeps {
  getDiagnostics(uri: unknown): CompositionPrimitiveDiagnostic[];
  getCodeActions(uri: unknown, range: unknown): Promise<CompositionPrimitiveCodeAction[]>;
  applyEdit(edit: unknown): Promise<void>;
  executeCommand(command: string, ...args: unknown[]): Promise<void>;
  openDocument(uri: unknown): Promise<unknown>;
  validateDocument(document: unknown): Promise<void>;
  askRevalidate(message: string): Promise<boolean>;
}

export async function applyCompositionPrimitiveQuickFix(
  payload: CompositionPrimitiveQuickFixPayload | undefined,
  deps: CompositionPrimitiveQuickFixDeps
): Promise<"applied" | "invalid" | "missing-diagnostic" | "missing-action"> {
  const uri = payload?.uri;
  const kind = payload?.kind;
  const name = (payload?.name ?? "").trim();
  const primitiveKey = (payload?.primitiveKey ?? "").trim();
  if (!uri || !kind || !name) {
    return "invalid";
  }

  const expectedRule = kind === "param"
    ? "primitive-missing-param"
    : kind === "slot"
      ? "primitive-missing-slot"
      : "unknown-primitive";

  const expectedActionTitle = kind === "param"
    ? `Add missing parameter '${name}'`
    : kind === "slot"
      ? `Add missing Slot '${name}'`
      : `Create primitive '${name}'`;

  let diagnostics = deps
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === "sfp-xml-linter");
  let match = findMatchingDiagnostic(diagnostics, expectedRule, name, primitiveKey);
  if (!match) {
    const shouldRevalidate = await deps.askRevalidate(
      `SFP XML Linter: No matching diagnostic found for ${expectedRule} (${name}). Revalidate document and retry?`
    );
    if (!shouldRevalidate) {
      return "missing-diagnostic";
    }

    const document = await deps.openDocument(uri);
    await deps.validateDocument(document);
    diagnostics = deps
      .getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === "sfp-xml-linter");
    match = findMatchingDiagnostic(diagnostics, expectedRule, name, primitiveKey);
    if (!match) {
      return "missing-diagnostic";
    }
  }

  let actions = await deps.getCodeActions(uri, match.range);
  let action = findMatchingAction(actions, kind, name, expectedActionTitle);
  if (!action) {
    const shouldRevalidate = await deps.askRevalidate(
      `SFP XML Linter: Quick fix '${expectedActionTitle}' is not available. Revalidate document and retry?`
    );
    if (!shouldRevalidate) {
      return "missing-action";
    }

    const document = await deps.openDocument(uri);
    await deps.validateDocument(document);
    actions = await deps.getCodeActions(uri, match.range);
    action = findMatchingAction(actions, kind, name, expectedActionTitle);
    if (!action) {
      return "missing-action";
    }
  }

  if (action.edit) {
    await deps.applyEdit(action.edit);
  }
  if (action.command) {
    await deps.executeCommand(action.command.command, ...(action.command.arguments ?? []));
  }

  const updatedDocument = await deps.openDocument(uri);
  await deps.validateDocument(updatedDocument);
  return "applied";
}

function findMatchingDiagnostic(
  diagnostics: readonly CompositionPrimitiveDiagnostic[],
  expectedRule: string,
  name: string,
  primitiveKey: string
): CompositionPrimitiveDiagnostic | undefined {
  return diagnostics.find((diagnostic) => {
    const code = normalizeDiagnosticCode(diagnostic.code);
    if (code !== expectedRule) {
      return false;
    }

    const message = diagnostic.message;
    if (!message.includes(name)) {
      return false;
    }

    if (primitiveKey.length > 0 && !message.includes(primitiveKey)) {
      return false;
    }

    return true;
  });
}

function normalizeDiagnosticCode(code: unknown): string {
  if (typeof code === "string" || typeof code === "number") {
    return String(code);
  }
  if (
    typeof code === "object" &&
    code !== null &&
    "value" in code &&
    (typeof (code as { value?: unknown }).value === "string" || typeof (code as { value?: unknown }).value === "number")
  ) {
    return String((code as { value: string | number }).value);
  }
  return "";
}

function findMatchingAction(
  actions: readonly CompositionPrimitiveCodeAction[],
  kind: "param" | "slot" | "unknown",
  name: string,
  expectedActionTitle: string
): CompositionPrimitiveCodeAction | undefined {
  if (kind === "unknown") {
    return actions.find((action) =>
      action.title === "Open primitive source" ||
      action.title === expectedActionTitle ||
      action.title.startsWith(`Create primitive '${name}'`)
    );
  }

  return actions.find((action) => action.title === expectedActionTitle);
}
