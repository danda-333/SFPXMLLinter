import * as fs from "fs";
import * as path from "path";
import { formatXmlTolerant } from "../../formatter";
import { FormatterOptions } from "../../formatter/types";

const fixturesDir = path.resolve(__dirname, "../../../tests/fixtures/formatter");

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
  if (!fs.existsSync(fixturesDir)) {
    throw new Error(`Fixtures directory not found: ${fixturesDir}`);
  }

  const inputFiles = fs
    .readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".input.xml"))
    .sort((a, b) => a.localeCompare(b));

  if (inputFiles.length === 0) {
    throw new Error("No formatter fixtures found.");
  }

  let failures = 0;
  let skipped = 0;
  for (const inputFile of inputFiles) {
    const base = inputFile.slice(0, -".input.xml".length);
    const expectedFile = `${base}.expected.xml`;
    const inputPath = path.join(fixturesDir, inputFile);
    const expectedPath = path.join(fixturesDir, expectedFile);
    if (!fs.existsSync(expectedPath)) {
      skipped++;
      console.warn(`SKIP: ${base} (missing ${expectedFile})`);
      continue;
    }

    const input = fs.readFileSync(inputPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    const actualOnce = formatXmlTolerant(input, options).text;
    const actualTwice = formatXmlTolerant(actualOnce, options).text;
    const expectedNorm = normalizeNewlines(expected);
    const onceOk = normalizeNewlines(actualOnce) === expectedNorm;
    const twiceOk = normalizeNewlines(actualTwice) === expectedNorm;

    if (!onceOk || !twiceOk) {
      failures++;
      console.error(`FAIL: ${base}`);
      const actualOutPath = path.join(fixturesDir, `${base}.actual.xml`);
      const actualTwiceOutPath = path.join(fixturesDir, `${base}.actual2.xml`);
      fs.writeFileSync(actualOutPath, actualOnce, "utf8");
      fs.writeFileSync(actualTwiceOutPath, actualTwice, "utf8");
      console.error(`  wrote actual output: ${actualOutPath}`);
      console.error(`  wrote second-pass output: ${actualTwiceOutPath}`);
    } else {
      console.log(`PASS: ${base}`);
    }
  }

  if (failures > 0) {
    throw new Error(`Formatter fixture test failed (${failures} case(s)).`);
  }

  console.log(`Formatter fixture test passed (${inputFiles.length - skipped} cases, skipped ${skipped}).`);
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

run();
