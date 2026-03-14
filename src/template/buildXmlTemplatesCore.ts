import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";

export interface ComponentSource {
  key: string;
  text: string;
  origin?: string;
}

export interface BuildComponentLibrary {
  byKey: Map<string, ComponentSource>;
  byBaseName: Map<string, ComponentSource[]>;
}

interface ComponentSection {
  name?: string;
  insert?: string;
  targetXPath?: string;
  allowMultipleInserts?: boolean;
  root?: string;
  content: string;
}

interface ComponentDefinition {
  key: string;
  sections: ComponentSection[];
}

interface PrimitiveTemplate {
  name?: string;
  insert?: string;
  targetXPath?: string;
  allowMultipleInserts?: boolean;
  root?: string;
  content: string;
}

interface PrimitiveDefinition {
  key: string;
  templates: PrimitiveTemplate[];
}

const TEMPLATE_DEFINITION_TAGS = ["Feature", "Component"] as const;

interface RenderContext {
  library: BuildComponentLibrary;
  maxDepth: number;
  templateRoot: string;
  onDebugLog?: (line: string) => void;
}

interface UsingDirective {
  attrs: Map<string, string>;
  componentKey: string;
}

interface PlaceholderToken {
  full: string;
  body: string;
  start: number;
  end: number;
}

export interface XPathInsertTargetStats {
  matchCount: number;
  insertCount: number;
}

export function countXPathInsertTargets(
  text: string,
  targetXPath: string | undefined,
  allowMultipleInserts?: boolean
): number {
  return analyzeXPathInsertTargets(text, targetXPath, allowMultipleInserts).insertCount;
}

export function analyzeXPathInsertTargets(
  text: string,
  targetXPath: string | undefined,
  allowMultipleInserts?: boolean
): XPathInsertTargetStats {
  const xpathExpr = (targetXPath ?? "").trim();
  if (!xpathExpr) {
    return { matchCount: 0, insertCount: 0 };
  }

  const ranges = findTargetRanges(text, xpathExpr);
  if (ranges.length === 0) {
    return { matchCount: 0, insertCount: 0 };
  }

  return {
    matchCount: ranges.length,
    insertCount: allowMultipleInserts ? ranges.length : 1
  };
}

export function buildComponentLibrary(sources: readonly ComponentSource[]): BuildComponentLibrary {
  const byKey = new Map<string, ComponentSource>();
  const byBaseName = new Map<string, ComponentSource[]>();

  for (const source of sources) {
    const key = stripXmlComponentExtension(normalizePath(source.key));
    const normalizedSource: ComponentSource = {
      key,
      text: source.text,
      origin: source.origin
    };
    byKey.set(key, normalizedSource);

    const baseName = key.split("/").pop() ?? key;
    const list = byBaseName.get(baseName) ?? [];
    list.push(normalizedSource);
    byBaseName.set(baseName, list);
  }

  return { byKey, byBaseName };
}

export function renderTemplateText(
  templateText: string,
  library: BuildComponentLibrary,
  maxDepth = 12,
  onDebugLog?: (line: string) => void
): string {
  const normalizedTemplate = templateText.replace(/^\uFEFF/, "");
  const context: RenderContext = {
    library,
    maxDepth,
    templateRoot: detectRootTagName(normalizedTemplate),
    onDebugLog
  };

  const templateParams = buildTemplateParams(normalizedTemplate);
  let out = normalizedTemplate;

  out = expandIncludes(out, templateParams, context);
  out = applyUsingSections(out, templateParams, context);
  out = expandAuthoringSugar(out, templateParams, context);
  out = expandPrimitiveUsages(out, templateParams, context);
  out = replaceComponentPlaceholders(out, templateParams, context, 0);
  out = expandAuthoringSugar(out, templateParams, context);
  out = expandPrimitiveUsages(out, templateParams, context);
  out = sanitizeFinalXml(out, context.templateRoot);
  out = normalizeXmlTagSpacingLikeLegacy(out);
  out = trimWhitespaceLikeLegacy(out);
  out = out.replace(/\uFEFF/g, "");

  return out;
}

function expandAuthoringSugar(text: string, inheritedParams: Map<string, string>, context: RenderContext): string {
  let out = text;
  for (let pass = 0; pass < context.maxDepth; pass++) {
    const before = out;
    out = expandRepeatBlocks(out, inheritedParams, context);
    out = expandCaseBlocks(out, inheritedParams, context);
    out = expandIfBlocks(out, inheritedParams, context);
    if (out === before) {
      break;
    }
  }
  return out;
}

export function extractUsingComponentRefs(text: string): string[] {
  const refs = new Set<string>();

  for (const match of text.matchAll(/<Using\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const componentValue =
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component") ??
      extractAttributeValue(attrs, "Name");
    if (!componentValue) {
      continue;
    }
    refs.add(stripXmlComponentExtension(normalizePath(componentValue)));
  }

  for (const match of text.matchAll(/<UsePrimitive\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const primitiveValue =
      extractAttributeValue(attrs, "Primitive") ??
      extractAttributeValue(attrs, "Name") ??
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component");
    if (!primitiveValue) {
      continue;
    }
    refs.add(stripXmlComponentExtension(normalizePath(primitiveValue)));
  }

  for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const body = match[1] ?? "";
    const componentValue =
      extractPlaceholderField(body, "Feature") ??
      extractPlaceholderField(body, "Component") ??
      extractPlaceholderField(body, "Name");
    if (!componentValue) {
      continue;
    }
    refs.add(stripXmlComponentExtension(normalizePath(componentValue)));
  }

  return [...refs];
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function stripXmlComponentExtension(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(".primitive.xml")) {
    return value.slice(0, value.length - ".primitive.xml".length);
  }
  if (lower.endsWith(".feature.xml")) {
    return value.slice(0, value.length - ".feature.xml".length);
  }
  if (lower.endsWith(".component.xml")) {
    return value.slice(0, value.length - ".component.xml".length);
  }
  if (lower.endsWith(".xml")) {
    return value.slice(0, value.length - ".xml".length);
  }
  return value;
}

function resolveComponentByKey(library: BuildComponentLibrary, rawKey: string): ComponentDefinition | undefined {
  const normalized = stripXmlComponentExtension(normalizePath(rawKey));
  const source =
    library.byKey.get(normalized) ??
    (() => {
      const base = normalized.split("/").pop() ?? normalized;
      return library.byBaseName.get(base)?.[0];
    })();

  if (!source) {
    return undefined;
  }

  return {
    key: source.key,
    sections: parseComponentSections(source.text)
  };
}

function resolveComponentSourceByKey(library: BuildComponentLibrary, rawKey: string): ComponentSource | undefined {
  const normalized = stripXmlComponentExtension(normalizePath(rawKey));
  const source =
    library.byKey.get(normalized) ??
    (() => {
      const base = normalized.split("/").pop() ?? normalized;
      return library.byBaseName.get(base)?.[0];
    })();
  return source;
}

function resolvePrimitiveByKey(library: BuildComponentLibrary, rawKey: string): PrimitiveDefinition | undefined {
  const source = resolveComponentSourceByKey(library, rawKey);
  if (!source) {
    return undefined;
  }
  const templates = parsePrimitiveTemplates(source.text);
  if (templates.length === 0) {
    return undefined;
  }
  return {
    key: source.key,
    templates
  };
}

function expandIncludes(text: string, baseParams: Map<string, string>, context: RenderContext): string {
  let result = text;
  const includePattern = /<Include\b[^>]*\/>/gi;

  for (let pass = 0; pass < 10; pass++) {
    const matches = [...result.matchAll(includePattern)];
    if (matches.length === 0) {
      break;
    }

    let next = "";
    let cursor = 0;
    for (const match of matches) {
      const full = match[0] ?? "";
      const start = typeof match.index === "number" ? match.index : -1;
      if (start < 0) {
        continue;
      }

      next += result.slice(cursor, start);
      cursor = start + full.length;

      const attrs = parseXmlAttributes(full);
      const componentKey = attrs.get("Feature") ?? attrs.get("Component") ?? attrs.get("Name");
      if (!componentKey) {
        next += full;
        continue;
      }

      const source = resolveComponentSourceByKey(context.library, componentKey);
      if (!source) {
        next += full;
        continue;
      }

      const includeParams = new Map<string, string>();
      for (const [k, v] of attrs.entries()) {
        if (k === "Feature" || k === "Component" || k === "Name") {
          continue;
        }
        includeParams.set(k, v);
      }
      const mergedParams = mergeParams(baseParams, includeParams);

      let componentText = source.text;
      const sectionName = attrs.get("Contribution") ?? attrs.get("Section");
      if (sectionName && sectionName.trim().length > 0) {
        const def = resolveComponentByKey(context.library, source.key);
        const section = def?.sections.find((s) => (s.name ?? "") === sectionName) ?? def?.sections[0];
        if (section) {
          componentText = section.content;
        } else {
          componentText = normalizeComponentContent(componentText);
        }
      } else {
        componentText = normalizeComponentContent(componentText);
      }

      next += applyParamSubstitution(componentText, mergedParams);
    }

    next += result.slice(cursor);
    result = next;
  }

  return result;
}

function expandPrimitiveUsages(text: string, inheritedParams: Map<string, string>, context: RenderContext): string {
  let out = text;
  for (let pass = 0; pass < context.maxDepth; pass++) {
    const blocks = collectTagBlocks(out, "UsePrimitive");
    if (blocks.length === 0) {
      break;
    }

    const innermost = pickInnermostBlocks(blocks).sort((a, b) => b.start - a.start);
    let next = out;
    for (const block of innermost) {
      const rendered = renderPrimitiveUsage(block, inheritedParams, context);
      next = `${next.slice(0, block.start)}${rendered}${next.slice(block.end)}`;
    }
    out = next;
  }
  return out;
}

function renderPrimitiveUsage(block: TagBlock, inheritedParams: Map<string, string>, context: RenderContext): string {
  const attrs = parseXmlAttributes(block.attrs);
  const primitiveKey =
    attrs.get("Primitive") ??
    attrs.get("Name") ??
    attrs.get("Feature") ??
    attrs.get("Component");
  if (!primitiveKey) {
    return reconstructUsePrimitiveBlock(block);
  }

  const primitive = resolvePrimitiveByKey(context.library, primitiveKey);
  if (!primitive) {
    if (context.onDebugLog) {
      context.onDebugLog(`[Primitive] '${primitiveKey}' not found.`);
    }
    return reconstructUsePrimitiveBlock(block);
  }

  const selectedTemplateName = attrs.get("Template") ?? attrs.get("Contribution") ?? attrs.get("Section");
  const template = pickPrimitiveTemplate(primitive.templates, selectedTemplateName);
  if (!template) {
    if (context.onDebugLog) {
      context.onDebugLog(`[Primitive] '${primitiveKey}' has no usable template.`);
    }
    return reconstructUsePrimitiveBlock(block);
  }

  const localParams = new Map<string, string>();
  for (const [key, value] of attrs.entries()) {
    if (key === "Primitive" || key === "Name" || key === "Feature" || key === "Component" || key === "Template" || key === "Contribution" || key === "Section") {
      continue;
    }
    localParams.set(key, value);
  }
  const params = mergeParams(inheritedParams, localParams);
  const slots = parsePrimitiveSlots(block.body);

  let rendered = replaceSlotPlaceholders(template.content, slots);
  rendered = applyParamSubstitution(rendered, params);
  return rendered;
}

function reconstructUsePrimitiveBlock(block: TagBlock): string {
  const attrs = block.attrs?.trim() ?? "";
  if (!block.body || block.body.trim().length === 0) {
    return attrs.length > 0 ? `<UsePrimitive ${attrs} />` : "<UsePrimitive />";
  }
  return attrs.length > 0
    ? `<UsePrimitive ${attrs}>${block.body}</UsePrimitive>`
    : `<UsePrimitive>${block.body}</UsePrimitive>`;
}

function parsePrimitiveTemplates(text: string): PrimitiveTemplate[] {
  const blocks = collectTagBlocks(text, "Template").sort((a, b) => a.start - b.start);
  const templates: PrimitiveTemplate[] = [];
  for (const block of blocks) {
    const attrs = parseXmlAttributes(block.attrs);
    templates.push({
      name: attrs.get("Name"),
      insert: attrs.get("Insert"),
      targetXPath: attrs.get("TargetXPath"),
      allowMultipleInserts: parseBooleanAttribute(attrs.get("AllowMultipleInserts")),
      root: attrs.get("Root"),
      content: block.body
    });
  }
  return templates;
}

function pickPrimitiveTemplate(templates: readonly PrimitiveTemplate[], requestedName?: string): PrimitiveTemplate | undefined {
  if (requestedName && requestedName.trim().length > 0) {
    return templates.find((template) => (template.name ?? "") === requestedName);
  }
  return templates.find((template) => (template.insert ?? "").toLowerCase() === "placeholder") ??
    templates.find((template) => !(template.targetXPath ?? "").trim()) ??
    templates[0];
}

function parsePrimitiveSlots(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const blocks = collectTagBlocks(text, "Slot").sort((a, b) => a.start - b.start);
  for (const block of blocks) {
    const attrs = parseXmlAttributes(block.attrs);
    const name = (attrs.get("Name") ?? "").trim();
    if (!name) {
      continue;
    }
    out.set(name, block.body);
  }
  return out;
}

function replaceSlotPlaceholders(text: string, slots: ReadonlyMap<string, string>): string {
  return text.replace(/\{\{Slot:([A-Za-z_][\w.-]*)\}\}/g, (full, slotName: string) => {
    return slots.get(slotName) ?? "";
  });
}

function applyUsingSections(text: string, templateParams: Map<string, string>, context: RenderContext): string {
  const usingDirectives = parseUsingDirectives(text);
  let out = removeUsingsBlocks(text);
  out = removeStandaloneUsingTags(out);

  for (const using of usingDirectives) {
    const component = resolveComponentByKey(context.library, using.componentKey);
    if (!component) {
      continue;
    }

    const sectionFilter = using.attrs.get("Contribution") ?? using.attrs.get("Section");
    const params = mergeParams(templateParams, using.attrs);
    const sections = sectionFilter
      ? component.sections.filter((s) => (s.name ?? "") === sectionFilter)
      : component.sections;

    for (const section of sections) {
      if (!matchesSectionRoot(section.root, context.templateRoot)) {
        continue;
      }
      const insertMode = (section.insert ?? "append").toLowerCase();
      if (insertMode === "placeholder") {
        continue;
      }

      const renderedInner = replaceComponentPlaceholders(applyParamSubstitution(section.content, params), params, context, 1);
      out = insertSectionContent(out, section, renderedInner, context);
    }
  }

  return out;
}

function replaceComponentPlaceholders(
  text: string,
  inheritedParams: Map<string, string>,
  context: RenderContext,
  depth: number
): string {
  if (depth >= context.maxDepth) {
    return text;
  }

  const tokens = collectPlaceholderTokens(text);
  if (tokens.length === 0) {
    return text;
  }

  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    out += text.slice(cursor, token.start);

    const fields = parsePlaceholderFields(token.body);
    const componentKey = fields.get("Feature") ?? fields.get("Component") ?? fields.get("Name");
    if (!componentKey) {
      const value = inheritedParams.get(token.body.trim());
      out += value ?? token.full;
      cursor = token.end;
      continue;
    }

    const component = resolveComponentByKey(context.library, componentKey);
    if (!component) {
      out += token.full;
      cursor = token.end;
      continue;
    }

    const sectionName = fields.get("Contribution") ?? fields.get("Section");
    const section = pickComponentSection(component.sections, sectionName);
    if (!section) {
      out += token.full;
      cursor = token.end;
      continue;
    }

    const params = mergeParams(inheritedParams, fields);
    const rendered = applyParamSubstitution(section.content, params);
    out += replaceComponentPlaceholders(rendered, params, context, depth + 1);
    cursor = token.end;
  }

  out += text.slice(cursor);
  return out;
}

function expandRepeatBlocks(text: string, inheritedParams: Map<string, string>, context: RenderContext): string {
  let out = text;
  for (let pass = 0; pass < context.maxDepth; pass++) {
    const blocks = collectTagBlocks(out, "Repeat");
    if (blocks.length === 0) {
      break;
    }

    // Replace innermost first and from the end so ranges remain stable.
    const innermost = pickInnermostBlocks(blocks).sort((a, b) => b.start - a.start);
    let next = out;
    for (const block of innermost) {
      const rendered = renderRepeatBlock(block, inheritedParams, context);
      next = `${next.slice(0, block.start)}${rendered}${next.slice(block.end)}`;
    }
    out = next;
  }

  return out;
}

interface TagBlock {
  start: number;
  end: number;
  attrs: string;
  body: string;
}

function collectTagBlocks(text: string, tagName: string): TagBlock[] {
  const escapedTagName = escapeRegex(tagName);
  const tokenRegex = new RegExp(`<\\s*(\\/?)\\s*${escapedTagName}\\b([^>]*)>`, "gi");
  const stack: Array<{ start: number; openEnd: number; attrs: string }> = [];
  const blocks: TagBlock[] = [];
  for (const match of text.matchAll(tokenRegex)) {
    const slash = match[1] ?? "";
    const attrs = match[2] ?? "";
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0) {
      continue;
    }
    const end = start + token.length;
    const isClosing = slash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      if (isSelfClosing) {
        blocks.push({
          start,
          end,
          attrs,
          body: ""
        });
        continue;
      }
      stack.push({
        start,
        openEnd: end,
        attrs
      });
      continue;
    }

    const top = stack.pop();
    if (!top) {
      continue;
    }
    blocks.push({
      start: top.start,
      end,
      attrs: top.attrs,
      body: text.slice(top.openEnd, start)
    });
  }

  return blocks;
}

function renderRepeatBlock(block: TagBlock, inheritedParams: Map<string, string>, context: RenderContext): string {
  const attrs = parseXmlAttributes(block.attrs);
  const paramName = (attrs.get("Param") ?? attrs.get("As") ?? attrs.get("Name") ?? "Item").trim();
  if (!paramName) {
    return block.body;
  }

  const values = collectRepeatValues(attrs);
  if (values.length === 0) {
    if (context.onDebugLog) {
      context.onDebugLog("[Repeat] skipped block with no values.");
    }
    return "";
  }

  const separator = attrs.get("Separator") ?? "";
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const item = values[i] ?? "";
    const localParams = new Map<string, string>([
      [paramName, item],
      ["Index", String(i)],
      ["Index1", String(i + 1)]
    ]);
    const params = mergeParams(inheritedParams, localParams);
    parts.push(applyParamSubstitution(block.body, params));
  }

  return parts.join(separator);
}

function collectRepeatValues(attrs: ReadonlyMap<string, string>): string[] {
  const valuesRaw = attrs.get("Values") ?? attrs.get("Items");
  if (valuesRaw && valuesRaw.trim().length > 0) {
    return valuesRaw
      .split(/[,;|]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  const fromRaw = attrs.get("From");
  const toRaw = attrs.get("To");
  if (fromRaw === undefined || toRaw === undefined) {
    return [];
  }

  const from = Number.parseInt(fromRaw, 10);
  const to = Number.parseInt(toRaw, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return [];
  }

  let step = Number.parseInt(attrs.get("Step") ?? "1", 10);
  if (!Number.isFinite(step) || step === 0) {
    step = 1;
  }
  const effectiveStep = from <= to ? Math.abs(step) : -Math.abs(step);
  const out: string[] = [];
  for (let current = from; effectiveStep > 0 ? current <= to : current >= to; current += effectiveStep) {
    out.push(String(current));
  }
  return out;
}

function expandIfBlocks(text: string, inheritedParams: Map<string, string>, context: RenderContext): string {
  let out = text;
  for (let pass = 0; pass < context.maxDepth; pass++) {
    const blocks = collectTagBlocks(out, "If");
    if (blocks.length === 0) {
      break;
    }

    const innermost = pickInnermostBlocks(blocks).sort((a, b) => b.start - a.start);
    let next = out;
    for (const block of innermost) {
      const rendered = renderIfBlock(block, inheritedParams, context);
      next = `${next.slice(0, block.start)}${rendered}${next.slice(block.end)}`;
    }
    out = next;
  }
  return out;
}

function renderIfBlock(block: TagBlock, inheritedParams: Map<string, string>, context: RenderContext): string {
  const attrs = parseXmlAttributes(block.attrs);
  const paramName = (attrs.get("Param") ?? attrs.get("Name") ?? attrs.get("Key") ?? "").trim();
  const leftRaw = attrs.get("Value");
  const leftValue = leftRaw !== undefined
    ? resolveParamValue(leftRaw, inheritedParams)
    : (paramName ? (inheritedParams.get(paramName) ?? "") : "");

  const equalsRaw = attrs.get("Equals");
  const notEqualsRaw = attrs.get("NotEquals");
  const inRaw = attrs.get("In");
  const isEmptyRaw = attrs.get("IsEmpty");

  let isMatch: boolean;
  if (equalsRaw !== undefined) {
    isMatch = leftValue === resolveParamValue(equalsRaw, inheritedParams);
  } else if (notEqualsRaw !== undefined) {
    isMatch = leftValue !== resolveParamValue(notEqualsRaw, inheritedParams);
  } else if (inRaw !== undefined) {
    const inValues = splitListValues(resolveParamValue(inRaw, inheritedParams));
    isMatch = inValues.includes(leftValue);
  } else if (isEmptyRaw !== undefined) {
    const expectEmpty = parseBooleanAttribute(resolveParamValue(isEmptyRaw, inheritedParams)) ?? false;
    isMatch = expectEmpty ? leftValue.trim().length === 0 : leftValue.trim().length > 0;
  } else {
    isMatch = isTruthy(leftValue);
  }

  if (!isMatch && context.onDebugLog && attrs.size > 0) {
    context.onDebugLog(`[If] condition did not match${paramName ? ` for '${paramName}'` : ""}.`);
  }
  return isMatch ? block.body : "";
}

function expandCaseBlocks(text: string, inheritedParams: Map<string, string>, context: RenderContext): string {
  let out = text;
  for (let pass = 0; pass < context.maxDepth; pass++) {
    const blocks = collectTagBlocks(out, "Case");
    if (blocks.length === 0) {
      break;
    }

    const innermost = pickInnermostBlocks(blocks).sort((a, b) => b.start - a.start);
    let next = out;
    for (const block of innermost) {
      const rendered = renderCaseBlock(block, inheritedParams, context);
      next = `${next.slice(0, block.start)}${rendered}${next.slice(block.end)}`;
    }
    out = next;
  }
  return out;
}

function renderCaseBlock(block: TagBlock, inheritedParams: Map<string, string>, context: RenderContext): string {
  const attrs = parseXmlAttributes(block.attrs);
  const paramName = (attrs.get("Param") ?? attrs.get("Name") ?? attrs.get("Key") ?? "").trim();
  const selectedRaw = attrs.get("Value");
  const selectedValue = selectedRaw !== undefined
    ? resolveParamValue(selectedRaw, inheritedParams)
    : (paramName ? (inheritedParams.get(paramName) ?? "") : "");

  const whenBlocks = collectTagBlocks(block.body, "When")
    .sort((a, b) => a.start - b.start);
  for (const whenBlock of whenBlocks) {
    const whenAttrs = parseXmlAttributes(whenBlock.attrs);
    const equalsRaw = whenAttrs.get("Equals") ?? whenAttrs.get("Value");
    const inRaw = whenAttrs.get("In");

    let isMatch = false;
    if (equalsRaw !== undefined) {
      const compareValues = splitListValues(resolveParamValue(equalsRaw, inheritedParams));
      isMatch = compareValues.includes(selectedValue);
    } else if (inRaw !== undefined) {
      const compareValues = splitListValues(resolveParamValue(inRaw, inheritedParams));
      isMatch = compareValues.includes(selectedValue);
    } else {
      // Fallback: <When> without selector means first branch.
      isMatch = true;
    }

    if (isMatch) {
      return whenBlock.body;
    }
  }

  const defaultBlock = collectTagBlocks(block.body, "Default").sort((a, b) => a.start - b.start)[0];
  if (defaultBlock) {
    return defaultBlock.body;
  }

  if (context.onDebugLog && attrs.size > 0) {
    context.onDebugLog(`[Case] no branch matched${paramName ? ` for '${paramName}'` : ""}.`);
  }
  return "";
}

function resolveParamValue(value: string, params: Map<string, string>): string {
  return applyParamSubstitution(value, params).trim();
}

function splitListValues(raw: string): string[] {
  return raw
    .split(/[,;|]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
}

function pickInnermostBlocks(blocks: readonly TagBlock[]): TagBlock[] {
  if (blocks.length <= 1) {
    return [...blocks];
  }
  return blocks.filter((candidate) => {
    for (const other of blocks) {
      if (other === candidate) {
        continue;
      }
      if (other.start > candidate.start && other.end < candidate.end) {
        return false;
      }
    }
    return true;
  });
}

function parseComponentSections(text: string): ComponentSection[] {
  const sections: ComponentSection[] = [];
  const tagRegex = /<\s*(\/?)\s*(Contribution|Section)\b([^>]*)>/gi;
  let depth = 0;
  let currentOpenEnd = -1;
  let currentAttrsRaw = "";
  let currentContentStart = -1;

  for (const match of text.matchAll(tagRegex)) {
    const token = match[0] ?? "";
    const slash = match[1] ?? "";
    const attrsRaw = match[3] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0) {
      continue;
    }
    const end = start + token.length;
    const isClosing = slash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      if (depth === 0) {
        currentOpenEnd = end;
        currentAttrsRaw = attrsRaw;
        currentContentStart = end;
      }
      if (!isSelfClosing) {
        depth++;
      } else if (depth === 0) {
        const attrs = parseXmlAttributes(currentAttrsRaw);
        sections.push({
          name: attrs.get("Name"),
          insert: attrs.get("Insert"),
          targetXPath: attrs.get("TargetXPath"),
          allowMultipleInserts: parseBooleanAttribute(attrs.get("AllowMultipleInserts")),
          root: attrs.get("Root"),
          content: ""
        });
        currentOpenEnd = -1;
        currentAttrsRaw = "";
        currentContentStart = -1;
      }
      continue;
    }

    if (depth <= 0) {
      continue;
    }
    depth--;
    if (depth === 0 && currentContentStart >= 0) {
      const attrs = parseXmlAttributes(currentAttrsRaw);
      sections.push({
        name: attrs.get("Name"),
        insert: attrs.get("Insert"),
        targetXPath: attrs.get("TargetXPath"),
        allowMultipleInserts: parseBooleanAttribute(attrs.get("AllowMultipleInserts")),
        root: attrs.get("Root"),
        content: text.slice(currentContentStart, start)
      });
      currentOpenEnd = -1;
      currentAttrsRaw = "";
      currentContentStart = -1;
    }
  }

  return sections;
}

function pickComponentSection(sections: readonly ComponentSection[], requestedName?: string): ComponentSection | undefined {
  if (requestedName && requestedName.trim().length > 0) {
    return sections.find((s) => (s.name ?? "") === requestedName);
  }

  return sections.find((s) => (s.insert ?? "").toLowerCase() === "placeholder") ?? sections[0];
}

function insertSectionContent(text: string, section: ComponentSection, content: string, context?: RenderContext): string {
  const targetXPath = section.targetXPath?.trim() ?? "";
  if (targetXPath.length === 0) {
    return text;
  }

  const ranges = findTargetRanges(text, targetXPath, context);
  if (ranges.length === 0) {
    return text;
  }

  if (ranges.length > 1 && context?.onDebugLog) {
    context.onDebugLog(
      `[TargetXPath] '${targetXPath}' matched ${ranges.length} nodes; ` +
      `${section.allowMultipleInserts ? "applying to all matches" : "using first match only"}`
    );
  }

  const insertMode = (section.insert ?? "append").toLowerCase();
  const applicableRanges = section.allowMultipleInserts ? ranges : [ranges[0]];
  const sortedRanges = [...applicableRanges].sort((a, b) => insertionPointForMode(b, insertMode) - insertionPointForMode(a, insertMode));

  let out = text;
  for (const range of sortedRanges) {
    if (insertMode === "prepend") {
      out = out.slice(0, range.openEnd) + content + out.slice(range.openEnd);
      continue;
    }
    if (insertMode === "before") {
      out = out.slice(0, range.openStart) + content + out.slice(range.openStart);
      continue;
    }
    if (insertMode === "after") {
      out = out.slice(0, range.closeEnd) + content + out.slice(range.closeEnd);
      continue;
    }
    out = out.slice(0, range.closeStart) + content + out.slice(range.closeStart);
  }

  return out;
}

function insertionPointForMode(
  range: { openStart: number; openEnd: number; closeStart: number; closeEnd: number },
  insertMode: string
): number {
  if (insertMode === "prepend") {
    return range.openEnd;
  }
  if (insertMode === "before") {
    return range.openStart;
  }
  if (insertMode === "after") {
    return range.closeEnd;
  }
  return range.closeStart;
}

function findTargetRanges(
  text: string,
  targetXPath: string,
  context?: RenderContext
): Array<{ openStart: number; openEnd: number; closeStart: number; closeEnd: number }> {
  try {
    const document = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: () => undefined,
        fatalError: () => undefined
      }
    }).parseFromString(text, "text/xml");
    const selected = xpath.select(targetXPath, document);
    const selectedNodes = Array.isArray(selected) ? selected : [selected];
    const matches = selectedNodes.filter(isElementNode);
    if (matches.length === 0) {
      return [];
    }

    const rangeBySignature = buildRangeBySignature(text);
    const out: Array<{ openStart: number; openEnd: number; closeStart: number; closeEnd: number }> = [];
    for (const match of matches) {
      const signature = buildDomNodeSignature(match);
      if (!signature) {
        continue;
      }
      const range = rangeBySignature.get(signature);
      if (range) {
        out.push(range);
      } else if (context?.onDebugLog) {
        context.onDebugLog(`[TargetXPath] unable to map XPath match '${targetXPath}' back to source range (${signature}).`);
      }
    }
    return out;
  } catch (error) {
    if (context?.onDebugLog) {
      const message = error instanceof Error ? error.message : String(error);
      context.onDebugLog(`[TargetXPath] '${targetXPath}' evaluation failed: ${message}`);
    }
    return [];
  }
}

interface RangeNode {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  elementIndex: number;
  parent?: RangeNode;
  children: RangeNode[];
}

function buildRangeBySignature(text: string): Map<string, { openStart: number; openEnd: number; closeStart: number; closeEnd: number }> {
  const rootNodes = parseRangeNodes(text);
  const out = new Map<string, { openStart: number; openEnd: number; closeStart: number; closeEnd: number }>();
  const walk = (node: RangeNode): void => {
    out.set(buildRangeNodeSignature(node), {
      openStart: node.openStart,
      openEnd: node.openEnd,
      closeStart: node.closeStart,
      closeEnd: node.closeEnd
    });
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const node of rootNodes) {
    walk(node);
  }
  return out;
}

function parseRangeNodes(text: string): RangeNode[] {
  const tokenRegex = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?[A-Za-z_][\w:.-]*\b[^>]*?>/gi;
  const roots: RangeNode[] = [];
  const stack: RangeNode[] = [];

  for (const match of text.matchAll(tokenRegex)) {
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0) {
      continue;
    }
    if (token.startsWith("<!--") || token.startsWith("<![CDATA[") || token.startsWith("<?") || token.startsWith("<!DOCTYPE")) {
      continue;
    }

    const isClosing = /^<\s*\//.test(token);
    const isSelfClosing = /\/\s*>$/.test(token);
    const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(token);
    const name = nameMatch?.[1] ?? "";
    if (!name) {
      continue;
    }

    const end = start + token.length;
    if (!isClosing) {
      const parent: RangeNode | undefined = stack.at(-1);
      const node: RangeNode = {
        name,
        openStart: start,
        openEnd: end,
        closeStart: start,
        closeEnd: end,
        elementIndex: parent ? parent.children.length + 1 : roots.length + 1,
        parent,
        children: []
      };
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
      if (!isSelfClosing) {
        stack.push(node);
      }
      continue;
    }

    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name !== name) {
        continue;
      }
      stack[i].closeStart = start;
      stack[i].closeEnd = end;
      stack.length = i;
      break;
    }
  }

  return roots;
}

function buildRangeNodeSignature(node: RangeNode): string {
  const parts: string[] = [];
  let current: RangeNode | undefined = node;
  while (current) {
    parts.push(`${current.name}[${current.elementIndex}]`);
    current = current.parent;
  }
  return parts.reverse().join("/");
}

function buildDomNodeSignature(node: Node): string | undefined {
  const parts: string[] = [];
  let current: Node | null = node;
  while (current && current.nodeType === current.ELEMENT_NODE) {
    const currentElement: Node = current;
    const parent: Node | null = currentElement.parentNode;
    let elementIndex = 1;
    if (parent) {
      for (let sibling = parent.firstChild; sibling && sibling !== currentElement; sibling = sibling.nextSibling) {
        if (sibling.nodeType === sibling.ELEMENT_NODE) {
          elementIndex++;
        }
      }
    }
    parts.push(`${currentElement.nodeName}[${elementIndex}]`);
    current = parent;
    if (current?.nodeType === 9) {
      break;
    }
  }
  return parts.length > 0 ? parts.reverse().join("/") : undefined;
}

function isElementNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && "nodeType" in (value as Record<string, unknown>) && (value as Node).nodeType === 1;
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
}

function buildTemplateParams(text: string): Map<string, string> {
  const params = new Map<string, string>();
  const openTag = /<\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/i.exec(text);
  if (!openTag) {
    return params;
  }

  const rootTag = (openTag[1] ?? "").toLowerCase();
  const attrs = parseXmlAttributes(openTag[2] ?? "");
  const ident = attrs.get("Ident");
  const formIdent = attrs.get("FormIdent");

  if (rootTag === "form" && ident) {
    params.set("FormIdent", ident);
  }
  if (rootTag === "workflow" && formIdent) {
    params.set("FormIdent", formIdent);
  }
  if (!params.has("FormIdent") && ident) {
    params.set("FormIdent", ident);
  }

  for (const [k, v] of attrs.entries()) {
    params.set(k, v);
  }

  return params;
}

function parseUsingDirectives(text: string): UsingDirective[] {
  const out: UsingDirective[] = [];
  const regex = /<Using\b([^>]*)\/?>/gi;
  for (const m of text.matchAll(regex)) {
    const attrs = parseXmlAttributes(m[1] ?? "");
    const componentValue = attrs.get("Feature") ?? attrs.get("Component") ?? attrs.get("Name");
    if (!componentValue) {
      continue;
    }

    out.push({
      attrs,
      componentKey: stripXmlComponentExtension(normalizePath(componentValue))
    });
  }

  return out;
}

function parseXmlAttributes(rawAttrs: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of rawAttrs.matchAll(regex)) {
    const name = m[1] ?? "";
    if (!name) {
      continue;
    }
    out.set(name, (m[2] ?? m[3] ?? "").trim());
  }
  return out;
}

function collectPlaceholderTokens(text: string): PlaceholderToken[] {
  const out: PlaceholderToken[] = [];
  const regex = /\{\{([^{}]+)\}\}/g;
  for (const match of text.matchAll(regex)) {
    if (typeof match.index !== "number") {
      continue;
    }

    const full = match[0] ?? "";
    out.push({
      full,
      body: match[1] ?? "",
      start: match.index,
      end: match.index + full.length
    });
  }
  return out;
}

function parsePlaceholderFields(rawBody: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of rawBody.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) {
      continue;
    }
    out.set(key, value);
  }
  return out;
}

function mergeParams(base: Map<string, string>, extra: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>(base);
  for (const [k, v] of extra.entries()) {
    out.set(k, v);
  }
  return out;
}

function applyParamSubstitution(text: string, params: Map<string, string>): string {
  return text.replace(/\{\{([A-Za-z_][\w.-]*)\}\}/g, (m, key: string) => params.get(key) ?? m);
}

function removeUsingsBlocks(text: string): string {
  return text.replace(/<Usings\b[^>]*>[\s\S]*?<\/Usings>/gi, "");
}

function removeStandaloneUsingTags(text: string): string {
  return text.replace(/^[ \t]*<Using\b[^>]*\/?>[ \t]*\r?\n?/gim, "");
}

function normalizeComponentContent(text: string): string {
  let out = text.replace(/<\?xml[^>]*\?>/gi, "");
  out = out.replace(/^\uFEFF/, "");
  for (const tagName of TEMPLATE_DEFINITION_TAGS) {
    const start = out.indexOf(`<${tagName}`);
    if (start < 0) {
      continue;
    }

    const startEnd = out.indexOf(">", start);
    const end = out.lastIndexOf(`</${tagName}>`);
    if (startEnd >= 0 && end > startEnd) {
      return out.slice(startEnd + 1, end);
    }
  }
  return out;
}

function sanitizeFinalXml(text: string, templateRoot: string): string {
  // Keep XML declaration if present, remove accidental component wrappers, and normalize common self-closing style.
  const declMatch = /^\s*<\?xml[^>]*\?>/.exec(text);
  const decl = declMatch?.[0] ?? "";
  let out = text;
  out = out.replace(/<\?xml[^>]*\?>/g, "");
  const isSfpComponentTemplate = templateRoot.localeCompare("Component", undefined, { sensitivity: "accent" }) === 0;
  if (!isSfpComponentTemplate) {
    out = stripOuterTemplateDefinitionWrapper(out);
  }
  if (decl.length > 0) {
    return `${decl}${out}`;
  }
  return out;
}

function stripOuterTemplateDefinitionWrapper(text: string): string {
  for (const tagName of TEMPLATE_DEFINITION_TAGS) {
    const stripped = stripOuterWrapperForTag(text, tagName);
    if (stripped !== text) {
      return stripped;
    }
  }

  return text;
}

function stripOuterWrapperForTag(text: string, tagName: string): string {
  const trimmedStart = text.trimStart();
  const openRegex = new RegExp(`^<${tagName}\\b`, "i");
  if (!openRegex.test(trimmedStart)) {
    return text;
  }

  const offset = text.length - trimmedStart.length;
  const startEnd = text.indexOf(">", offset);
  if (startEnd < 0) {
    return text;
  }

  const trimmedEnd = text.trimEnd();
  const closeRegex = new RegExp(`</${tagName}>\\s*$`, "i");
  if (!closeRegex.test(trimmedEnd)) {
    return text;
  }

  const closingToken = `</${tagName}>`;
  const endStart = text.lastIndexOf(closingToken);
  if (endStart <= startEnd) {
    return text;
  }

  return `${text.slice(0, offset)}${text.slice(startEnd + 1, endStart)}${text.slice(endStart + closingToken.length)}`;
}

function normalizeXmlTagSpacingLikeLegacy(text: string): string {
  return text.replace(/<\/?[\w:.-]+(?:\s+[^<>]*?)?\s*\/?>/g, (tag) => normalizeXmlTag(tag));
}

function normalizeXmlTag(tag: string): string {
  if (tag.startsWith("<?") || tag.startsWith("<!") || tag.startsWith("<!--")) {
    return tag;
  }

  const isClosing = /^<\s*\//.test(tag);
  const isSelfClosing = /\/\s*>$/.test(tag);
  const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag);
  if (!nameMatch) {
    return tag;
  }

  const name = nameMatch[1] ?? "";
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
    return `<${name}${attrText} />`;
  }
  return `<${name}${attrText}>`;
}

function trimWhitespaceLikeLegacy(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const trimmed = lines.map((line) => line.replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let blankRun = 0;
  for (const line of trimmed) {
    if (line.length === 0) {
      blankRun++;
      if (blankRun <= 1) {
        out.push(line);
      }
      continue;
    }

    blankRun = 0;
    out.push(line);
  }

  return `${out.join("\n").trimEnd()}\n`;
}

function extractAttributeValue(rawAttrs: string, attrName: string): string | undefined {
  const escaped = escapeRegex(attrName);
  const regex = new RegExp(`${escaped}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(rawAttrs);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function extractPlaceholderField(rawBody: string, fieldName: string): string | undefined {
  const escaped = escapeRegex(fieldName);
  const regex = new RegExp(`(?:^|,)\\s*${escaped}\\s*:\\s*([^,}]+)`, "i");
  const match = regex.exec(rawBody);
  const value = (match?.[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectRootTagName(text: string): string {
  const openTag = /<\s*([A-Za-z_][\w:.-]*)\b/.exec(text);
  return (openTag?.[1] ?? "").trim();
}

function matchesSectionRoot(sectionRoot: string | undefined, templateRoot: string): boolean {
  const raw = (sectionRoot ?? "").trim();
  if (!raw) {
    return true;
  }
  if (!templateRoot) {
    return true;
  }
  const roots = raw
    .split(/[,;| ]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (roots.length === 0) {
    return true;
  }
  return roots.some((r) => r.localeCompare(templateRoot, undefined, { sensitivity: "accent" }) === 0);
}
