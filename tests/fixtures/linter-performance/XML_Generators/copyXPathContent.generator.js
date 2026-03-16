module.exports = {
  kind: "snippet",
  id: "copy-xpath-content",
  selector: "Common/XML/CopyXPathContent",
  description: "Copies XML from SourceXPath and replaces the snippet at the usage site.",
  run(ctx) {
    const sourceXPath = (ctx.snippet.attrs.get("SourceXPath") ?? "").trim();
    const copyModeRaw = (ctx.snippet.attrs.get("CopyMode") ?? "inner").trim().toLowerCase();
    const copyMode = copyModeRaw === "outer" ? "outer" : "inner";

    if (!sourceXPath) {
      ctx.warn("generator-copy-xpath-missing-source", "Skipped snippet: missing SourceXPath attribute.");
      return;
    }

    const xml = ctx.document.getXml();
    const node = selectFirstNodeByAbsoluteXPath(xml, sourceXPath);
    if (!node) {
      ctx.warn("generator-copy-xpath-source-not-found", `SourceXPath '${sourceXPath}' did not match any node.`);
      return;
    }

    const rawSource = copyMode === "outer"
      ? xml.slice(node.start, node.end)
      : xml.slice(node.openEnd, node.closeStart);
    const indent = detectIndentBeforeOffset(xml, ctx.snippet.start);
    const lineEnding = xml.includes("\r\n") ? "\r\n" : "\n";
    const replacement = alignForSnippetInsertion(rawSource, indent, lineEnding);

    if (!replacement.trim()) {
      ctx.warn("generator-copy-xpath-empty-source", `SourceXPath '${sourceXPath}' produced empty content.`);
    }

    ctx.replaceSnippet(replacement);
  }
};

function alignForSnippetInsertion(raw, indent, lineEnding) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return "";
  }

  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const match = /^([ \t]*)/.exec(line);
    const current = match ? match[1].length : 0;
    if (current < minIndent) {
      minIndent = current;
    }
  }
  if (!Number.isFinite(minIndent)) {
    minIndent = 0;
  }

  const dedented = lines.map((line) => line.slice(minIndent));
  return dedented
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join(lineEnding);
}

function detectIndentBeforeOffset(text, offset) {
  const nl = text.lastIndexOf("\n", Math.max(0, offset - 1));
  const lineStart = nl >= 0 ? nl + 1 : 0;
  const prefix = text.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

function selectFirstNodeByAbsoluteXPath(xml, xpath) {
  const segments = parseAbsoluteXPath(xpath);
  if (segments.length === 0) {
    return null;
  }

  const roots = parseXmlElementTree(xml);
  let current = roots.filter((node) => matchesSegment(node, segments[0]));
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const next = [];
    for (const parent of current) {
      for (const child of parent.children) {
        if (matchesSegment(child, segment)) {
          next.push(child);
        }
      }
    }
    current = next;
    if (current.length === 0) {
      break;
    }
  }

  return current[0] ?? null;
}

function parseAbsoluteXPath(xpath) {
  const value = String(xpath ?? "").trim();
  if (!value || !value.startsWith("/")) {
    return [];
  }
  const rawParts = value.split("/").filter((part) => part.length > 0);
  const out = [];
  for (const part of rawParts) {
    const segment = parseSegment(part);
    if (!segment) {
      return [];
    }
    out.push(segment);
  }
  return out;
}

function parseSegment(part) {
  const simple = /^([A-Za-z_][\w:.-]*)$/.exec(part);
  if (simple) {
    return { name: simple[1], attrName: "", attrValue: "" };
  }
  const withPredicate = /^([A-Za-z_][\w:.-]*)\[@([A-Za-z_][\w:.-]*)=(?:"([^"]*)"|'([^']*)')\]$/.exec(part);
  if (!withPredicate) {
    return null;
  }
  return {
    name: withPredicate[1],
    attrName: withPredicate[2],
    attrValue: withPredicate[3] ?? withPredicate[4] ?? ""
  };
}

function matchesSegment(node, segment) {
  if (node.name !== segment.name) {
    return false;
  }
  if (!segment.attrName) {
    return true;
  }
  return node.attrs.get(segment.attrName) === segment.attrValue;
}

function parseXmlElementTree(text) {
  const tokenRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  const roots = [];
  const stack = [];
  for (const match of text.matchAll(tokenRegex)) {
    const closingSlash = match[1] ?? "";
    const name = match[2] ?? "";
    const attrsRaw = match[3] ?? "";
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (!name || start < 0) {
      continue;
    }
    const end = start + token.length;
    const isClosing = closingSlash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      const node = {
        name,
        attrs: parseAttributes(attrsRaw),
        start,
        openEnd: end,
        closeStart: end,
        end,
        children: []
      };
      if (isSelfClosing) {
        appendNode(roots, stack, node);
      } else {
        stack.push(node);
      }
      continue;
    }

    const openIndex = findLastIndex(stack, (item) => item.name === name);
    if (openIndex < 0) {
      continue;
    }
    const node = stack[openIndex];
    stack.length = openIndex;
    node.closeStart = start;
    node.end = end;
    appendNode(roots, stack, node);
  }
  return roots;
}

function appendNode(roots, stack, node) {
  if (stack.length > 0) {
    stack[stack.length - 1].children.push(node);
  } else {
    roots.push(node);
  }
}

function findLastIndex(items, predicate) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) {
      return i;
    }
  }
  return -1;
}

function parseAttributes(raw) {
  const out = new Map();
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }
    out.set(key, (match[2] ?? match[3] ?? "").trim());
  }
  return out;
}
