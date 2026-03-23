import { strict as assert } from "node:assert";
import { resolveDocumentFacts } from "../../core/model/factsResolution";

type MockUri = { toString: () => string };
type MockDocument = { uri: MockUri };

function createDoc(uri = "file:///test.xml"): MockDocument {
  return {
    uri: { toString: () => uri }
  };
}

function runFactsResolutionTests(): void {
  const document = createDoc();

  {
    const value = resolveDocumentFacts(
      document as unknown as import("vscode").TextDocument,
      {},
      {
        getFactsForDocument: () => undefined,
        parseFacts: () => ({ source: "parse" }),
        mode: "strict-accessor"
      }
    );
    assert.equal(value, undefined, "strict-accessor must not parse when document accessor exists but returns undefined");
  }

  {
    const value = resolveDocumentFacts(
      document as unknown as import("vscode").TextDocument,
      {},
      {
        getFactsForDocument: () => undefined,
        parseFacts: () => ({ source: "parse" }),
        mode: "fallback-parse"
      }
    );
    assert.deepEqual(value, { source: "parse" }, "fallback-parse should parse when accessor returns undefined");
  }

  {
    const value = resolveDocumentFacts(
      document as unknown as import("vscode").TextDocument,
      {},
      {
        parseFacts: () => ({ source: "parse" }),
        mode: "strict-accessor"
      }
    );
    assert.deepEqual(value, { source: "parse" }, "parse fallback should be used when no accessors are provided");
  }

  {
    const value = resolveDocumentFacts(
      document as unknown as import("vscode").TextDocument,
      { key: "index" },
      {
        getFactsForUri: (uri, index) => ({
          source: "uri",
          uri: uri.toString(),
          indexKey: (index as { key: string }).key
        }),
        parseFacts: () => ({ source: "parse" }),
        mode: "strict-accessor"
      }
    );
    assert.deepEqual(value, {
      source: "uri",
      uri: "file:///test.xml",
      indexKey: "index"
    });
  }

  console.log("Facts resolution tests passed.");
}

runFactsResolutionTests();

