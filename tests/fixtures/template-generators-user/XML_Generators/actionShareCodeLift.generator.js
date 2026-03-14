module.exports = {
  kind: "document",
  id: "lift-repeated-actions-to-sharecode",
  description: "Lift repeated Button Actions sequences to ActionShareCode and replace usage with ShareCode action.",
  applies(ctx) {
    const relative = String(ctx.input.relativeTemplatePath ?? "");
    if (relative && !/^Demo\//.test(relative) && !relative.includes("999_T11GeneratorDemo")) {
      return false;
    }
    const xml = ctx.document.getXml();
    return /<\s*WorkFlow\b/i.test(xml) && /<\s*Button\b/i.test(xml);
  },
  run(ctx) {
    const result = liftRepeatedActionsToShareCode(ctx.document.getXml());
    if (result.changed) {
      ctx.document.setXml(result.xml);
    }
    for (const warning of result.warnings) {
      ctx.warn(warning.code, warning.message);
    }
  }
};

function liftRepeatedActionsToShareCode(xml) {
  const warnings = [];
  const workflowBlock = collectTagBlocks(xml, "WorkFlow")[0];
  if (!workflowBlock) {
    return { xml, changed: false, warnings };
  }

  const buttonBlocks = collectTagBlocks(workflowBlock.body, "Button");
  const duplicates = findDuplicateActionSequences(workflowBlock, buttonBlocks, warnings);
  if (duplicates.length === 0) {
    return { xml, changed: false, warnings };
  }

  const existingShareCodeBlocks = collectTagBlocks(workflowBlock.body, "ActionShareCode");
  const existingByBody = indexExistingShareCodesByBody(existingShareCodeBlocks);
  const existingIdents = new Set(extractActionShareCodeIdents(workflowBlock.body));

  const planned = new Map();
  for (const group of duplicates.sort((a, b) => a.occurrences[0].start - b.occurrences[0].start)) {
    const existingMatches = existingByBody.get(group.normalizedBody) ?? [];
    if (existingMatches.length > 1) {
      warnings.push({
        code: "generator-ambiguous-existing-sharecode",
        message: `Ambiguous existing ActionShareCode mapping for duplicated action sequence (${existingMatches.length} matches); skipping lift.`
      });
      continue;
    }
    if (existingMatches.length === 1) {
      planned.set(group.normalizedBody, {
        ident: existingMatches[0],
        occurrences: group.occurrences,
        createNew: false
      });
      continue;
    }

    const ident = createGeneratedIdent(existingIdents);
    existingIdents.add(ident);
    planned.set(group.normalizedBody, {
      ident,
      occurrences: group.occurrences,
      createNew: true
    });
  }

  if (planned.size === 0) {
    return { xml, changed: false, warnings };
  }

  let out = xml;
  const replacements = [...planned.values()]
    .flatMap((item) => item.occurrences.map((occurrence) => ({ occurrence, ident: item.ident })))
    .sort((a, b) => b.occurrence.start - a.occurrence.start);

  for (const { occurrence, ident } of replacements) {
    const replacementBody = buildShareCodeActionBody(occurrence.rawBody, ident);
    out = `${out.slice(0, occurrence.start)}${replacementBody}${out.slice(occurrence.end)}`;
  }

  const createdEntries = [...planned.values()].filter((item) => item.createNew);
  if (createdEntries.length > 0) {
    out = appendActionShareCodes(out, createdEntries);
  }

  return { xml: out, changed: out !== xml, warnings };
}

function appendActionShareCodes(xml, entries) {
  const workflow = collectTagBlocks(xml, "WorkFlow")[0];
  if (!workflow) {
    return xml;
  }

  const actionShareCodesBlocks = collectTagBlocks(workflow.body, "ActionShareCodes");
  const generated = entries
    .sort((a, b) => a.ident.localeCompare(b.ident))
    .map((entry) => buildGeneratedActionShareCodeBlock(entry.ident, entry.occurrences[0].rawBody))
    .join("");

  if (actionShareCodesBlocks.length > 0) {
    const container = actionShareCodesBlocks[0];
    const insertOffset = workflow.openEnd + container.closeStart;
    return `${xml.slice(0, insertOffset)}${generated}${xml.slice(insertOffset)}`;
  }

  const workflowIndent = findIndentForOffset(xml, workflow.start);
  const containerIndent = `${workflowIndent}  `;
  const container = `\n${containerIndent}<ActionShareCodes>${generated}${containerIndent}</ActionShareCodes>`;
  const workflowCloseStart = workflow.closeStart;
  return `${xml.slice(0, workflowCloseStart)}${container}\n${workflowIndent}${xml.slice(workflowCloseStart)}`;
}

function buildGeneratedActionShareCodeBlock(ident, rawActionsBody) {
  const normalizedBody = rawActionsBody.trim();
  const childIndent = "      ";
  const indentedBody = normalizedBody
    .split(/\r?\n/)
    .map((line) => `${childIndent}${line.trim()}`)
    .join("\n");
  return `\n    <ActionShareCode Ident="${ident}">\n${indentedBody}\n    </ActionShareCode>\n  `;
}

function buildShareCodeActionBody(originalBody, ident) {
  const lineEnding = originalBody.includes("\r\n") ? "\r\n" : "\n";
  const actionIndent = detectChildIndent(originalBody);
  const parentIndent = detectParentIndent(originalBody, actionIndent);
  return `${lineEnding}${actionIndent}<Action xsi:type="ShareCode" Ident="${ident}" />${lineEnding}${parentIndent}`;
}

function detectChildIndent(originalBody) {
  for (const line of originalBody.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = /^(\s+)/.exec(line);
    if (match) {
      return match[1];
    }
  }
  return "      ";
}

function detectParentIndent(originalBody, childIndent) {
  if (childIndent.length >= 2) {
    return childIndent.slice(0, childIndent.length - 2);
  }
  return "    ";
}

function createGeneratedIdent(existing) {
  for (let i = 1; i <= 9999; i++) {
    const candidate = `AutoLiftActionShareCode${i}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `AutoLiftActionShareCode${Date.now()}`;
}

function indexExistingShareCodesByBody(blocks) {
  const out = new Map();
  for (const block of blocks) {
    const ident = parseXmlAttributes(block.attrs).get("Ident");
    if (!ident) {
      continue;
    }
    const normalizedBody = normalizeActionSequenceBody(block.body);
    if (!normalizedBody) {
      continue;
    }
    const list = out.get(normalizedBody) ?? [];
    list.push(ident);
    out.set(normalizedBody, list);
  }
  return out;
}

function findDuplicateActionSequences(workflow, buttonBlocks, warnings) {
  const byBody = new Map();
  for (const button of buttonBlocks) {
    const actionBlocks = collectTagBlocks(button.body, "Actions");
    if (actionBlocks.length === 0) {
      continue;
    }
    const actionBlock = actionBlocks[0];
    const rawBody = actionBlock.body;
    if (rawBody.includes("{{")) {
      warnings.push({
        code: "generator-skipped-placeholder-sequence",
        message: "Skipped action sequence with unresolved placeholders."
      });
      continue;
    }
    const normalizedBody = normalizeActionSequenceBody(rawBody);
    if (!normalizedBody) {
      continue;
    }
    if (isPureShareCodeSequence(normalizedBody)) {
      continue;
    }
    const absoluteStart = workflow.openEnd + button.openEnd + actionBlock.openEnd;
    const absoluteEnd = workflow.openEnd + button.openEnd + actionBlock.closeStart;
    const list = byBody.get(normalizedBody) ?? [];
    list.push({ start: absoluteStart, end: absoluteEnd, rawBody });
    byBody.set(normalizedBody, list);
  }

  return [...byBody.entries()]
    .filter(([, occurrences]) => occurrences.length >= 2)
    .map(([normalizedBody, occurrences]) => ({ normalizedBody, occurrences }));
}

function isPureShareCodeSequence(normalizedBody) {
  const actionTags = normalizedBody.match(/<Action\b[\s\S]*?(?:\/>|<\/Action>)/g) ?? [];
  if (actionTags.length === 0) {
    return false;
  }
  return actionTags.every((tag) => /\bxsi:type\s*=\s*(?:"ShareCode"|'ShareCode')/i.test(tag));
}

function normalizeActionSequenceBody(rawBody) {
  const strippedComments = rawBody.replace(/<!--[\s\S]*?-->/g, "");
  const actionTags = strippedComments.match(/<Action\b[\s\S]*?(?:\/>|<\/Action>)/g) ?? [];
  if (actionTags.length === 0) {
    return "";
  }
  return actionTags.map((tag) => normalizeXmlTag(tag)).join("");
}

function extractActionShareCodeIdents(workflowBody) {
  const regex = /<ActionShareCode\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const out = [];
  for (const match of workflowBody.matchAll(regex)) {
    const ident = (match[1] ?? match[2] ?? "").trim();
    if (ident) {
      out.push(ident);
    }
  }
  return out;
}

function normalizeXmlTag(tag) {
  const isClosing = /^<\s*\//.test(tag);
  const isSelfClosing = /\/\s*>$/.test(tag);
  const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag);
  const name = nameMatch?.[1] ?? "";
  if (!name) {
    return tag.trim();
  }
  if (isClosing) {
    return `</${name}>`;
  }
  const attrs = [];
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }
    const value = match[2] ?? match[3] ?? "";
    attrs.push(`${key}="${value}"`);
  }
  attrs.sort((a, b) => a.localeCompare(b));
  const attrsText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return isSelfClosing ? `<${name}${attrsText} />` : `<${name}${attrsText}>`;
}

function parseXmlAttributes(rawAttrs) {
  const out = new Map();
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

function collectTagBlocks(text, tagName) {
  const escapedTagName = escapeRegex(tagName);
  const tokenRegex = new RegExp(`<\\s*(\\/?)\\s*${escapedTagName}\\b([^>]*)>`, "gi");
  const stack = [];
  const blocks = [];
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
        blocks.push({ start, end, openEnd: end, closeStart: start, attrs, body: "" });
        continue;
      }
      stack.push({ start, openEnd: end, attrs });
      continue;
    }

    const top = stack.pop();
    if (!top) {
      continue;
    }
    blocks.push({
      start: top.start,
      end,
      openEnd: top.openEnd,
      closeStart: start,
      attrs: top.attrs,
      body: text.slice(top.openEnd, start)
    });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function findIndentForOffset(text, offset) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1));
  const start = lineStart < 0 ? 0 : lineStart + 1;
  const linePrefix = text.slice(start, offset);
  const match = /^(\s*)/.exec(linePrefix);
  return match?.[1] ?? "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
