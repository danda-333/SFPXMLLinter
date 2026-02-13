import * as fs from "node:fs";
import * as path from "node:path";
import { buildComponentLibrary, normalizePath, renderTemplateText, stripXmlComponentExtension } from "../../template/buildXmlTemplatesCore";

const workspaceRoot = path.resolve(__dirname, "../../../");
const fixtureRoot = path.join(workspaceRoot, "tests", "fixtures", "template-builder");
const templatesRoot = path.join(fixtureRoot, "XML_Templates");
const componentsRoot = path.join(fixtureRoot, "XML_Components");
const runtimeRoot = path.join(fixtureRoot, "XML");
const actualRoot = path.join(fixtureRoot, "XML_actual");
const maxLoggedMismatches = 60;
const expectedDiffSet = new Set<string>();

function run(): void {
  if (!fs.existsSync(templatesRoot) || !fs.existsSync(componentsRoot) || !fs.existsSync(runtimeRoot)) {
    throw new Error("Template-builder fixture roots were not found (XML_Templates/XML_Components/XML).");
  }
  resetDirectory(actualRoot);

  const componentSources = collectFiles(componentsRoot, ".xml").map((filePath) => {
    const rel = normalizePath(path.relative(componentsRoot, filePath));
    return {
      key: stripXmlComponentExtension(rel),
      text: fs.readFileSync(filePath, "utf8"),
      origin: filePath
    };
  });

  const library = buildComponentLibrary(componentSources);
  const templateFiles = collectFiles(templatesRoot, ".xml");

  let failures = 0;
  let checked = 0;
  let expectedDiffsSeen = 0;
  for (const templateFile of templateFiles) {
    const rel = normalizePath(path.relative(templatesRoot, templateFile));
    const expectedRuntimePath = path.join(runtimeRoot, rel);
    if (!fs.existsSync(expectedRuntimePath)) {
      continue;
    }
    checked++;

    const templateText = fs.readFileSync(templateFile, "utf8");
    const expectedText = fs.readFileSync(expectedRuntimePath, "utf8");
    const actualText = renderTemplateText(templateText, library);
    const actualOutputPath = path.join(actualRoot, rel);
    fs.mkdirSync(path.dirname(actualOutputPath), { recursive: true });
    fs.writeFileSync(actualOutputPath, actualText, "utf8");

    const isExpectedDiff = expectedDiffSet.has(rel);

    if (normalize(expectedText) === normalize(actualText)) {
      if (isExpectedDiff) {
        failures++;
        console.error(`FAIL: ${rel}`);
        if (failures <= maxLoggedMismatches) {
          console.error(`  expected difference was NOT found (file now matches).`);
        }
        continue;
      }
      console.log(`PASS: ${rel}`);
      continue;
    }

    if (isExpectedDiff) {
      expectedDiffsSeen++;
      console.log(`PASS (expected-diff): ${rel}`);
      continue;
    }

    failures++;
    if (failures <= maxLoggedMismatches) {
      console.error(`FAIL: ${rel}`);
      console.error(`  output differs from expected runtime XML.`);
    } else if (failures === maxLoggedMismatches + 1) {
      console.error(`... more FAIL entries omitted (>${maxLoggedMismatches}) ...`);
    }
  }

  if (failures > 0) {
    throw new Error(
      `Template builder fixture test failed (${failures} case(s), checked ${checked}, expectedDiffsSeen ${expectedDiffsSeen}/${expectedDiffSet.size}).`
    );
  }

  if (expectedDiffsSeen !== expectedDiffSet.size) {
    throw new Error(
      `Template builder fixture test failed: expected diff count mismatch (${expectedDiffsSeen}/${expectedDiffSet.size}, checked ${checked}).`
    );
  }

  console.log(
    `Template builder fixture test passed (${checked} templates checked, expectedDiffs ${expectedDiffsSeen}/${expectedDiffSet.size}, outputs in XML_actual).`
  );
}

function collectFiles(root: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && full.toLowerCase().endsWith(ext)) {
        out.push(full);
      }
    }
  };
  walk(root);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalize(value: string): string {
  let out = value.replace(/\r\n/g, "\n");

  // Compare SQL/HTML payload equivalently whether wrapped in CDATA or not.
  out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  // Compare XML tags by semantic form (normalized whitespace/attribute spacing).
  out = out.replace(/<\/?[\w:.-]+(?:\s+[^<>]*?)?\s*\/?>/g, (tag) => normalizeTagForComparison(tag));

  // Compare escaped and non-escaped text content equivalently (e.g. script bodies).
  out = decodeXmlEntitiesForComparison(out);

  // Ignore pure indentation/blank-line differences in fixture parity checks.
  const lines = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.join("\n").trimEnd();
}

function decodeXmlEntitiesForComparison(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeTagForComparison(tag: string): string {
  if (tag.startsWith("<?") || tag.startsWith("<!") || tag.startsWith("<!--")) {
    return tag;
  }

  const isClosing = /^<\s*\//.test(tag);
  const isSelfClosing = /\/\s*>$/.test(tag);
  const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag);
  const name = nameMatch?.[1] ?? "";
  if (!name) {
    return tag;
  }

  if (isClosing) {
    return `</${name}>`;
  }

  const attrs: string[] = [];
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }
    if (typeof match[2] === "string") {
      attrs.push(`${key}="${match[2]}"`);
      continue;
    }
    attrs.push(`${key}='${match[3] ?? ""}'`);
  }

  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (isSelfClosing) {
    return `<${name}${attrText}/>`;
  }
  return `<${name}${attrText}>`;
}

function resetDirectory(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

run();
