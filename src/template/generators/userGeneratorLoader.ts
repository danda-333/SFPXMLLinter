import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import {
  DocumentTemplateGenerator,
  LoadedTemplateGenerator,
  SnippetTemplateGenerator
} from "./types";

const SUPPORTED_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts"]);

export async function loadWorkspaceUserGenerators(
  workspaceRoot: string,
  roots: readonly string[],
  onLogLine?: (line: string) => void
): Promise<LoadedTemplateGenerator[]> {
  const files: string[] = [];
  for (const root of roots) {
    const absoluteRoot = path.resolve(workspaceRoot, root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      continue;
    }
    collectGeneratorFiles(absoluteRoot, files);
  }
  files.sort((a, b) => a.localeCompare(b));
  return loadUserGeneratorsFromFiles(files, onLogLine);
}

export async function loadUserGeneratorsFromFiles(
  files: readonly string[],
  onLogLine?: (line: string) => void
): Promise<LoadedTemplateGenerator[]> {
  const out: LoadedTemplateGenerator[] = [];
  for (const file of files) {
    try {
      const loaded = await loadSingleGenerator(file);
      if (!loaded) {
        continue;
      }
      out.push(loaded);
      if (loaded.kind === "snippet") {
        onLogLine?.(`[generator:user] loaded ${loaded.id} (snippet:${loaded.selector}) from ${file}`);
      } else {
        onLogLine?.(`[generator:user] loaded ${loaded.id} (document) from ${file}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLogLine?.(`[generator:user][warning] failed to load ${file}: ${message}`);
    }
  }
  return out;
}

async function loadSingleGenerator(filePath: string): Promise<LoadedTemplateGenerator | undefined> {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return undefined;
  }

  const rawModule = ext === ".ts"
    ? await loadTypeScriptModule(filePath)
    : ext === ".mjs"
      ? await import(pathToFileURL(filePath).href)
      : require(filePath);
  const mod = normalizeExport(rawModule);
  if (!mod || typeof mod !== "object") {
    return undefined;
  }

  const kindRaw = String((mod as { kind?: unknown }).kind ?? "document").toLowerCase();
  const kind = kindRaw === "snippet" ? "snippet" : "document";
  const run = (mod as { run?: unknown }).run;
  if (typeof run !== "function") {
    return undefined;
  }

  const id = String((mod as { id?: unknown }).id ?? path.basename(filePath, ext));
  const description = String((mod as { description?: unknown }).description ?? "User-defined template generator.");
  const appliesFn = (mod as { applies?: unknown }).applies;
  const applies = typeof appliesFn === "function"
    ? appliesFn
    : (() => true);

  if (kind === "snippet") {
    const selector = String(
      (mod as { selector?: unknown; useGenerator?: unknown }).selector
        ?? (mod as { selector?: unknown; useGenerator?: unknown }).useGenerator
        ?? ""
    ).trim();
    if (!selector) {
      throw new Error(`Snippet generator '${id}' is missing required 'selector'.`);
    }
    const snippetGenerator: SnippetTemplateGenerator = {
      kind: "snippet",
      id,
      description,
      selector,
      applies: (context) => Boolean((applies as (context: unknown) => unknown)(context)),
      run: (context) => {
        (run as (context: unknown) => unknown)(context);
      }
    };
    return snippetGenerator;
  }

  const documentGenerator: DocumentTemplateGenerator = {
    kind: "document",
    id,
    description,
    applies: (context) => Boolean((applies as (context: unknown) => unknown)(context)),
    run: (context) => {
      (run as (context: unknown) => unknown)(context);
    }
  };
  return documentGenerator;
}

function normalizeExport(mod: unknown): unknown {
  if (!mod || typeof mod !== "object") {
    return undefined;
  }
  const withDefault = mod as { default?: unknown };
  return withDefault.default ?? mod;
}

function collectGeneratorFiles(root: string, out: string[]): void {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectGeneratorFiles(full, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
}

async function loadTypeScriptModule(filePath: string): Promise<unknown> {
  const source = fs.readFileSync(filePath, "utf8");
  let typescript: { transpileModule: (code: string, options: unknown) => { outputText: string } } | undefined;
  try {
    const imported = await import("typescript");
    typescript = imported as unknown as { transpileModule: (code: string, options: unknown) => { outputText: string } };
  } catch {
    throw new Error("TypeScript generator requires 'typescript' package at runtime.");
  }

  const transpiled = typescript.transpileModule(source, {
    compilerOptions: {
      target: "ES2020",
      module: "CommonJS"
    },
    fileName: filePath
  });

  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    __filename: filePath,
    __dirname: path.dirname(filePath),
    console
  });
  const script = new vm.Script(transpiled.outputText, { filename: filePath });
  script.runInContext(context);
  return module.exports;
}

