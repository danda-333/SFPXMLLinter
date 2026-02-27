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

    if (expectedText === actualText) {
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

function resetDirectory(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

run();
