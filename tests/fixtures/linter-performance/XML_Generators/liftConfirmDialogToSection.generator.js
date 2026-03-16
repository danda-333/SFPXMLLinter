module.exports = {
  kind: "snippet",
  id: "lift-confirm-dialog-to-section",
  selector: "Common/Dialogs/LiftConfirmDialogToSection",
  description: "Moves ConfirmFormDialogSection from button snippet to //Form/Sections and replaces usage with ConfirmFormDialogExtension.",
  run(ctx) {
    const sectionBlock = findFirstConfirmFormDialogSection(ctx.snippet.innerXml);
    if (!sectionBlock) {
      ctx.warn("generator-confirm-dialog-section-missing", "Snippet does not contain a ConfirmFormDialogSection.");
      return;
    }

    const sectionIdent = (sectionBlock.attrs.get("Ident") ?? "").trim();
    if (!sectionIdent) {
      ctx.warn("generator-confirm-dialog-ident-missing", "ConfirmFormDialogSection is missing Ident.");
      return;
    }

    const extensionIdent = (ctx.snippet.attrs.get("Ident") ?? "").trim();

    const extensionXml = extensionIdent
      ? `<Extension xsi:type="ConfirmFormDialogExtension" Ident="${ctx.helpers.xml.escapeAttr(extensionIdent)}" ConfirmFormDialogSectionIdent="${ctx.helpers.xml.escapeAttr(sectionIdent)}" />`
      : `<Extension xsi:type="ConfirmFormDialogExtension" ConfirmFormDialogSectionIdent="${ctx.helpers.xml.escapeAttr(sectionIdent)}" />`;
    ctx.replaceSnippet(extensionXml);

    const currentXml = ctx.document.getXml();
    if (hasSectionIdent(currentXml, sectionIdent)) {
      return;
    }

    const lineEnding = currentXml.includes("\r\n") ? "\r\n" : "\n";
    const normalizedSection = normalizeXmlBlock(sectionBlock.outerXml, "    ", lineEnding);
    const appendResult = ctx.document.append("//Form/Sections", `${lineEnding}${normalizedSection}${lineEnding}`, false);
    if (appendResult.insertCount === 0) {
      ctx.warn("generator-confirm-dialog-sections-missing", `Could not append section '${sectionIdent}' because //Form/Sections was not found.`);
    }
  }
};

function hasSectionIdent(xml, sectionIdent) {
  const escaped = escapeRegex(sectionIdent);
  const regex = new RegExp(`<\\s*Section\\b[^>]*\\bIdent\\s*=\\s*(?:"${escaped}"|'${escaped}')`, "i");
  return regex.test(xml);
}

function findFirstConfirmFormDialogSection(text) {
  const blocks = collectTagBlocks(text, "Section");
  for (const block of blocks) {
    const xsiType = (block.attrs.get("xsi:type") ?? "").trim();
    if (xsiType === "ConfirmFormDialogSection") {
      return block;
    }
  }
  return null;
}

function collectTagBlocks(text, tagName) {
  const out = [];
  const openClose = new RegExp(`<\\s*(/?)\\s*${escapeRegex(tagName)}\\b([^>]*)>`, "gi");
  const stack = [];
  for (const match of text.matchAll(openClose)) {
    const slash = match[1] ?? "";
    const attrsRaw = match[2] ?? "";
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
        out.push({
          outerXml: token,
          innerXml: "",
          attrs: parseAttributes(attrsRaw)
        });
      } else {
        stack.push({ start, openEnd: end, attrsRaw });
      }
      continue;
    }

    if (stack.length === 0) {
      continue;
    }
    const top = stack.pop();
    if (!top) {
      continue;
    }
    out.push({
      outerXml: text.slice(top.start, end),
      innerXml: text.slice(top.openEnd, start),
      attrs: parseAttributes(top.attrsRaw)
    });
  }
  return out;
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

function normalizeXmlBlock(raw, indent, lineEnding) {
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
    const current = (/^([ \t]*)/.exec(line)?.[1].length) ?? 0;
    if (current < minIndent) {
      minIndent = current;
    }
  }
  if (!Number.isFinite(minIndent)) {
    minIndent = 0;
  }

  return lines
    .map((line) => `${indent}${line.slice(minIndent)}`)
    .join(lineEnding);
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
