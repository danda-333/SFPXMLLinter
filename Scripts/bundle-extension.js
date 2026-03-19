/* eslint-disable no-console */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

async function main() {
  const root = process.cwd();
  const entry = path.join(root, "out", "extension.js");
  const outDir = path.join(root, "dist");
  const outFile = path.join(outDir, "extension.js");

  if (!fs.existsSync(entry)) {
    throw new Error(`Bundle entry not found: ${entry}. Run 'npm run compile' first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    external: ["vscode"],
    sourcemap: false,
    legalComments: "none",
    logLevel: "info"
  });

  console.log(`[bundle] created ${path.relative(root, outFile)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
