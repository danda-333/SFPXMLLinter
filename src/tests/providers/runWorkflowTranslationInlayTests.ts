import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Module = require("node:module");

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }
  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  public static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      return new Uri(value.slice("file://".length));
    }
    return new Uri(value);
  }
  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
  public contains(position: Position): boolean {
    if (position.line < this.start.line || position.line > this.end.line) {
      return false;
    }
    if (position.line === this.start.line && position.character < this.start.character) {
      return false;
    }
    if (position.line === this.end.line && position.character > this.end.character) {
      return false;
    }
    return true;
  }
}

class InlayHint {
  public paddingLeft?: boolean;
  constructor(public readonly position: Position, public readonly label: string) {}
}

enum InlayHintKind {
  Type = 1
}

enum DiagnosticSeverity {
  Warning = 1
}

class Diagnostic {
  constructor(public readonly range: Range, public readonly message: string, public readonly severity: DiagnosticSeverity) {}
}

class MockDiagnosticsCollection {
  public readonly items = new Map<string, readonly Diagnostic[]>();
  public setBatch(updates: ReadonlyArray<[Uri, readonly Diagnostic[] | undefined]>): void {
    for (const [uri, diagnostics] of updates) {
      if (!diagnostics || diagnostics.length === 0) {
        this.items.delete(uri.toString());
      } else {
        this.items.set(uri.toString(), diagnostics);
      }
    }
  }
}

class MockTextDocument {
  private readonly lineStarts: number[];
  public readonly languageId = "xml";
  public readonly uri: Uri;

  constructor(uri: Uri, private readonly text: string) {
    this.uri = uri;
    this.lineStarts = computeLineStarts(text);
  }

  public getText(): string {
    return this.text;
  }

  public positionAt(offset: number): Position {
    const safe = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.lineStarts[mid];
      const next = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
      if (safe < start) {
        high = mid - 1;
      } else if (safe >= next) {
        low = mid + 1;
      } else {
        return new Position(mid, safe - start);
      }
    }
    return new Position(0, safe);
  }

  public lineAt(line: number): { text: string } {
    const safe = Math.max(0, Math.min(line, this.lineStarts.length - 1));
    const start = this.lineStarts[safe];
    const end = safe + 1 < this.lineStarts.length ? this.lineStarts[safe + 1] : this.text.length;
    return { text: this.text.slice(start, end).replace(/\r?\n$/, "") };
  }
}

const vscodeMock = {
  Uri,
  Position,
  Range,
  InlayHint,
  InlayHintKind,
  Diagnostic,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>
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

async function run(): Promise<void> {
  const { WorkflowTranslationsService } = require("../../core/translations/workflowTranslations") as typeof import("../../core/translations/workflowTranslations");
  const { WorkflowTranslationInlayProvider } = require("../../providers/workflowTranslationInlayProvider") as typeof import("../../providers/workflowTranslationInlayProvider");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-translations-"));
  const resources = path.join(tempRoot, "Resources");
  fs.mkdirSync(resources, { recursive: true });
  const csvPath = path.join(resources, "translations.csv");
  fs.writeFileSync(
    csvPath,
    "\ufeffKlíč;Hodnota;Jazyk;Skupina;Systémový překlad\r\nToOperatorAssessment_ITSM;K posouzeni;1;ITSM;0\r\nSentToCoordinator_ITSM;Rozhodnuti koordinátora;1;ITSM;0\r\nToOperatorAssessment_ITSM;Duplicitni;1;ITSM;0\r\n",
    "utf8"
  );
  vscodeMock.workspace.workspaceFolders = [{ uri: Uri.file(tempRoot), name: "tmp", index: 0 }];

  const diagnostics = new MockDiagnosticsCollection();
  const service = new WorkflowTranslationsService((updates) => diagnostics.setBatch(updates as never), () => undefined);

  const snapshotWithCollision = service.getSnapshot({
    enabled: true,
    languageId: 1,
    resourcesRoots: ["Resources"]
  });
  assert.equal(snapshotWithCollision.enabled, true);
  assert.equal(snapshotWithCollision.collisions.length, 1);
  assert.equal(snapshotWithCollision.byKey.has("ToOperatorAssessment_ITSM"), false, "Collision key must be ignored.");
  assert.equal(snapshotWithCollision.byKey.get("SentToCoordinator_ITSM"), "Rozhodnuti koordinátora");

  fs.writeFileSync(
    csvPath,
    "Klíč;Hodnota;Jazyk;Skupina;Systémový překlad\nToOperatorAssessment_ITSM;K posouzeni;1;ITSM;0\nSentToCoordinator_ITSM;Rozhodnuti koordinátora;1;ITSM;0\n",
    "utf8"
  );
  service.invalidate();
  const snapshot = service.getSnapshot({
    enabled: true,
    languageId: 1,
    resourcesRoots: ["Resources"]
  });
  assert.equal(snapshot.collisions.length, 0);
  assert.equal(snapshot.byKey.get("ToOperatorAssessment_ITSM"), "K posouzeni");

  const workflowText = [
    "<WorkFlow FormIdent=\"ITSMRequest\">",
    "  <Definition>",
    "    <States>",
    "      <State Value=\"10\" TitleResourceKey=\"ToOperatorAssessment_ITSM\" ColorCssClass=\"warning\"/>",
    "      <State Value=\"20\" TitleResourceKey=\"MissingKey\"/> <!-- existing comment -->",
    "    </States>",
    "  </Definition>",
    "  <Steps>",
    "    <Step Ident=\"Draft\" State=\"10\"/>",
    "    <Step Ident=\"Missing\" State=\"999\"/>",
    "  </Steps>",
    "  <Actions>",
    "    <Action xsi:type=\"ChangeState\" State=\"10\"/>",
    "    <Action xsi:type=\"ChangeState\"/>",
    "  </Actions>",
    "  <FormControls>",
    "    <FormControl Ident=\"ReporterControl\"/>",
    "  </FormControls>",
    "  <Buttons>",
    "    <ButtonShareCode Ident=\"SendToProcessButtonShare\">",
    "      <Button Ident=\"ResolveButton\"/>",
    "      <Button Ident=\"FallbackTitleButton\"/>",
    "    </ButtonShareCode>",
    "    <Button xsi:type=\"ShareCodeButton\" Ident=\"SendToProcessButtonShare\"/>",
    "    <Button Ident=\"ResolveButton\"/>",
    "    <Button Ident=\"FallbackKeyButton\"/>",
    "    <Button Ident=\"FallbackTitleButton\"/>",
    "  </Buttons>",
    "</WorkFlow>"
  ].join("\n");
  const doc = new MockTextDocument(Uri.file(path.join(tempRoot, "wf.xml")), workflowText);
  const provider = new WorkflowTranslationInlayProvider(
    () => snapshot,
    () => ({
      enabled: true
    }),
    () =>
      new Map([
        ["ResolveButton", { titleResourceKey: "ToOperatorAssessment_ITSM" }],
        ["FallbackKeyButton", { titleResourceKey: "MissingButtonKey" }],
        ["FallbackTitleButton", { title: "Manual button title" }]
      ]),
    () =>
      new Map([
        ["ReporterControl", { titleResourceKey: "ToOperatorAssessment_ITSM" }]
      ]),
    () =>
      new Map([
        ["PricingFile", { titleResourceKey: "ToOperatorAssessment_ITSM" }]
      ]),
    () => new Map()
  );
  const fullRange = new Range(new Position(0, 0), new Position(1000, 1000));
  const hints = provider.provideInlayHints(doc as never, fullRange as never) as InlayHint[];
  assert.ok(hints.some((hint) => String(hint.label).includes("K posouzeni")));
  assert.ok(hints.some((hint) => String(hint.label).includes("K posouzeni")), "Step should resolve through state key.");
  assert.ok(!hints.some((hint) => String(hint.label).includes("[MISSING]")), "Missing Step state mapping should not produce fallback hint.");
  assert.ok(hints.some((hint) => String(hint.label).includes("MissingButtonKey")), "Workflow button should fallback to TitleResourceKey.");
  assert.ok(hints.some((hint) => String(hint.label).includes("Manual button title")), "Workflow button should fallback to Title.");
  assert.ok(hints.some((hint) => String(hint.label).includes("K posouzeni")), "Workflow FormControl should resolve through Form control translation.");
  assert.ok(hints.some((hint) => String(hint.label).includes("K posouzeni")), "ChangeState action should resolve state translation.");
  assert.ok(
    hints.some((hint) => String(hint.label).includes("K posouzeni, Manual button title")),
    "ButtonShareCode should aggregate nested button labels."
  );

  const formText = [
    "<Form Ident=\"ITSMRequest\">",
    "  <Control Ident=\"ReporterControl\" TitleResourceKey=\"ToOperatorAssessment_ITSM\"/>",
    "  <ControlLabel ControlID=\"PricingFile\"/>",
    "  <Control ID=\"PricingFile\"/>",
    "  <Control Ident=\"PricingFile\" TitleResourceKey=\"ToOperatorAssessment_ITSM\"/>",
    "  <Buttons>",
    "    <Button Ident=\"SaveButton\" TitleResourceKey=\"ToOperatorAssessment_ITSM\"/>",
    "    <Button Ident=\"NoTranslation\" TitleResourceKey=\"MissingButtonKey\"/>",
    "  </Buttons>",
    "</Form>"
  ].join("\n");
  const formDoc = new MockTextDocument(Uri.file(path.join(tempRoot, "form.xml")), formText);
  const formHints = provider.provideInlayHints(formDoc as never, fullRange as never) as InlayHint[];
  assert.ok(formHints.some((hint) => String(hint.label).includes("K posouzeni")), "Form button should show translated TitleResourceKey hint.");
  assert.ok(formHints.some((hint) => String(hint.label).includes("K posouzeni")), "Form control reference hint should resolve through ControlID/ID.");
  assert.ok(!formHints.some((hint) => String(hint.label).includes("MissingButtonKey")), "Form button should not show fallback when translation is missing.");

  const genericText = [
    "<DataView TitleResourceKey=\"ToOperatorAssessment_ITSM\" GroupTitleResourceKey=\"SentToCoordinator_ITSM\">",
    "  <Section Ident=\"S1\" TitleResourceKey=\"ToOperatorAssessment_ITSM\"/>",
    "  <Column Ident=\"C1\" TitleResourceKey=\"SentToCoordinator_ITSM\"/>",
    "  <Action xsi:type=\"GlobalValidation\" ErrorMessageResourceKey=\"ToOperatorAssessment_ITSM\"/>",
    "</DataView>"
  ].join("\n");
  const genericDoc = new MockTextDocument(Uri.file(path.join(tempRoot, "generic.xml")), genericText);
  const genericHints = provider.provideInlayHints(genericDoc as never, fullRange as never) as InlayHint[];
  assert.ok(genericHints.some((hint) => String(hint.label).includes("K posouzeni")), "Generic Section/DataView/Action hints should render translation.");
  assert.ok(genericHints.some((hint) => String(hint.label).includes("Rozhodnuti koordinátora")), "Generic Column/DataView group hint should render translation.");

  service.invalidate();
  const disabledSnapshot = service.getSnapshot({
    enabled: true,
    languageId: 1,
    resourcesRoots: ["NonExistingResourcesRoot"]
  });
  const disabledProvider = new WorkflowTranslationInlayProvider(
    () => disabledSnapshot,
    () => ({
      enabled: true
    }),
    () => new Map(),
    () => new Map(),
    () => new Map(),
    () => new Map()
  );
  const disabledHints = disabledProvider.provideInlayHints(doc as never, fullRange as never) as InlayHint[];
  assert.equal(disabledHints.length, 0, "Hints must be disabled when no resources root exists.");

  console.log("Workflow translation inlay tests passed.");
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

void run().catch((error) => {
  console.error("Workflow translation inlay tests failed.");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
