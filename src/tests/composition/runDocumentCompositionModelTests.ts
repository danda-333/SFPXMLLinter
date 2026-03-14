import { strict as assert } from "node:assert";
import * as fs from "node:fs";
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

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

type WorkspaceIndex = import("../../indexer/types").WorkspaceIndex;
type IndexedComponent = import("../../indexer/types").IndexedComponent;
type ParsedDocumentFacts = import("../../indexer/xmlFacts").ParsedDocumentFacts;

const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
const { buildDocumentCompositionModel, collectInjectedSymbols } = require("../../composition/documentModel") as typeof import("../../composition/documentModel");
const { populateUsingInsertTraceFromText } = require("../../composition/usingImpact") as typeof import("../../composition/usingImpact");

function run(): void {
  const sampleComponentPath = path.join(workspaceRoot, "XML_Components", "Shared", "Sample.feature.xml");
  const validFormPath = path.join(workspaceRoot, "XML_Templates", "100_Test", "ValidForm.xml");
  const partialWorkflowPath = path.join(workspaceRoot, "XML_Templates", "900_Chyby", "chyba-26-partial-using.xml");

  const sampleComponentText = fs.readFileSync(sampleComponentPath, "utf8");
  const validFormText = fs.readFileSync(validFormPath, "utf8");
  const partialWorkflowText = fs.readFileSync(partialWorkflowPath, "utf8");

  const index = createEmptyIndex();
  const sampleComponent = createComponent("Shared/Sample", sampleComponentPath, sampleComponentText);
  index.componentsByKey.set(sampleComponent.key, sampleComponent);
  index.componentKeysByBaseName.set("Sample", new Set(["Shared/Sample"]));

  const validFormFacts = parseDocumentFactsFromText(validFormText) as ParsedDocumentFacts;
  populateUsingInsertTraceFromText(validFormFacts, validFormText, index);
  const formModel = buildDocumentCompositionModel(validFormFacts, index);

  assert.equal(formModel.usings.length, 1, "ValidForm should expose exactly one using");
  const formUsing = formModel.usings[0];
  assert.ok(formUsing);
  assert.equal(formUsing?.impact.kind, "effective", "ValidForm using should be effective");
  assert.equal(formUsing?.contributions.length, 2, "ValidForm should include 2 root-relevant contributions");
  assert.equal(formUsing?.filteredContributions.length, 3, "ValidForm should filter out 3 non-form contributions");
  const formContributionNames = new Set((formUsing?.contributions ?? []).map((item) => item.contribution.contributionName));
  assert.equal(formContributionNames.has("Controls"), true);
  assert.equal(formContributionNames.has("Buttons"), true);

  const injectedFormControls = collectInjectedSymbols(
    formModel,
    index,
    (contribution) => contribution.formControlIdents
  );
  assert.equal(injectedFormControls.has("ComponentControl"), true, "Injected form controls should include ComponentControl");
  assert.equal(injectedFormControls.get("ComponentControl")?.source, "Shared/Sample");

  const partialWorkflowFacts = parseDocumentFactsFromText(partialWorkflowText) as ParsedDocumentFacts;
  populateUsingInsertTraceFromText(partialWorkflowFacts, partialWorkflowText, index);
  const workflowModel = buildDocumentCompositionModel(partialWorkflowFacts, index);

  assert.equal(workflowModel.usings.length, 1, "Partial workflow should expose exactly one using");
  const workflowUsing = workflowModel.usings[0];
  assert.ok(workflowUsing);
  assert.equal(workflowUsing?.impact.kind, "partial", "Workflow using should be partial");
  assert.equal(workflowUsing?.impact.relevantCount, 3, "Workflow should have 3 workflow-relevant contributions");
  assert.equal(workflowUsing?.impact.successfulCount, 1, "Workflow should have exactly one successful contribution");
  assert.equal(workflowUsing?.contributions.length, 3, "Workflow selected contributions count should be 3");
  assert.equal(workflowUsing?.filteredContributions.length, 2, "Workflow filtered contributions count should be 2");
  const workflowInsertByName = new Map(
    (workflowUsing?.contributions ?? []).map((item) => [item.contribution.contributionName, item.insertCount])
  );
  assert.equal(workflowInsertByName.get("ControlShareCodes"), 1);
  assert.equal(workflowInsertByName.get("ButtonShareCodes"), 0);
  assert.equal(workflowInsertByName.get("ActionShareCodes"), 0);

  console.log("Document composition model tests passed.");
}

function createEmptyIndex(): WorkspaceIndex {
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

function createComponent(componentKey: string, componentPath: string, text: string): IndexedComponent {
  const componentUri = Uri.file(componentPath) as unknown as import("vscode").Uri;
  const contributionNames = collectContributionNames(text);
  const contributionDefinitions = new Map<string, import("vscode").Location>();
  for (const contributionName of contributionNames) {
    contributionDefinitions.set(
      contributionName,
      new Location(componentUri as unknown as Uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location
    );
  }

  return {
    key: componentKey,
    uri: componentUri,
    contributions: contributionNames,
    componentLocation: new Location(componentUri as unknown as Uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location,
    contributionDefinitions,
    contributionSummaries: collectComponentContributionSummaries(text),
    formControlDefinitions: new Map(),
    formButtonDefinitions: new Map(),
    formSectionDefinitions: new Map(),
    workflowActionShareCodeDefinitions: new Map(),
    workflowControlShareCodeDefinitions: new Map(),
    workflowButtonShareCodeDefinitions: new Map(),
    workflowButtonShareCodeButtonIdents: new Map()
  };
}

function collectContributionNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<(?:Contribution|Section)\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const name = extractAttributeValue(attrs, "Name");
    if (!name) {
      continue;
    }
    out.add(name);
  }
  return out;
}

function collectComponentContributionSummaries(text: string): Map<string, import("../../indexer/types").IndexedComponentContributionSummary> {
  const out = new Map<string, import("../../indexer/types").IndexedComponentContributionSummary>();
  for (const match of text.matchAll(/<(Contribution|Section)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = match[2] ?? "";
    const body = match[3] ?? "";
    const name = extractAttributeValue(attrs, "Name");
    if (!name) {
      continue;
    }

    const rootRaw = (extractAttributeValue(attrs, "Root") ?? "").trim().toLowerCase();
    const root: import("../../indexer/types").IndexedComponentContributionSummary["root"] =
      rootRaw.length === 0 || rootRaw === "form" ? "form" : rootRaw === "workflow" ? "workflow" : "other";

    out.set(name, {
      contributionName: name,
      root,
      rootExpression: rootRaw.length > 0 ? rootRaw : undefined,
      insert: extractAttributeValue(attrs, "Insert"),
      targetXPath: extractAttributeValue(attrs, "TargetXPath"),
      allowMultipleInserts: parseBooleanAttribute(extractAttributeValue(attrs, "AllowMultipleInserts")),
      hasContent: body.trim().length > 0,
      formControlCount: countTagMatches(body, /<Control\b/gi),
      formButtonCount: countTagMatches(body, /<Button\b/gi),
      formSectionCount: countTagMatches(body, /<Section\b/gi),
      workflowActionShareCodeCount: countTagMatches(body, /<ActionShareCode\b/gi),
      workflowControlShareCodeCount: countTagMatches(body, /<ControlShareCode\b/gi),
      workflowButtonShareCodeCount: countTagMatches(body, /<ButtonShareCode\b/gi),
      formControlIdents: collectTagIdentSet(body, /<Control\b([^>]*)>/gi, "Ident"),
      formButtonIdents: collectTagIdentSet(body, /<Button\b([^>]*)>/gi, "Ident"),
      formSectionIdents: collectTagIdentSet(body, /<Section\b([^>]*)>/gi, "Ident"),
      workflowActionShareCodeIdents: collectTagIdentSet(body, /<ActionShareCode\b([^>]*)>/gi, "Ident"),
      workflowControlShareCodeIdents: collectTagIdentSet(body, /<ControlShareCode\b([^>]*)>/gi, "Ident"),
      workflowButtonShareCodeIdents: collectTagIdentSet(body, /<ButtonShareCode\b([^>]*)>/gi, "Ident"),
      workflowReferencedActionShareCodeIdents: collectActionShareCodeUsageSet(body)
    });
  }
  return out;
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function countTagMatches(body: string, regex: RegExp): number {
  let count = 0;
  for (const _ of body.matchAll(regex)) {
    count += 1;
  }
  return count;
}

function collectTagIdentSet(body: string, regex: RegExp, attrName: string): Set<string> {
  const out = new Set<string>();
  for (const match of body.matchAll(regex)) {
    const attrs = match[1] ?? "";
    const ident = extractAttributeValue(attrs, attrName);
    if (!ident) {
      continue;
    }
    out.add(ident);
  }
  return out;
}

function collectActionShareCodeUsageSet(body: string): Set<string> {
  const out = new Set<string>();
  for (const match of body.matchAll(/<Action\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const type = (extractAttributeValue(attrs, "xsi:type") ?? extractAttributeValue(attrs, "Type") ?? "").trim().toLowerCase();
    if (type !== "sharecode") {
      continue;
    }
    const ident = extractAttributeValue(attrs, "Ident");
    if (!ident) {
      continue;
    }
    out.add(ident);
  }
  return out;
}

function extractAttributeValue(attrs: string, attrName: string): string | undefined {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(attrs);
  const value = (match?.[1] ?? match?.[2] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

run();

