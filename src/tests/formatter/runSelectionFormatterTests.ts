import * as fs from "fs";
import * as path from "path";
import { formatXmlTolerant } from "../../formatter";
import { formatXmlSelectionWithContext } from "../../formatter/selection";
import { FormatterOptions } from "../../formatter/types";

const options: FormatterOptions = {
  indentUnit: "  ",
  lineEnding: "\n",
  tabSize: 2,
  insertSpaces: true,
  maxConsecutiveBlankLines: 2,
  forceInlineAttributes: true,
  typeAttributeFirst: true
};

function run(): void {
  testSelectionMatchesFullDocumentFormatting();
  testNestedSelectionMatchesFullDocumentFormatting();
  testSelection2to4KeepsClosingTagIndentExact();
  testSelection4to6KeepsClosingTagIndentExact();
  testSelectionWithContainerStartOnlyKeepsInnerIndent();
  testSelectionWithClosingTailKeepsIndent();
  testSelectionWithPartialEdgeRangeKeepsFormatting();
  testSelectionWithExpandedTagsLineRanges();
  testSelectionDoesNotAppendTrailingNewline();
  testSelectionCrLfWholeLineDoesNotAddNewline();
  testSelectionInMiddleKeepsFollowingContentStable();
  testR01SelectionsKeepBaselineFormatting();
  console.log("Selection formatter tests passed.");
}

function testSelection2to4KeepsClosingTagIndentExact(): void {
  const source = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join(
    "\n"
  );
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };

  const lines = source.split("\n");
  const start = lines[0].length + 1; // line 2 start
  const end = start + lines[1].length + 1 + lines[2].length + 1 + lines[3].length; // line 4 end
  const selected = formatXmlSelectionWithContext(source, start, end, localOptions);
  const patched = source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
  const expected = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join("\n");
  assertEqual(patched, expected, "selection 2-4 changed closing tag indentation");
}

function testSelection4to6KeepsClosingTagIndentExact(): void {
  const source = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join(
    "\n"
  );
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };

  const lines = source.split("\n");
  const lineStart = (lineZeroBased: number): number => {
    let offset = 0;
    for (let i = 0; i < lineZeroBased; i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  };

  // Partial selection edges (inside line 4 and inside line 6), not exact line boundaries.
  const start = lineStart(3) + 3;
  const end = lineStart(5) + 2;
  const selected = formatXmlSelectionWithContext(source, start, end, localOptions);
  const patched = source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
  const expected = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join("\n");
  assertEqual(patched, expected, "selection 4-6 changed closing tag indentation");
}

function testSelectionMatchesFullDocumentFormatting(): void {
  const source = [
    "<Root>",
    "  <A1>",
    "    <B1>",
    "<CC   z=\"1\"   xsi:type=\"X\" ></CC>",
    "    </B1>",
    "  </A1>",
    "</Root>"
  ].join("\n");

  const start = source.indexOf("<CC");
  const end = source.indexOf("</CC>") + "</CC>".length;
  assert(start >= 0 && end > start, "selection offsets not found");

  const selected = formatXmlSelectionWithContext(source, start, end, options);
  const patched = source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
  const expected = formatXmlTolerant(source, options).text;
  assertEqual(patched, expected, "single-line nested selection should match full-document format");
}

function testNestedSelectionMatchesFullDocumentFormatting(): void {
  const source = [
    "<Root>",
    "  <Outer>",
    "    <Inner>",
    " <C1>",
    "<string>  value </string>",
    " </C1>",
    "    </Inner>",
    "  </Outer>",
    "</Root>"
  ].join("\n");

  const start = source.indexOf(" <C1>");
  const end = source.indexOf(" </C1>") + " </C1>".length;
  assert(start >= 0 && end > start, "nested selection offsets not found");

  const selected = formatXmlSelectionWithContext(source, start, end, options);
  const patched = source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
  const expected = formatXmlTolerant(source, options).text;
  assertEqual(patched, expected, "multi-line nested selection should match full-document format");
}

function testSelectionWithContainerStartOnlyKeepsInnerIndent(): void {
  const source = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join(
    "\n"
  );
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };

  const baseline = formatXmlTolerant(source, localOptions).text;
  const lines = baseline.split("\n");
  const start = lines[0].length + 1;
  const end = start + lines[1].length + 1 + lines[2].length + 1 + lines[3].length;
  const selected = formatXmlSelectionWithContext(baseline, start, end, localOptions);
  const patched = baseline.slice(0, selected.rangeStart) + selected.text + baseline.slice(selected.rangeEnd);
  assertEqual(patched, baseline, "selection with only opening container in range changed inner indentation");
}

function testSelectionWithClosingTailKeepsIndent(): void {
  const source = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join(
    "\n"
  );
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };

  const baseline = formatXmlTolerant(source, localOptions).text;
  const lines = baseline.split("\n");
  // 1-based lines 4-6
  const start = lines[0].length + 1 + lines[1].length + 1 + lines[2].length + 1;
  const end = baseline.length;
  const selected = formatXmlSelectionWithContext(baseline, start, end, localOptions);
  const patched = baseline.slice(0, selected.rangeStart) + selected.text + baseline.slice(selected.rangeEnd);
  assertEqual(patched, baseline, "selection with closing tail in range changed indentation");
}

function testSelectionWithPartialEdgeRangeKeepsFormatting(): void {
  const source = ["<A>", "\t<B>", "\t\t<String>ISToProductionEvidence</String>", "\t\t<String>ISToProductionEvidenceAdmin</String>", "\t</B>", "</A>"].join(
    "\n"
  );
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };
  const baseline = formatXmlTolerant(source, localOptions).text;
  const lines = baseline.split("\n");
  const lineStart = (line: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  };

  const start = lineStart(1) + 2; // inside line 2
  const end = lineStart(3) + 10; // inside line 4
  const selected = formatXmlSelectionWithContext(baseline, start, end, localOptions);
  const patched = baseline.slice(0, selected.rangeStart) + selected.text + baseline.slice(selected.rangeEnd);
  assertEqual(patched, baseline, "selection with partial first/last line changed formatting");
}

function testSelectionWithExpandedTagsLineRanges(): void {
  const source = [
    "<A>",
    "\t<B>",
    "\t\t<String>",
    "\t\t\tISToProductionEvidence",
    "\t\t</String>",
    "\t\t<String>",
    "\t\t\tISToProductionEvidenceAdmin",
    "\t\t</String>",
    "\t</B>",
    "</A>"
  ].join("\n");
  const localOptions: FormatterOptions = {
    ...options,
    indentUnit: "\t",
    insertSpaces: false
  };
  const baseline = formatXmlTolerant(source, localOptions).text;

  // Scenario A: lines 2-4 (1-based), i.e. only opening part of <B> subtree.
  const afterA = applyLineRangeSelectionFormat(baseline, localOptions, 2, 4);
  assertEqual(afterA, baseline, "expanded-tags selection 2-4 changed formatting");

  // Scenario B: lines 4-6 (1-based), i.e. tail/middle cross-section.
  const afterB = applyLineRangeSelectionFormat(baseline, localOptions, 4, 6);
  assertEqual(afterB, baseline, "expanded-tags selection 4-6 changed formatting");
}

function testSelectionDoesNotAppendTrailingNewline(): void {
  const source = [
    "<Root>",
    "  <A1>",
    "    <B1 attr = \"x\"></B1>",
    "  </A1>",
    "</Root>"
  ].join("\n");

  const start = source.indexOf("<B1");
  const end = source.indexOf("</B1>") + "</B1>".length;
  const selected = formatXmlSelectionWithContext(source, start, end, options);
  if (selected.text.endsWith("\n") || selected.text.endsWith("\r\n")) {
    throw new Error("selection formatter appended trailing newline");
  }
}

function testSelectionCrLfWholeLineDoesNotAddNewline(): void {
  const sourceRaw = [
    "<DataView>",
    "  <AccessPermissions>",
    "    <string>ISToProductionEvidence</string>",
    "    <string>ISToProductionEvidenceAdmin</string>",
    "  </AccessPermissions>",
    "\t<Settings>",
    "    <dvs:Setting xsi:type=\"dvs:DataTableSetting\" IsResponsive=\"false\" IsClassicPaging=\"true\" />",
    "\t\t",
    "\t</Settings>",
    "\t",
    "\t",
    "\t",
    "\t",
    "</DataView>"
  ].join("\r\n");
  const localOptions: FormatterOptions = {
    ...options,
    lineEnding: "\r\n",
    indentUnit: "\t",
    insertSpaces: false
  };
  const source = formatXmlTolerant(sourceRaw, localOptions).text;

  const lineStartMarker = "<dvs:Setting";
  const lineStart = source.indexOf(lineStartMarker);
  assert(lineStart >= 0, "CRLF test line start not found");
  const nextLineStart = source.indexOf("\r\n", lineStart) + 2;
  assert(nextLineStart > lineStart, "CRLF test next line start not found");

  const selected = formatXmlSelectionWithContext(source, lineStart, nextLineStart, localOptions);

  const patched = source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
  assertEqual(patched, source, "CRLF whole-line selection changed baseline (likely appended newline)");
}

function testSelectionInMiddleKeepsFollowingContentStable(): void {
  const source = [
    "<Root>",
    "  <Header attr = \"x\"></Header>",
    "  <Target>",
    "    <A1></A1>",
    "  </Target>",
    "  <After>",
    "    <B1></B1>",
    "  </After>",
    "</Root>"
  ].join("\n");

  const baseline = formatXmlTolerant(source, options).text;
  const startMarker = "  <Target>";
  const endMarker = "  </Target>";
  const start = baseline.indexOf(startMarker);
  const end = baseline.indexOf(endMarker, start) + endMarker.length;
  assert(start >= 0 && end > start, "middle selection offsets not found");
  assert(end < baseline.length - 10, "selection unexpectedly reaches document end");

  const selected = formatXmlSelectionWithContext(baseline, start, end, options);
  const patched = baseline.slice(0, selected.rangeStart) + selected.text + baseline.slice(selected.rangeEnd);
  assertEqual(patched, baseline, "selection in document middle changed following content");
}

function testR01SelectionsKeepBaselineFormatting(): void {
  const fixturePath = path.resolve(__dirname, "../../../tests/fixtures/formatter/r01.input.xml");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture: ${fixturePath}`);
  }

  const source = fs.readFileSync(fixturePath, "utf8");
  const baseline = formatXmlTolerant(source, options).text;
  let current = baseline;

  const selections: SelectionSpec[] = [
    {
      name: "state-inline-comment-line",
      startMarker: "<State Value=\"0\"",
      endMarker: "<!-- Deleted :"
    },
    {
      name: "global-javascripts-block",
      startMarker: "<GlobalJavaScripts>",
      endMarker: "</GlobalJavaScripts>"
    },
    {
      name: "action-share-code-block",
      startMarker: "<ActionShareCode Ident=\"SaveFirstStateButtonActionShare\">",
      endMarker: "</ActionShareCode>"
    },
    {
      name: "sql-cdata-block",
      startMarker: "<SQL><![CDATA[",
      endMarker: "]]></SQL>",
      startOccurrence: 2
    },
    {
      name: "button-share-code-block",
      startMarker: "<ButtonShareCode Ident=\"SaveButtonShare\">",
      endMarker: "</ButtonShareCode> <!-- <Button xsi:type=\"ShareCodeButton\" Ident=\"SaveButtonShare\" /> -->"
    }
  ];

  for (const selection of selections) {
    const range = findRangeByMarkers(current, selection);
    assert(range.end < current.length - 10, `selection '${selection.name}' unexpectedly reaches document end`);
    const result = formatXmlSelectionWithContext(current, range.start, range.end, options);
    current = current.slice(0, result.rangeStart) + result.text + current.slice(result.rangeEnd);
    assertEqual(
      current,
      baseline,
      `r01 selection formatting diverged after '${selection.name}' at range ${result.rangeStart}-${result.rangeEnd}`
    );
  }
}

interface SelectionSpec {
  name: string;
  startMarker: string;
  endMarker: string;
  startOccurrence?: number;
}

function findRangeByMarkers(source: string, spec: SelectionSpec): { start: number; end: number } {
  const start = indexOfOccurrence(source, spec.startMarker, spec.startOccurrence ?? 1);
  if (start < 0) {
    throw new Error(`Selection '${spec.name}': start marker not found: ${spec.startMarker}`);
  }

  const endStart = source.indexOf(spec.endMarker, start);
  if (endStart < 0) {
    throw new Error(`Selection '${spec.name}': end marker not found after start: ${spec.endMarker}`);
  }

  return {
    start,
    end: endStart + spec.endMarker.length
  };
}

function indexOfOccurrence(source: string, marker: string, occurrence: number): number {
  let from = 0;
  for (let i = 1; i <= occurrence; i++) {
    const at = source.indexOf(marker, from);
    if (at < 0) {
      return -1;
    }
    if (i === occurrence) {
      return at;
    }
    from = at + marker.length;
  }
  return -1;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: string, expected: string, message: string): void {
  const a = normalize(actual);
  const e = normalize(expected);
  if (a !== e) {
    const at = firstDiffIndex(a, e);
    throw new Error(
      `${message}\nfirst diff at index ${at}\nexpected: ${JSON.stringify(e.slice(at, at + 120))}\nactual:   ${JSON.stringify(a.slice(at, at + 120))}`
    );
  }
}

function firstDiffIndex(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return min;
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function applyLineRangeSelectionFormat(
  source: string,
  localOptions: FormatterOptions,
  startLineOneBased: number,
  endLineOneBased: number
): string {
  const lines = source.split("\n");
  const lineStart = (lineZeroBased: number): number => {
    let offset = 0;
    for (let i = 0; i < lineZeroBased; i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  };

  const start = lineStart(startLineOneBased - 1);
  const end = lineStart(endLineOneBased - 1) + lines[endLineOneBased - 1].length;
  const selected = formatXmlSelectionWithContext(source, start, end, localOptions);
  return source.slice(0, selected.rangeStart) + selected.text + source.slice(selected.rangeEnd);
}

run();
