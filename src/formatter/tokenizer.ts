import { XmlToken } from "./types";

export function tokenizeXml(source: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      const close = end >= 0 ? end + 3 : source.length;
      tokens.push({
        kind: "comment",
        raw: source.slice(cursor, close),
        start: cursor,
        end: close
      });
      cursor = close;
      continue;
    }

    if (source.startsWith("<![CDATA[", cursor)) {
      const end = source.indexOf("]]>", cursor + 9);
      const close = end >= 0 ? end + 3 : source.length;
      tokens.push({
        kind: "cdata",
        raw: source.slice(cursor, close),
        start: cursor,
        end: close
      });
      cursor = close;
      continue;
    }

    if (source.startsWith("<?xml", cursor)) {
      const end = source.indexOf("?>", cursor + 5);
      const close = end >= 0 ? end + 2 : source.length;
      tokens.push({
        kind: "xmlDecl",
        raw: source.slice(cursor, close),
        start: cursor,
        end: close
      });
      cursor = close;
      continue;
    }

    if (source[cursor] === "<") {
      const tagEnd = findTagEnd(source, cursor + 1);
      if (tagEnd > cursor) {
        const raw = source.slice(cursor, tagEnd + 1);
        tokens.push(parseTagToken(raw, cursor, tagEnd + 1));
        cursor = tagEnd + 1;
        continue;
      }
    }

    const nextTag = source.indexOf("<", cursor);
    const end = nextTag >= 0 ? nextTag : source.length;
    tokens.push({
      kind: "text",
      raw: source.slice(cursor, end),
      start: cursor,
      end
    });
    cursor = end;
  }

  return tokens;
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if ((ch === '"' || ch === "'") && source[i - 1] !== "\\") {
      if (quote === undefined) {
        quote = ch;
      } else if (quote === ch) {
        quote = undefined;
      }
      continue;
    }

    if (ch === ">" && quote === undefined) {
      return i;
    }
  }

  return -1;
}

function parseTagToken(raw: string, start: number, end: number): XmlToken {
  const closingMatch = raw.match(/^<\s*\/\s*([^\s>]+)[^>]*>$/s);
  if (closingMatch) {
    return {
      kind: "closingTag",
      raw,
      start,
      end,
      name: closingMatch[1]
    };
  }

  const selfClosingMatch = raw.match(/^<\s*([^\s/>]+)([\s\S]*?)\/\s*>$/s);
  if (selfClosingMatch) {
    return {
      kind: "selfClosingTag",
      raw,
      start,
      end,
      name: selfClosingMatch[1],
      attributesRaw: selfClosingMatch[2] ?? ""
    };
  }

  const openingMatch = raw.match(/^<\s*([^\s/>]+)([\s\S]*?)>$/s);
  if (openingMatch) {
    return {
      kind: "openingTag",
      raw,
      start,
      end,
      name: openingMatch[1],
      attributesRaw: openingMatch[2] ?? ""
    };
  }

  return {
    kind: "text",
    raw,
    start,
    end
  };
}

