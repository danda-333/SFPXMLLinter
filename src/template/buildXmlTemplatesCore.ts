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
  root?: string;
  content: string;
}

interface ComponentDefinition {
  key: string;
  sections: ComponentSection[];
}

interface RenderContext {
  library: BuildComponentLibrary;
  maxDepth: number;
  templateRoot: string;
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
  maxDepth = 12
): string {
  const normalizedTemplate = templateText.replace(/^\uFEFF/, "");
  const context: RenderContext = {
    library,
    maxDepth,
    templateRoot: detectRootTagName(normalizedTemplate)
  };

  const templateParams = buildTemplateParams(normalizedTemplate);
  let out = normalizedTemplate;

  out = expandIncludes(out, templateParams, context);
  out = applyUsingSections(out, templateParams, context);
  out = replaceComponentPlaceholders(out, templateParams, context, 0);
  out = sanitizeFinalXml(out);
  out = normalizeXmlTagSpacingLikeLegacy(out);
  out = trimWhitespaceLikeLegacy(out);
  out = out.replace(/\uFEFF/g, "");

  return out;
}

export function extractUsingComponentRefs(text: string): string[] {
  const refs = new Set<string>();

  for (const match of text.matchAll(/<Using\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const componentValue = extractAttributeValue(attrs, "Component") ?? extractAttributeValue(attrs, "Name");
    if (!componentValue) {
      continue;
    }
    refs.add(stripXmlComponentExtension(normalizePath(componentValue)));
  }

  for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const body = match[1] ?? "";
    const componentValue = extractPlaceholderField(body, "Component") ?? extractPlaceholderField(body, "Name");
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
      const componentKey = attrs.get("Component") ?? attrs.get("Name");
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
        if (k === "Component" || k === "Name") {
          continue;
        }
        includeParams.set(k, v);
      }
      const mergedParams = mergeParams(baseParams, includeParams);

      let componentText = source.text;
      const sectionName = attrs.get("Section");
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

function applyUsingSections(text: string, templateParams: Map<string, string>, context: RenderContext): string {
  const usingDirectives = parseUsingDirectives(text);
  let out = removeUsingsBlocks(text);
  out = removeStandaloneUsingTags(out);

  for (const using of usingDirectives) {
    const component = resolveComponentByKey(context.library, using.componentKey);
    if (!component) {
      continue;
    }

    const sectionFilter = using.attrs.get("Section");
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
      out = insertSectionContent(out, section, renderedInner);
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
    const componentKey = fields.get("Component") ?? fields.get("Name");
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

    const sectionName = fields.get("Section");
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

function parseComponentSections(text: string): ComponentSection[] {
  const sections: ComponentSection[] = [];
  const tagRegex = /<\s*(\/?)\s*Section\b([^>]*)>/gi;
  let depth = 0;
  let currentOpenEnd = -1;
  let currentAttrsRaw = "";
  let currentContentStart = -1;

  for (const match of text.matchAll(tagRegex)) {
    const token = match[0] ?? "";
    const slash = match[1] ?? "";
    const attrsRaw = match[2] ?? "";
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

function insertSectionContent(text: string, section: ComponentSection, content: string): string {
  const targetTag = resolveTargetTagName(section);
  if (!targetTag) {
    return text;
  }

  const range = findTagRange(text, targetTag);
  if (!range) {
    return text;
  }

  const insertMode = (section.insert ?? "append").toLowerCase();
  if (insertMode === "prepend") {
    const insertAt = range.openEnd;
    return text.slice(0, insertAt) + content + text.slice(insertAt);
  }

  if (insertMode === "before") {
    return text.slice(0, range.openStart) + content + text.slice(range.openStart);
  }

  if (insertMode === "after") {
    return text.slice(0, range.closeEnd) + content + text.slice(range.closeEnd);
  }

  return text.slice(0, range.closeStart) + content + text.slice(range.closeStart);
}

function resolveTargetTagName(section: ComponentSection): string | undefined {
  const xpath = section.targetXPath?.trim() ?? "";
  if (xpath.length > 0) {
    const parts = xpath.split("/").map((p) => p.trim()).filter((p) => p.length > 0 && p !== "/");
    const last = parts.at(-1);
    if (last) {
      const clean = last.replace(/^\/*/, "").replace(/\[.*$/, "");
      if (clean.length > 0) {
        return clean;
      }
    }
  }

  return undefined;
}

function findTagRange(text: string, tagName: string): { openStart: number; openEnd: number; closeStart: number; closeEnd: number } | undefined {
  const escaped = escapeRegex(tagName);
  const openRegex = new RegExp(`<\\s*${escaped}(?=\\s|>|/)`, "i");
  const openMatch = openRegex.exec(text);
  if (!openMatch || openMatch.index < 0) {
    return undefined;
  }

  const openStart = openMatch.index;
  const openEnd = text.indexOf(">", openStart);
  if (openEnd < 0) {
    return undefined;
  }

  const fullTagRegex = new RegExp(`<\\s*(/)?\\s*${escaped}(?=\\s|>|/)[^>]*>`, "gi");
  fullTagRegex.lastIndex = openStart;

  let depth = 0;
  let closeStart = -1;
  let closeEnd = -1;
  for (;;) {
    const match = fullTagRegex.exec(text);
    if (!match || match.index < 0) {
      break;
    }

    const token = match[0];
    const isClosing = Boolean(match[1]);
    const isSelfClosing = /\/\s*>$/.test(token);
    if (!isClosing) {
      depth++;
      if (isSelfClosing) {
        depth--;
      }
    } else {
      depth--;
      if (depth === 0) {
        closeStart = match.index;
        closeEnd = match.index + token.length;
        break;
      }
    }
  }

  if (closeStart < 0 || closeEnd < 0) {
    return undefined;
  }

  return { openStart, openEnd: openEnd + 1, closeStart, closeEnd };
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
    const componentValue = attrs.get("Component") ?? attrs.get("Name");
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
  const start = out.indexOf("<Component");
  if (start >= 0) {
    const startEnd = out.indexOf(">", start);
    const end = out.lastIndexOf("</Component>");
    if (startEnd >= 0 && end > startEnd) {
      return out.slice(startEnd + 1, end);
    }
  }
  return out;
}

function sanitizeFinalXml(text: string): string {
  // Keep XML declaration if present, remove accidental component wrappers, and normalize common self-closing style.
  const declMatch = /^\s*<\?xml[^>]*\?>/.exec(text);
  const decl = declMatch?.[0] ?? "";
  let out = text;
  out = out.replace(/<\?xml[^>]*\?>/g, "");
  out = out.replace(/\s*<Component\b[^>]*xmlns:[^>]*>\s*/g, "");
  out = out.replace(/\s*<\/Component>\s*/g, "");
  if (decl.length > 0) {
    return `${decl}${out}`;
  }
  return out;
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
