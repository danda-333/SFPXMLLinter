import * as fs from "node:fs";
import * as path from "node:path";
import { buildComponentLibrary, normalizePath, renderTemplateText, stripXmlComponentExtension } from "../../template/buildXmlTemplatesCore";
import { applyTemplateOutputQuality } from "../../template/outputQuality";
import { runTemplateGenerators } from "../../template/generators";
import { loadWorkspaceUserGenerators } from "../../template/generators/userGeneratorLoader";

const workspaceRoot = path.resolve(__dirname, "../../../");
const fixtureRoot = path.join(workspaceRoot, "tests", "fixtures", "template-builder");
const templatesRoot = path.join(fixtureRoot, "XML_Templates");
const componentsRoot = path.join(fixtureRoot, "XML_Components");
const primitivesRoot = path.join(fixtureRoot, "XML_Primitives");
const runtimeRoot = path.join(fixtureRoot, "XML");
const actualRoot = path.join(fixtureRoot, "XML_actual");
const maxLoggedMismatches = 60;
const expectedDiffSet = new Set<string>();

async function run(): Promise<void> {
  if (!fs.existsSync(templatesRoot) || !fs.existsSync(componentsRoot) || !fs.existsSync(runtimeRoot)) {
    throw new Error("Template-builder fixture roots were not found (XML_Templates/XML_Components/XML).");
  }
  resetDirectory(actualRoot);

  const componentAndPrimitiveFiles = [
    ...collectFiles(componentsRoot, ".xml"),
    ...(fs.existsSync(primitivesRoot) ? collectFiles(primitivesRoot, ".xml") : [])
  ];

  const componentSources = componentAndPrimitiveFiles.map((filePath) => {
    const sourceRoot = filePath.startsWith(primitivesRoot) ? primitivesRoot : componentsRoot;
    const normalizedRel = sourceRoot === primitivesRoot
      ? normalizePath(path.relative(primitivesRoot, filePath))
      : normalizePath(path.relative(componentsRoot, filePath));
    return {
      key: stripXmlComponentExtension(normalizedRel),
      text: fs.readFileSync(filePath, "utf8"),
      origin: filePath
    };
  });

  const library = buildComponentLibrary(componentSources);
  const userGenerators = await loadWorkspaceUserGenerators(fixtureRoot, ["XML_Generators"]);
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
    const rendered = renderTemplateText(templateText, library);
    const actualText = runTemplateGenerators(
      {
        xml: rendered,
        sourceTemplateText: templateText,
        relativeTemplatePath: rel,
        mode: "debug"
      },
      {
        enabled: true,
        timeoutMs: 300,
        userGenerators
      }
    ).xml;
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

  const qualityScenarioFailures = runOutputQualityFixtureScenarios(templateFiles, library, userGenerators);
  if (qualityScenarioFailures > 0) {
    throw new Error(`Template builder output quality fixture scenario failed (${qualityScenarioFailures} case(s)).`);
  }
  const generatorScenarioFailures = runGeneratorFixtureScenarios(templateFiles, library, userGenerators);
  if (generatorScenarioFailures > 0) {
    throw new Error(`Template builder generator fixture scenario failed (${generatorScenarioFailures} case(s)).`);
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

function runGeneratorFixtureScenarios(
  templateFiles: readonly string[],
  library: ReturnType<typeof buildComponentLibrary>,
  userGenerators: Parameters<typeof runTemplateGenerators>[1]["userGenerators"]
): number {
  let failures = 0;
  const sampleRelative = "999_T11GeneratorDemo/T11GeneratorDemoWorkFlow.xml";
  const templatePath = templateFiles.find(
    (filePath) => normalizePath(path.relative(templatesRoot, filePath)) === sampleRelative
  );
  if (!templatePath) {
    console.error(`FAIL (generator): missing required fixture '${sampleRelative}'.`);
    return 1;
  }

  const templateText = fs.readFileSync(templatePath, "utf8");
  const rendered = renderTemplateText(templateText, library);
  const run1 = runTemplateGenerators(
    {
      xml: rendered,
      sourceTemplateText: templateText,
      relativeTemplatePath: sampleRelative,
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators
    }
  );
  const run2 = runTemplateGenerators(
    {
      xml: run1.xml,
      sourceTemplateText: templateText,
      relativeTemplatePath: sampleRelative,
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators
    }
  );

  if (!run1.appliedGeneratorIds.includes("lift-repeated-actions-to-sharecode")) {
    failures++;
    console.error("FAIL (generator): expected lift-repeated-actions-to-sharecode to be applied.");
  }
  if (!run1.xml.includes("<ActionShareCode Ident=\"AutoLiftActionShareCode1\">")) {
    failures++;
    console.error("FAIL (generator): generated ActionShareCode block is missing.");
  }
  if (run2.xml !== run1.xml || run2.appliedGeneratorIds.length !== 0) {
    failures++;
    console.error("FAIL (generator): generator output is not idempotent.");
  }

  if (failures === 0) {
    console.log("PASS (generator): fixture-workflow-lift-and-idempotence");
  }
  return failures;
}

function runOutputQualityFixtureScenarios(
  templateFiles: readonly string[],
  library: ReturnType<typeof buildComponentLibrary>,
  userGenerators: Parameters<typeof runTemplateGenerators>[1]["userGenerators"]
): number {
  const scenarioRoot = path.join(actualRoot, "_quality_fileComment");
  resetDirectory(scenarioRoot);
  const sample = templateFiles.slice(0, Math.min(30, templateFiles.length));
  let failures = 0;

  for (const templateFile of sample) {
    const rel = normalizePath(path.relative(templatesRoot, templateFile));
    const templateText = fs.readFileSync(templateFile, "utf8");
    const rendered = renderTemplateText(templateText, library);
    const generated = runTemplateGenerators(
      {
        xml: rendered,
        sourceTemplateText: templateText,
        relativeTemplatePath: rel,
        mode: "debug"
      },
      {
        enabled: true,
        timeoutMs: 300,
        userGenerators
      }
    ).xml;
    const quality = applyTemplateOutputQuality(generated, templateText, {
      postBuildFormat: true,
      provenanceMode: "fileComment",
      provenanceLabel: "fixture",
      relativeTemplatePath: rel,
      formatterMaxConsecutiveBlankLines: 2
    });

    const outPath = path.join(scenarioRoot, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, quality, "utf8");

    const marker = `<!-- Template builder: fixture - ${rel} -->`;
    if (!quality.includes(marker)) {
      failures++;
      console.error(`FAIL (quality): ${rel}`);
      console.error("  missing provenance marker.");
      continue;
    }

    if (/<\?xml\b/i.test(templateText)) {
      if (!/^\s*<\?xml\b[\s\S]*?\?>\s*\r?\n\s*<!-- Template builder:/i.test(quality)) {
        failures++;
        console.error(`FAIL (quality): ${rel}`);
        console.error("  provenance marker should be directly after XML declaration.");
        continue;
      }
    }

    const templateCdataCount = (templateText.match(/<!\[CDATA\[/g) ?? []).length;
    const qualityCdataCount = (quality.match(/<!\[CDATA\[/g) ?? []).length;
    if (qualityCdataCount < templateCdataCount) {
      failures++;
      console.error(`FAIL (quality): ${rel}`);
      console.error(`  CDATA count regressed (${qualityCdataCount} < ${templateCdataCount}).`);
      continue;
    }

    console.log(`PASS (quality): ${rel}`);
  }

  return failures;
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

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
