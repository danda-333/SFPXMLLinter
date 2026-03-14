import * as fs from "node:fs";
import * as path from "node:path";
import Module = require("node:module");

type VscodeMockState = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/composition");
const state: VscodeMockState = {
  workspaceRoot,
  config: {
    workspaceRoots: ["Common"],
    resourcesRoots: [],
    hoverDocsFiles: [],
    rules: {}
  }
};

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

class Position {
  public readonly line: number;
  public readonly character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

class Location {
  public readonly uri: Uri;
  public readonly range: Range;
  constructor(uri: Uri, range: Range) {
    this.uri = uri;
    this.range = range;
  }
}

enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

class Diagnostic {
  public readonly range: Range;
  public readonly message: string;
  public readonly severity: DiagnosticSeverity;
  public source?: string;
  public code?: string | number;
  constructor(range: Range, message: string, severity: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "composition-fixture", index: 0 }],
    getConfiguration(section: string) {
      if (section !== "sfpXmlLinter") {
        return {
          get<T>(_key: string, defaultValue: T): T {
            return defaultValue;
          }
        };
      }

      return {
        get<T>(key: string, defaultValue: T): T {
          const value = state.config[key];
          return (value as T | undefined) ?? defaultValue;
        }
      };
    },
    getWorkspaceFolder(uri: Uri) {
      const root = path.resolve(state.workspaceRoot).replace(/\\/g, "/").toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(state.workspaceRoot), name: "composition-fixture", index: 0 } : undefined;
    },
    asRelativePath(uri: Uri, _includeWorkspaceFolder: boolean): string {
      return path.relative(state.workspaceRoot, uri.fsPath).replace(/\\/g, "/");
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

const { DiagnosticsEngine } = require("../../diagnostics/engine") as typeof import("../../diagnostics/engine");
const { loadFeatureManifestRegistry } = require("../../composition/workspace") as typeof import("../../composition/workspace");
const { parseDocumentFacts } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly version = 1;
  public readonly lineCount: number;
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(filePath: string, text: string) {
    this.uri = Uri.file(filePath);
    this.text = text;
    this.lineStarts = computeLineStarts(text);
    this.lineCount = this.lineStarts.length;
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
    const safeLine = Math.max(0, Math.min(line, this.lineCount - 1));
    const start = this.lineStarts[safeLine] ?? 0;
    const endWithBreak = safeLine + 1 < this.lineStarts.length ? this.lineStarts[safeLine + 1] : this.text.length;
    let end = endWithBreak;
    if (end > start && this.text.charCodeAt(end - 1) === 10) {
      end--;
    }
    if (end > start && this.text.charCodeAt(end - 1) === 13) {
      end--;
    }

    return {
      text: this.text.slice(start, end)
    };
  }
}

function run(): void {
  const engine = new DiagnosticsEngine();
  const registry = loadFeatureManifestRegistry(workspaceRoot);
  const emptyIndex = createEmptyIndex();

  const entrypointPath = path.join(workspaceRoot, "Common", "Features", "Assign", "Assign.feature.xml");
  const entrypointText = fs.readFileSync(entrypointPath, "utf8").replace(
    "<Manifest Description=\"Entrypoint composition file for Assign feature.\" Tags=\"itsm, assign\">",
    "<Manifest Description=\"Entrypoint composition file for Assign feature.\" Tags=\"itsm, assign\"><Requires><Ref Kind=\"feature\" Ident=\"MissingFeature\" /></Requires>"
  );
  const entrypointDoc = new MockTextDocument(entrypointPath, entrypointText);
  const entrypointDiagnostics = engine.buildDiagnostics(entrypointDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(entrypointDiagnostics, "unknown-feature-requirement");

  const formPath = path.join(workspaceRoot, "Common", "Features", "Assign", "Assign.Form.feature.xml");
  const formText = fs.readFileSync(formPath, "utf8").replace(
    "<ExpectsXPath>",
    "<Expects><Symbol Kind=\"control\" Ident=\"MissingControl\" /></Expects><ExpectsXPath>"
  );
  const formFeatureDoc = new MockTextDocument(formPath, formText);
  const formDiagnostics = engine.buildDiagnostics(formFeatureDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formDiagnostics, "missing-feature-expectation");

  const formXPathText = fs.readFileSync(formPath, "utf8").replace(
    "<ExpectsXPath>",
    "<ExpectsXPath><XPath>//Form/Controls/Control[@Ident='MissingXPathControl']</XPath>"
  );
  const formXPathDoc = new MockTextDocument(formPath, formXPathText);
  const formXPathDiagnostics = engine.buildDiagnostics(formXPathDoc as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formXPathDiagnostics, "missing-feature-expected-xpath");

  const formUsageDiagnostics = engine.buildDiagnostics(new MockTextDocument(formPath, fs.readFileSync(formPath, "utf8")) as unknown as import("vscode").TextDocument, emptyIndex, {
    standaloneMode: true,
    featureRegistry: registry
  });
  assertHasRule(formUsageDiagnostics, "partial-feature-contribution");

  const duplicateProviderRegistry = loadFeatureManifestRegistry(workspaceRoot);
  const duplicateModel = duplicateProviderRegistry.effectiveModelsByFeature.get("Assign");
  if (!duplicateModel) {
    throw new Error("Expected effective model for Assign.");
  }
  duplicateProviderRegistry.effectiveModelsByFeature.set("Assign", {
    ...duplicateModel,
    conflicts: [
      ...duplicateModel.conflicts,
      {
        code: "duplicate-provider",
        message: "Symbol 'control:AssignedGroupID' is provided by multiple parts.",
        itemKeys: ["control:AssignedGroupID"]
      }
    ]
  });
  const duplicateProviderDiagnostics = engine.buildDiagnostics(
    entrypointDoc as unknown as import("vscode").TextDocument,
    emptyIndex,
    {
      standaloneMode: true,
      featureRegistry: duplicateProviderRegistry
    }
  );
  assertHasRule(duplicateProviderDiagnostics, "duplicate-feature-provider");
  assertHasRule(duplicateProviderDiagnostics, "incomplete-feature");

  const missingDependencyRegistry = loadFeatureManifestRegistry(workspaceRoot);
  const missingDependencyModel = missingDependencyRegistry.effectiveModelsByFeature.get("Assign");
  if (!missingDependencyModel) {
    throw new Error("Expected effective model for Assign.");
  }
  missingDependencyRegistry.effectiveModelsByFeature.set("Assign", {
    ...missingDependencyModel,
    conflicts: [
      ...missingDependencyModel.conflicts,
      {
        code: "missing-dependency",
        message: "Required dependency 'feature:MissingFeature' is not satisfied.",
        itemKeys: []
      }
    ]
  });
  const missingDependencyDiagnostics = engine.buildDiagnostics(
    entrypointDoc as unknown as import("vscode").TextDocument,
    emptyIndex,
    {
      standaloneMode: true,
      featureRegistry: missingDependencyRegistry
    }
  );
  assertHasRule(missingDependencyDiagnostics, "missing-feature-dependency");

  const orphanPartRegistry = loadFeatureManifestRegistry(workspaceRoot);
  const assignCapability = orphanPartRegistry.capabilityReportsByFeature.get("Assign");
  if (!assignCapability) {
    throw new Error("Expected capability report for Assign.");
  }
  orphanPartRegistry.capabilityReportsByFeature.set("Assign", {
    ...assignCapability,
    parts: [
      ...assignCapability.parts,
      {
        id: "MissingPart",
        file: "Common/Features/Assign/Missing.Part.feature.xml",
        appliesTo: ["form"],
        provides: [],
        expects: [],
        contributions: []
      }
    ]
  });
  const orphanPartDiagnostics = engine.buildDiagnostics(
    entrypointDoc as unknown as import("vscode").TextDocument,
    emptyIndex,
    {
      standaloneMode: true,
      featureRegistry: orphanPartRegistry
    }
  );
  assertHasRule(orphanPartDiagnostics, "orphan-feature-part");

  const orderingConflictRegistry = loadFeatureManifestRegistry(workspaceRoot);
  const orderingModel = orderingConflictRegistry.effectiveModelsByFeature.get("Assign");
  if (!orderingModel) {
    throw new Error("Expected effective model for Assign.");
  }
  orderingConflictRegistry.effectiveModelsByFeature.set("Assign", {
    ...orderingModel,
    conflicts: [
      ...orderingModel.conflicts,
      {
        code: "ordering-conflict",
        message: "Ordering cycle detected: Assign.Form -> Assign.WorkFlow -> Assign.Form.",
        itemKeys: ["part:Assign.Form", "part:Assign.WorkFlow"]
      }
    ]
  });
  const orderingConflictDiagnostics = engine.buildDiagnostics(
    entrypointDoc as unknown as import("vscode").TextDocument,
    emptyIndex,
    {
      standaloneMode: true,
      featureRegistry: orderingConflictRegistry
    }
  );
  assertHasRule(orderingConflictDiagnostics, "ordering-conflict");

  const inheritanceSettings = createInheritanceSettings();
  const formInheritanceText = `<?xml version="1.0" encoding="utf-8"?>
<Form Ident="InheritanceForm">
  <Usings>
    <Using Feature="Shared/Sample" />
  </Usings>
</Form>`;
  const workflowRedundantText = `<?xml version="1.0" encoding="utf-8"?>
<WorkFlow FormIdent="InheritanceForm" Ident="InheritanceFormWorkFlow">
  <Usings>
    <Using Feature="Shared/Sample" />
  </Usings>
</WorkFlow>`;
  const workflowOverrideText = `<?xml version="1.0" encoding="utf-8"?>
<WorkFlow FormIdent="InheritanceForm" Ident="InheritanceFormOverrideWorkFlow">
  <Usings>
    <Using Feature="Shared/Sample" Contribution="Controls" />
  </Usings>
</WorkFlow>`;
  const workflowSuppressedText = `<?xml version="1.0" encoding="utf-8"?>
<WorkFlow FormIdent="InheritanceForm" Ident="InheritanceFormSuppressedWorkFlow">
  <Usings>
    <Using Feature="Shared/Sample" SuppressInheritance="true" />
  </Usings>
</WorkFlow>`;
  const dataviewRedundantText = `<?xml version="1.0" encoding="utf-8"?>
<DataView FormIdent="InheritanceForm" Ident="InheritanceFormView">
  <Usings>
    <Using Feature="Shared/Sample" />
  </Usings>
</DataView>`;

  const formDoc = new MockTextDocument(path.join(workspaceRoot, "Common/Inheritance/InheritanceForm.xml"), formInheritanceText);
  const workflowRedundantDoc = new MockTextDocument(path.join(workspaceRoot, "Common/Inheritance/InheritanceFormWorkFlow.redundant.xml"), workflowRedundantText);
  const workflowOverrideDoc = new MockTextDocument(path.join(workspaceRoot, "Common/Inheritance/InheritanceFormWorkFlow.override.xml"), workflowOverrideText);
  const workflowSuppressedDoc = new MockTextDocument(path.join(workspaceRoot, "Common/Inheritance/InheritanceFormWorkFlow.suppressed.xml"), workflowSuppressedText);
  const dataviewRedundantDoc = new MockTextDocument(path.join(workspaceRoot, "Common/Inheritance/InheritanceFormView.redundant.xml"), dataviewRedundantText);
  const inheritanceIndex = createInheritanceIndex(formDoc, workflowRedundantDoc, workflowOverrideDoc, workflowSuppressedDoc, dataviewRedundantDoc);

  const workflowRedundantDiagnostics = engine.buildDiagnostics(
    workflowRedundantDoc as unknown as import("vscode").TextDocument,
    inheritanceIndex,
    {
      parsedFacts: parseDocumentFacts(workflowRedundantDoc as unknown as import("vscode").TextDocument),
      settingsOverride: inheritanceSettings
    }
  );
  assertHasRule(workflowRedundantDiagnostics, "workflow-redundant-feature-using");

  const workflowOverrideDiagnostics = engine.buildDiagnostics(
    workflowOverrideDoc as unknown as import("vscode").TextDocument,
    inheritanceIndex,
    {
      parsedFacts: parseDocumentFacts(workflowOverrideDoc as unknown as import("vscode").TextDocument),
      settingsOverride: inheritanceSettings
    }
  );
  assertHasRule(workflowOverrideDiagnostics, "feature-inheritance-override");

  const workflowSuppressedDiagnostics = engine.buildDiagnostics(
    workflowSuppressedDoc as unknown as import("vscode").TextDocument,
    inheritanceIndex,
    {
      parsedFacts: parseDocumentFacts(workflowSuppressedDoc as unknown as import("vscode").TextDocument),
      settingsOverride: inheritanceSettings
    }
  );
  assertLacksRule(workflowSuppressedDiagnostics, "workflow-redundant-feature-using");
  assertLacksRule(workflowSuppressedDiagnostics, "feature-inheritance-override");

  const dataviewRedundantDiagnostics = engine.buildDiagnostics(
    dataviewRedundantDoc as unknown as import("vscode").TextDocument,
    inheritanceIndex,
    {
      parsedFacts: parseDocumentFacts(dataviewRedundantDoc as unknown as import("vscode").TextDocument),
      settingsOverride: inheritanceSettings
    }
  );
  assertHasRule(dataviewRedundantDiagnostics, "dataview-redundant-feature-using");

  console.log("Composition diagnostics tests passed.");
}

function assertHasRule(diagnostics: readonly import("vscode").Diagnostic[], ruleId: string): void {
  if (diagnostics.some((d) => String(d.code) === ruleId)) {
    return;
  }

  const compact = diagnostics.map((d) => `[${String(d.code)}] ${d.message}`).join("\n");
  throw new Error(`Expected diagnostic '${ruleId}', got:\n${compact}`);
}

function assertLacksRule(diagnostics: readonly import("vscode").Diagnostic[], ruleId: string): void {
  if (!diagnostics.some((d) => String(d.code) === ruleId)) {
    return;
  }

  const compact = diagnostics.map((d) => `[${String(d.code)}] ${d.message}`).join("\n");
  throw new Error(`Expected no diagnostic '${ruleId}', got:\n${compact}`);
}

function createEmptyIndex(): import("../../indexer/types").WorkspaceIndex {
  return {
    formsByIdent: new Map(),
    componentsByKey: new Map(),
    componentKeysByBaseName: new Map(),
    formIdentReferenceLocations: new Map(),
    mappingFormIdentReferenceLocations: new Map(),
    controlReferenceLocationsByFormIdent: new Map(),
    buttonReferenceLocationsByFormIdent: new Map(),
    sectionReferenceLocationsByFormIdent: new Map(),
    componentReferenceLocationsByKey: new Map(),
    componentContributionReferenceLocationsByKey: new Map(),
    componentUsageFormIdentsByKey: new Map(),
    componentContributionUsageFormIdentsByKey: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

function createInheritanceSettings(): import("../../config/settings").SfpXmlLinterSettings {
  return {
    workspaceRoots: ["Common"],
    resourcesRoots: [],
    hoverDocsFiles: [],
    incompleteMode: false,
    formatterMaxConsecutiveBlankLines: 2,
    autoBuildOnSave: true,
    componentSaveBuildScope: "dependents",
    templateBuilderMode: "debug",
    ruleSeverities: {
      "workflow-redundant-feature-using": "warning",
      "dataview-redundant-feature-using": "warning",
      "feature-inheritance-override": "information",
      "unknown-using-feature": "error",
      "unknown-using-contribution": "warning"
    }
  };
}

function createInheritanceIndex(
  formDoc: MockTextDocument,
  workflowRedundantDoc: MockTextDocument,
  workflowOverrideDoc: MockTextDocument,
  workflowSuppressedDoc: MockTextDocument,
  dataviewRedundantDoc: MockTextDocument
): import("../../indexer/types").WorkspaceIndex {
  const formFacts = parseDocumentFacts(formDoc as unknown as import("vscode").TextDocument);
  const workflowRedundantFacts = parseDocumentFacts(workflowRedundantDoc as unknown as import("vscode").TextDocument);
  const workflowOverrideFacts = parseDocumentFacts(workflowOverrideDoc as unknown as import("vscode").TextDocument);
  const workflowSuppressedFacts = parseDocumentFacts(workflowSuppressedDoc as unknown as import("vscode").TextDocument);
  const dataviewRedundantFacts = parseDocumentFacts(dataviewRedundantDoc as unknown as import("vscode").TextDocument);

  const componentKey = "Shared/Sample";
  const componentLocation = new Location(formDoc.uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location;
  const component: import("../../indexer/types").IndexedComponent = {
    key: componentKey,
    uri: formDoc.uri as unknown as import("vscode").Uri,
    contributions: new Set(),
    componentLocation,
    contributionDefinitions: new Map(),
    contributionSummaries: new Map(),
    formControlDefinitions: new Map(),
    formButtonDefinitions: new Map(),
    formSectionDefinitions: new Map(),
    workflowActionShareCodeDefinitions: new Map(),
    workflowControlShareCodeDefinitions: new Map(),
    workflowButtonShareCodeDefinitions: new Map(),
    workflowButtonShareCodeButtonIdents: new Map()
  };

  const formIdentLocation = new Location(formDoc.uri, new Range(new Position(1, 12), new Position(1, 27))) as unknown as import("vscode").Location;
  const form: import("../../indexer/types").IndexedForm = {
    ident: "InheritanceForm",
    uri: formDoc.uri as unknown as import("vscode").Uri,
    controls: new Set(),
    buttons: new Set(),
    sections: new Set(),
    formIdentLocation,
    controlDefinitions: new Map(),
    buttonDefinitions: new Map(),
    sectionDefinitions: new Map()
  };

  const parsedFactsByUri = new Map<string, import("../../indexer/xmlFacts").ParsedDocumentFacts>();
  parsedFactsByUri.set(formDoc.uri.toString(), formFacts);
  parsedFactsByUri.set(workflowRedundantDoc.uri.toString(), workflowRedundantFacts);
  parsedFactsByUri.set(workflowOverrideDoc.uri.toString(), workflowOverrideFacts);
  parsedFactsByUri.set(workflowSuppressedDoc.uri.toString(), workflowSuppressedFacts);
  parsedFactsByUri.set(dataviewRedundantDoc.uri.toString(), dataviewRedundantFacts);

  const componentsByKey = new Map<string, import("../../indexer/types").IndexedComponent>();
  componentsByKey.set(componentKey, component);

  const index = createEmptyIndex();
  index.formsByIdent.set(form.ident, form);
  index.componentsByKey = componentsByKey;
  index.parsedFactsByUri = parsedFactsByUri;
  index.componentsReady = true;
  index.formsReady = true;
  index.fullReady = true;
  return index;
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

run();
