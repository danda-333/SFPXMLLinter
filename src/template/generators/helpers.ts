export interface XmlHelpers {
  parseAttributes(rawAttrs: string): Map<string, string>;
  extractTagBody(text: string, tagName: string): string;
  escapeAttr(value: string): string;
  escapeRegex(value: string): string;
}

export const xmlHelpers: XmlHelpers = {
  parseAttributes,
  extractTagBody,
  escapeAttr,
  escapeRegex
};

export function parseAttributes(rawAttrs: string): Map<string, string> {
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

export function extractTagBody(text: string, tagName: string): string {
  const escaped = escapeRegex(tagName);
  const regex = new RegExp(`<\\s*${escaped}\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*${escaped}\\s*>`, "i");
  const match = regex.exec(text);
  return match?.[1] ?? "";
}

export function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

