import { strict as assert } from "node:assert";
import Module = require("node:module");
import { FactRegistry } from "../../core/facts/factRegistry";
import { registerDefaultFactsAndSymbols } from "../../core/facts/registerDefaultFactsAndSymbols";
import { SymbolRegistry } from "../../core/symbols/symbolRegistry";

class Position {
  public readonly line: number;
  public readonly character: number;
  public constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  public constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

const vscodeMock = {
  Position,
  Range
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

function run(): void {
  const factsByNode = new Map<string, ReturnType<typeof parseDocumentFactsFromText>>();
  const formNodeId = "file:///form.xml";
  const workflowNodeId = "file:///workflow.xml";

  factsByNode.set(
    formNodeId,
    parseDocumentFactsFromText(`
      <Form Ident="SampleForm">
        <Controls><Control Ident="AssignedTo"/></Controls>
        <Buttons><Button Ident="ResolveButton"/></Buttons>
        <Sections><Section Ident="ResolveDialogSection"/></Sections>
        <ControlShareCodes><ControlShareCode Ident="AssignedToControlSC"/></ControlShareCodes>
        <ActionShareCodes><ActionShareCode Ident="ResolveActionSC" /></ActionShareCodes>
        <ButtonShareCodes><ButtonShareCode Ident="ResolveButtonSC" /></ButtonShareCodes>
      </Form>
    `)
  );
  factsByNode.set(
    workflowNodeId,
    parseDocumentFactsFromText(`
      <WorkFlow FormIdent="SampleForm">
        <ControlShareCodes>
          <ControlShareCode Ident="AssignedToControlSC" />
        </ControlShareCodes>
        <ActionShareCodes>
          <ActionShareCode Ident="ResolveActionSC" />
        </ActionShareCodes>
        <ButtonShareCodes>
          <ButtonShareCode Ident="ResolveButtonSC" />
        </ButtonShareCodes>
        <Buttons>
          <Button Ident="ResolveButton" />
          <Button xsi:type="ShareCodeButton" Ident="ResolveButtonSC" />
        </Buttons>
        <Sections>
          <Section Ident="ResolveDialogSection" />
        </Sections>
        <FormControl Ident="AssignedTo" />
        <FormControl xsi:type="ShareCodeControl" Ident="AssignedToControlSC" />
      </WorkFlow>
    `)
  );

  const factRegistry = new FactRegistry();
  const symbolRegistry = new SymbolRegistry();
  registerDefaultFactsAndSymbols({
    factRegistry,
    symbolRegistry,
    resolveParsedFacts: (nodeId) => factsByNode.get(nodeId)
  });
  const missingDeps = factRegistry.getMissingDependencies();
  assert.equal(missingDeps.length, 0, `Unexpected fact provider dependency issues: ${JSON.stringify(missingDeps)}`);

  const rootMeta = factRegistry.getFact(formNodeId, "fact.rootMeta", "test:root") as
    | { rootTag?: string; formIdent?: string }
    | undefined;
  assert.equal(rootMeta?.rootTag, "Form");
  assert.equal(rootMeta?.formIdent, "SampleForm");
  const usingRefs = factRegistry.getFact(formNodeId, "fact.usingRefs", "test:usingRefs") as unknown[];
  const includeRefs = factRegistry.getFact(formNodeId, "fact.includeRefs", "test:includeRefs") as unknown[];
  const placeholderRefs = factRegistry.getFact(formNodeId, "fact.placeholderRefs", "test:placeholderRefs") as unknown[];
  const rangeIndex = factRegistry.getFact(formNodeId, "fact.rangeIndex", "test:rangeIndex") as { identOccurrences?: unknown[] } | undefined;
  assert.ok(Array.isArray(usingRefs));
  assert.ok(Array.isArray(includeRefs));
  assert.ok(Array.isArray(placeholderRefs));
  assert.ok(Array.isArray(rangeIndex?.identOccurrences));

  symbolRegistry.refreshNode(formNodeId);
  symbolRegistry.refreshNode(workflowNodeId);
  const formDefs = symbolRegistry.getDefs(formNodeId);
  const workflowDefs = symbolRegistry.getDefs(workflowNodeId);
  const workflowRefs = symbolRegistry.getRefs(workflowNodeId);

  assert.ok(formDefs.some((item) => item.key === "control:AssignedTo"));
  assert.ok(formDefs.some((item) => item.key === "button:ResolveButton"));
  assert.ok(formDefs.some((item) => item.key === "section:ResolveDialogSection"));
  assert.ok(workflowDefs.some((item) => item.key === "controlShareCode:AssignedToControlSC"));
  assert.ok(workflowDefs.some((item) => item.key === "actionShareCode:ResolveActionSC"));
  assert.ok(workflowDefs.some((item) => item.key === "buttonShareCode:ResolveButtonSC"));

  assert.ok(workflowRefs.some((item) => item.target === "control:AssignedTo"));
  assert.ok(workflowRefs.some((item) => item.target === "button:ResolveButton"));
  assert.ok(workflowRefs.some((item) => item.target === "section:ResolveDialogSection"));
  assert.ok(workflowRefs.some((item) => item.target === "controlShareCode:AssignedToControlSC"));
  assert.ok(workflowRefs.some((item) => item.target === "buttonShareCode:ResolveButtonSC"));

  const usage = factRegistry.getConsumerUsage();
  assert.ok(usage.some((item) => item.consumerId === "symbol:button:refs"));
  assert.ok(usage.some((item) => item.consumerId === "test:root"));
  console.log("\x1b[32mDefault facts/symbols bootstrap tests passed.\x1b[0m");
}

run();
