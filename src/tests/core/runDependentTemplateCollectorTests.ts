import { strict as assert } from "node:assert";
import { collectDependentTemplatePathsFromIndex } from "../../core/template/dependentTemplateCollector";
import { WorkspaceIndex } from "../../indexer/types";
import { ParsedDocumentFacts } from "../../indexer/xmlFacts";

function run(): void {
  testIncludesWorkflowAndDataViewWhenComponentBecomesFormOnly();
  console.log("Dependent template collector tests passed.");
}

function testIncludesWorkflowAndDataViewWhenComponentBecomesFormOnly(): void {
  const formPath = "C:\\repo\\XML_Templates\\100_Sample\\Sample.xml";
  const workflowPath = "C:\\repo\\XML_Templates\\100_Sample\\SampleWorkFlow.xml";
  const dataviewPath = "C:\\repo\\XML_Templates\\100_Sample\\view\\SampleAllView.xml";

  const componentKey = "Common/RecategarizationActions";

  const formFacts = createFacts({
    rootTag: "Form",
    formIdent: "Sample",
    usingComponentKeys: [componentKey]
  });

  const workflowFacts = createFacts({
    rootTag: "WorkFlow",
    workflowFormIdent: "Sample"
  });

  const dataviewFacts = createFacts({
    rootTag: "DataView",
    rootFormIdent: "Sample"
  });

  const index = createEmptyIndex();
  index.parsedFactsByUri.set(formPath, formFacts);
  index.parsedFactsByUri.set(workflowPath, workflowFacts);
  index.parsedFactsByUri.set(dataviewPath, dataviewFacts);
  index.componentKeysByBaseName.set("RecategarizationActions", new Set([componentKey]));

  const actual = collectDependentTemplatePathsFromIndex(index, componentKey);

  assert.deepEqual(
    actual.sort((a, b) => a.localeCompare(b)),
    [dataviewPath, formPath, workflowPath].sort((a, b) => a.localeCompare(b)),
    "Collector must include sibling WorkFlow/DataView templates for affected Form when component changes."
  );
  console.log("PASS: include-workflow-dataview-for-affected-form");
}

function createEmptyIndex(): WorkspaceIndex {
  return {
    formsByIdent: new Map(),
    formIdentByUri: new Map(),
    componentsByKey: new Map(),
    componentKeyByUri: new Map(),
    componentKeysByBaseName: new Map(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    builtSymbolProvidersByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

function createFacts(input: {
  rootTag: string;
  formIdent?: string;
  rootFormIdent?: string;
  workflowFormIdent?: string;
  usingComponentKeys?: readonly string[];
}): ParsedDocumentFacts {
  const usingReferences = (input.usingComponentKeys ?? []).map((key) => ({
    rawComponentValue: key,
    componentKey: key,
    componentValueRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    sectionValue: undefined,
    sectionValueRange: undefined,
    suppressInheritance: false,
    attributes: []
  }));

  return {
    rootTag: input.rootTag,
    formIdent: input.formIdent,
    rootFormIdent: input.rootFormIdent,
    workflowFormIdent: input.workflowFormIdent,
    declaredControls: new Set<string>(),
    declaredButtons: new Set<string>(),
    declaredSections: new Set<string>(),
    workflowReferences: [],
    usingReferences: usingReferences as any,
    includeReferences: [],
    usingContributionInsertCounts: new Map<string, number>(),
    usingContributionInsertTraces: new Map<string, any>(),
    placeholderReferences: [],
    formIdentReferences: [],
    mappingIdentReferences: [],
    mappingFormIdentReferences: [],
    requiredActionIdentReferences: [],
    workflowControlIdentReferences: [],
    htmlControlReferences: [],
    identOccurrences: [],
    declaredControlShareCodes: new Set<string>(),
    controlShareCodeDefinitions: new Map(),
    declaredActionShareCodes: new Set<string>(),
    actionShareCodeDefinitions: new Map(),
    declaredButtonShareCodes: new Set<string>(),
    buttonShareCodeDefinitions: new Map(),
    buttonShareCodeButtonIdents: new Map(),
    actionShareCodeReferences: [] as any,
    declaredControlInfos: [] as any,
    declaredButtonInfos: [] as any,
    rootControlScopeKeys: new Set<string>(),
    rootButtonScopeKeys: new Set<string>(),
    rootSectionScopeKeys: new Set<string>()
  } as ParsedDocumentFacts;
}

run();
