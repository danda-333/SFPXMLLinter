module.exports = {
  kind: "snippet",
  id: "lift-actions-to-sharecode",
  selector: "Common/WorkFlow/LiftActionsToShareCode",
  description: "Replaces inline actions with ShareCode action and ensures ActionShareCode exists.",
  run(ctx) {
    const xmlBefore = ctx.document.getXml();
    const explicitIdent = (ctx.snippet.attrs.get("Ident") ?? "").trim();
    const shareCodeIdentPostFix = (
      ctx.snippet.attrs.get("ShareCodeIdentPostFix")
      ?? "_SaveDialogCommunicationAction_ActionShare"
    ).trim();
    const buttonIdent = explicitIdent || findEnclosingButtonIdent(xmlBefore, ctx.snippet.start);

    if (!buttonIdent) {
      ctx.warn("generator-lift-actions-missing-ident", "Could not resolve Ident for ShareCode action.");
      return;
    }

    const shareIdent = `${buttonIdent}${shareCodeIdentPostFix}`;
    const shareAction = `<Action xsi:type="ShareCode" Ident="${ctx.helpers.xml.escapeAttr(shareIdent)}" />`;
    ctx.replaceSnippet(shareAction);

    if (hasActionShareCodeIdent(ctx.document.getXml(), shareIdent)) {
      return;
    }

    const normalizedBody = normalizeSnippetBody(ctx.snippet.innerXml);
    if (!normalizedBody) {
      ctx.warn("generator-lift-actions-empty-body", `No actions to move into ActionShareCode '${shareIdent}'.`);
      return;
    }

    const actionShareCodeXml = buildActionShareCodeBlock(shareIdent, normalizedBody);
    const appended = ctx.document.append("//WorkFlow/ActionShareCodes", actionShareCodeXml, false);
    if (appended.insertCount > 0) {
      return;
    }

    const fallbackContainer = `\n  <ActionShareCodes>${actionShareCodeXml}  </ActionShareCodes>`;
    const fallback = ctx.document.append("//WorkFlow", fallbackContainer, false);
    if (fallback.insertCount === 0) {
      ctx.warn("generator-lift-actions-workflow-missing", `Could not insert ActionShareCode '${shareIdent}' because //WorkFlow was not found.`);
    }
  }
};

function normalizeSnippetBody(innerXml) {
  const normalized = String(innerXml ?? "").replace(/\r\n/g, "\n");
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

  return lines.map((line) => line.slice(minIndent)).join("\n");
}

function buildActionShareCodeBlock(ident, body) {
  const indentedBody = body
    .split(/\r?\n/)
    .map((line) => `        ${line}`)
    .join("\n");
  return `\n    <ActionShareCode Ident="${escapeXmlAttr(ident)}">\n      <Actions>\n${indentedBody}\n      </Actions>\n    </ActionShareCode>\n`;
}

function hasActionShareCodeIdent(xml, ident) {
  const escaped = escapeRegex(ident);
  const regex = new RegExp(`<\\s*ActionShareCode\\b[^>]*\\bIdent\\s*=\\s*(?:"${escaped}"|'${escaped}')`, "i");
  return regex.test(xml);
}

function findEnclosingButtonIdent(xml, offset) {
  const tokenRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  const stack = [];
  for (const match of xml.matchAll(tokenRegex)) {
    const slash = match[1] ?? "";
    const tagName = match[2] ?? "";
    const attrsRaw = match[3] ?? "";
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (!tagName || start < 0 || start > offset) {
      break;
    }
    const isClosing = slash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      const attrs = parseAttributes(attrsRaw);
      if (!isSelfClosing) {
        stack.push({ tagName, attrs });
      }
      continue;
    }

    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tagName === tagName) {
        stack.length = i;
        break;
      }
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const item = stack[i];
    if (item.tagName !== "Button") {
      continue;
    }
    const ident = item.attrs.get("Ident");
    if (ident) {
      return ident;
    }
  }

  return "";
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

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
