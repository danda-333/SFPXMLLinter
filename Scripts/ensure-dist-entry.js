const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const distDir = path.join(root, "dist");
const distEntry = path.join(distDir, "extension.js");
const shim = "module.exports = require('../out/extension.js');\n";

fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(distEntry) || fs.readFileSync(distEntry, "utf8") !== shim) {
  fs.writeFileSync(distEntry, shim, "utf8");
  console.log(`[dist] ensured ${path.relative(root, distEntry)}`);
}
