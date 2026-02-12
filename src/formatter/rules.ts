import { XmlDocumentAst, XmlNode } from "./types";

const FORMAT_RULE_REGEX = /@FormatRule\s*:\s*([A-Za-z][A-Za-z-]*)/g;
const FORMAT_RULE_DIRECTIVE_REGEX = /@FormatRule\s*:\s*([^\r\n]*)/g;
const SUPPORTED_RULES = new Set<string>([
  "disable",
  "preserve-inner",
  "format-inner",
  "no-type-first",
  "no-attr-normalize",
  "no-inline-text-normalize"
]);
const RULE_ALIASES: Record<string, string> = {
  "type-first-off": "no-type-first",
  "keep-attr-whitespace": "no-attr-normalize",
  "keep-inline-text": "no-inline-text-normalize"
};

export function applyFormatRules(ast: XmlDocumentAst): void {
  const nodes = flattenNodes(ast.nodes);
  let pending: { rules: string[]; commentEnd: number } | undefined;

  for (const node of nodes) {
    if (node.kind === "comment") {
      const rules = extractRules(node.raw);
      if (rules.length > 0) {
        pending = {
          rules,
          commentEnd: node.end
        };
        continue;
      }
    }

    if (!pending) {
      continue;
    }

    const between = ast.source.slice(pending.commentEnd, node.start);
    if (/\S/.test(between)) {
      pending = undefined;
      continue;
    }

    if (node.kind === "text" && node.raw.trim().length === 0) {
      continue;
    }

    for (const rule of pending.rules) {
      node.rules.add(rule);
    }
    pending = undefined;
  }
}

function extractRules(commentRaw: string): string[] {
  const out = new Set<string>();
  let directive: RegExpExecArray | null;
  FORMAT_RULE_DIRECTIVE_REGEX.lastIndex = 0;
  while ((directive = FORMAT_RULE_DIRECTIVE_REGEX.exec(commentRaw)) !== null) {
    const rawValues = directive[1] ?? "";
    const candidates = rawValues
      .split(/[,\s]+/)
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0);
    for (const candidate of candidates) {
      const normalized = RULE_ALIASES[candidate] ?? candidate;
      if (SUPPORTED_RULES.has(normalized)) {
        out.add(normalized);
      }
    }
  }

  if (out.size === 0) {
    // Backward-compatible fallback for single-token syntax.
    let match: RegExpExecArray | null;
    FORMAT_RULE_REGEX.lastIndex = 0;
    while ((match = FORMAT_RULE_REGEX.exec(commentRaw)) !== null) {
      const normalized = (RULE_ALIASES[(match[1] ?? "").toLowerCase()] ?? (match[1] ?? "").toLowerCase()).trim();
      if (SUPPORTED_RULES.has(normalized)) {
        out.add(normalized);
      }
    }
  }
  return [...out];
}

function flattenNodes(nodes: readonly XmlNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "element") {
      out.push(...flattenNodes(node.children));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
