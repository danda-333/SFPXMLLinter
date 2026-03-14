import { applyXPathInsert, XPathInsertMode } from "../buildXmlTemplatesCore";
import { parseAttributes, xmlHelpers } from "./helpers";
import {
  DocumentGeneratorContext,
  DocumentTemplateGenerator,
  GeneratorDocumentHandle,
  LoadedTemplateGenerator,
  SnippetBlock,
  SnippetGeneratorContext,
  SnippetTemplateGenerator,
  TemplateGeneratorExecutionOptions,
  TemplateGeneratorExecutionReport,
  TemplateGeneratorInput,
  TemplateGeneratorWarning
} from "./types";

interface MutableState {
  xml: string;
}

export function runTemplateGenerators(
  input: TemplateGeneratorInput,
  options: TemplateGeneratorExecutionOptions,
  onLogLine?: (line: string) => void
): TemplateGeneratorExecutionReport {
  if (!options.enabled) {
    return {
      xml: input.xml,
      durationMs: 0,
      appliedGeneratorIds: [],
      warnings: []
    };
  }

  const generators = getEnabledGenerators(options);
  if (generators.length === 0) {
    return {
      xml: input.xml,
      durationMs: 0,
      appliedGeneratorIds: [],
      warnings: []
    };
  }

  const documentGenerators = generators.filter((item): item is DocumentTemplateGenerator => item.kind === "document");
  const snippetGenerators = generators.filter((item): item is SnippetTemplateGenerator => item.kind === "snippet");
  const snippetBySelector = new Map<string, SnippetTemplateGenerator>();
  for (const generator of snippetGenerators) {
    snippetBySelector.set(generator.selector, generator);
  }

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(10, options.timeoutMs);
  const appliedGeneratorIds: string[] = [];
  const warnings: TemplateGeneratorWarning[] = [];
  const state: MutableState = { xml: input.xml };
  const unmatchedSnippetSelectors = new Set<string>();

  for (const generator of documentGenerators) {
    if (Date.now() > deadline) {
      warnings.push({
        code: "generator-timeout",
        message: `Generator execution timeout reached before '${generator.id}'.`
      });
      break;
    }

    const before = state.xml;
    const context = createDocumentContext(input, state, warnings, onLogLine);
    if (generator.applies && !safeAppliesDocument(generator, context, warnings)) {
      continue;
    }

    const generatorStartedAt = Date.now();
    safeRunDocument(generator, context, warnings);
    const generatorDuration = Date.now() - generatorStartedAt;
    if (state.xml !== before) {
      appliedGeneratorIds.push(generator.id);
      onLogLine?.(`[generator] ${generator.id}: changed (duration=${generatorDuration} ms)`);
    } else if (input.mode === "debug") {
      onLogLine?.(`[generator] ${generator.id}: no-op (duration=${generatorDuration} ms)`);
    }
  }

  if (Date.now() <= deadline && snippetGenerators.length > 0) {
    processSnippetGenerators(
      input,
      state,
      snippetBySelector,
      warnings,
      appliedGeneratorIds,
      unmatchedSnippetSelectors,
      deadline,
      onLogLine
    );
  }

  for (const selector of unmatchedSnippetSelectors) {
    warnings.push({
      code: "generator-snippet-not-found",
      message: `No snippet generator registered for UseGenerator='${selector}'.`
    });
  }

  return {
    xml: state.xml,
    durationMs: Date.now() - startedAt,
    appliedGeneratorIds,
    warnings
  };
}

function processSnippetGenerators(
  input: TemplateGeneratorInput,
  state: MutableState,
  snippetBySelector: ReadonlyMap<string, SnippetTemplateGenerator>,
  warnings: TemplateGeneratorWarning[],
  appliedGeneratorIds: string[],
  unmatchedSnippetSelectors: Set<string>,
  deadline: number,
  onLogLine?: (line: string) => void
): void {
  let guard = 0;
  while (Date.now() <= deadline && guard < 5000) {
    guard++;
    const snippets = collectUseGeneratorBlocks(state.xml);
    if (snippets.length === 0) {
      return;
    }

    let processedAny = false;
    for (const snippet of snippets) {
      const selector = snippet.attrs.get("UseGenerator") ?? "";
      if (!selector) {
        continue;
      }

      const generator = snippetBySelector.get(selector);
      if (!generator) {
        unmatchedSnippetSelectors.add(selector);
        continue;
      }

      const before = state.xml;
      const snippetState = { replaced: false };
      const context = createSnippetContext(input, state, snippet, selector, warnings, snippetState, onLogLine);
      if (generator.applies && !safeAppliesSnippet(generator, context, warnings)) {
        continue;
      }

      const startedAt = Date.now();
      safeRunSnippet(generator, context, warnings);
      const duration = Date.now() - startedAt;
      if (state.xml !== before || snippetState.replaced) {
        processedAny = true;
        if (!appliedGeneratorIds.includes(generator.id)) {
          appliedGeneratorIds.push(generator.id);
        }
        onLogLine?.(`[generator] ${generator.id}: snippet changed (${selector}, duration=${duration} ms)`);
      } else if (input.mode === "debug") {
        onLogLine?.(`[generator] ${generator.id}: snippet no-op (${selector}, duration=${duration} ms)`);
      }

      break;
    }

    if (!processedAny) {
      return;
    }
  }

  if (guard >= 5000) {
    warnings.push({
      code: "generator-snippet-guard",
      message: "Snippet generator guard reached; stopping further snippet processing."
    });
  } else if (Date.now() > deadline) {
    warnings.push({
      code: "generator-timeout",
      message: "Generator execution timeout reached during snippet processing."
    });
  }
}

function createDocumentContext(
  input: TemplateGeneratorInput,
  state: MutableState,
  warnings: TemplateGeneratorWarning[],
  onLogLine?: (line: string) => void
): DocumentGeneratorContext {
  const document = createDocumentHandle(state, onLogLine);
  return {
    input,
    document,
    helpers: { xml: xmlHelpers },
    log: (line) => onLogLine?.(`[generator:document] ${line}`),
    warn: (code, message) => warnings.push({ code, message })
  };
}

function createSnippetContext(
  input: TemplateGeneratorInput,
  state: MutableState,
  snippet: SnippetBlock,
  useGenerator: string,
  warnings: TemplateGeneratorWarning[],
  snippetState: { replaced: boolean },
  onLogLine?: (line: string) => void
): SnippetGeneratorContext {
  const document = createDocumentHandle(state, onLogLine);
  return {
    input,
    document,
    helpers: { xml: xmlHelpers },
    useGenerator,
    snippet,
    replaceSnippet: (xml) => {
      state.xml = `${state.xml.slice(0, snippet.start)}${xml}${state.xml.slice(snippet.end)}`;
      snippetState.replaced = true;
    },
    removeSnippet: () => {
      state.xml = `${state.xml.slice(0, snippet.start)}${state.xml.slice(snippet.end)}`;
      snippetState.replaced = true;
    },
    log: (line) => onLogLine?.(`[generator:snippet:${useGenerator}] ${line}`),
    warn: (code, message) => warnings.push({ code, message })
  };
}

function createDocumentHandle(state: MutableState, onLogLine?: (line: string) => void): GeneratorDocumentHandle {
  return {
    getXml: () => state.xml,
    setXml: (xml) => {
      state.xml = xml;
    },
    insertByXPath: (targetXPath, content, mode = "append", allowMultipleInserts = false) => {
      const result = applyXPathInsert(state.xml, {
        targetXPath,
        content,
        insertMode: normalizeInsertMode(mode),
        allowMultipleInserts
      }, { onDebugLog: onLogLine });
      state.xml = result.xml;
      return {
        matchCount: result.matchCount,
        insertCount: result.insertCount
      };
    },
    append: (targetXPath, content, allowMultipleInserts = false) =>
      createDocumentHandle(state, onLogLine).insertByXPath(targetXPath, content, "append", allowMultipleInserts),
    prepend: (targetXPath, content, allowMultipleInserts = false) =>
      createDocumentHandle(state, onLogLine).insertByXPath(targetXPath, content, "prepend", allowMultipleInserts),
    before: (targetXPath, content, allowMultipleInserts = false) =>
      createDocumentHandle(state, onLogLine).insertByXPath(targetXPath, content, "before", allowMultipleInserts),
    after: (targetXPath, content, allowMultipleInserts = false) =>
      createDocumentHandle(state, onLogLine).insertByXPath(targetXPath, content, "after", allowMultipleInserts)
  };
}

function normalizeInsertMode(mode: XPathInsertMode | string): XPathInsertMode {
  const normalized = String(mode).toLowerCase();
  if (normalized === "prepend" || normalized === "before" || normalized === "after") {
    return normalized;
  }
  return "append";
}

function safeAppliesDocument(
  generator: DocumentTemplateGenerator,
  context: DocumentGeneratorContext,
  warnings: TemplateGeneratorWarning[]
): boolean {
  try {
    return Boolean(generator.applies?.(context));
  } catch (error) {
    warnings.push({
      code: "generator-applies-failed",
      message: `${generator.id} applies failed: ${error instanceof Error ? error.message : String(error)}`
    });
    return false;
  }
}

function safeAppliesSnippet(
  generator: SnippetTemplateGenerator,
  context: SnippetGeneratorContext,
  warnings: TemplateGeneratorWarning[]
): boolean {
  try {
    return Boolean(generator.applies?.(context));
  } catch (error) {
    warnings.push({
      code: "generator-applies-failed",
      message: `${generator.id} applies failed: ${error instanceof Error ? error.message : String(error)}`
    });
    return false;
  }
}

function safeRunDocument(
  generator: DocumentTemplateGenerator,
  context: DocumentGeneratorContext,
  warnings: TemplateGeneratorWarning[]
): void {
  try {
    generator.run(context);
  } catch (error) {
    warnings.push({
      code: "generator-run-failed",
      message: `${generator.id} failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function safeRunSnippet(
  generator: SnippetTemplateGenerator,
  context: SnippetGeneratorContext,
  warnings: TemplateGeneratorWarning[]
): void {
  try {
    generator.run(context);
  } catch (error) {
    warnings.push({
      code: "generator-run-failed",
      message: `${generator.id} failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function getEnabledGenerators(options: TemplateGeneratorExecutionOptions): LoadedTemplateGenerator[] {
  if (!Array.isArray(options.userGenerators) || options.userGenerators.length === 0) {
    return [];
  }
  return options.userGenerators;
}

function collectUseGeneratorBlocks(text: string): SnippetBlock[] {
  const out: SnippetBlock[] = [];
  const tokenRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  const stack: Array<{ tagName: string; start: number; openEnd: number; attrsRaw: string }> = [];
  for (const match of text.matchAll(tokenRegex)) {
    const slash = match[1] ?? "";
    const tagName = match[2] ?? "";
    const attrsRaw = match[3] ?? "";
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (!tagName || start < 0) {
      continue;
    }
    const end = start + token.length;
    const isClosing = slash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      if (isSelfClosing) {
        const attrs = parseAttributes(attrsRaw);
        if (attrs.has("UseGenerator")) {
          out.push({
            tagName,
            outerXml: token,
            innerXml: "",
            attrs,
            start,
            end
          });
        }
        continue;
      }
      stack.push({ tagName, start, openEnd: end, attrsRaw });
      continue;
    }

    const topIndex = findLastIndex(stack, (item) => item.tagName === tagName);
    if (topIndex < 0) {
      continue;
    }
    const top = stack[topIndex];
    stack.length = topIndex;
    const attrs = parseAttributes(top.attrsRaw);
    if (attrs.has("UseGenerator")) {
      out.push({
        tagName: top.tagName,
        outerXml: text.slice(top.start, end),
        innerXml: text.slice(top.openEnd, start),
        attrs,
        start: top.start,
        end
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) {
      return i;
    }
  }
  return -1;
}
