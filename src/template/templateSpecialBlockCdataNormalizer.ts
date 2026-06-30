interface TagBlock {
  start: number;
  end: number;
  openTag: string;
  closeTag: string;
  body: string;
}

const SPECIAL_TAGS = ["SQL", "HTMLTemplate"] as const;
const IGNORED_TOKEN_REGEX = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>/gi;

export interface NormalizeTemplateSpecialBlocksResult {
  text: string;
  changedBlocks: number;
}

export function normalizeTemplateSpecialBlocksToCdata(text: string): NormalizeTemplateSpecialBlocksResult {
  let out = text;
  let changedBlocks = 0;

  for (const tagName of SPECIAL_TAGS) {
    const blocks = collectTagBlocks(out, tagName).sort((a, b) => b.start - a.start);
    for (const block of blocks) {
      if (isAlreadyWrappedInCdata(block.body)) {
        continue;
      }
      const replacement = `${block.openTag}<![CDATA[${escapeCdataContent(block.body)}]]>${block.closeTag}`;
      out = `${out.slice(0, block.start)}${replacement}${out.slice(block.end)}`;
      changedBlocks++;
    }
  }

  return {
    text: out,
    changedBlocks
  };
}

function collectTagBlocks(text: string, tagName: string): TagBlock[] {
  const escapedTagName = escapeRegex(tagName);
  const tokenRegex = new RegExp(`<\\s*(\\/?)\\s*(${escapedTagName})\\b([^>]*)>`, "gi");
  const ignoredRanges = collectIgnoredRanges(text);
  const stack: Array<{ start: number; openTag: string }> = [];
  const blocks: TagBlock[] = [];

  for (const match of text.matchAll(tokenRegex)) {
    const slash = match[1] ?? "";
    const token = match[0] ?? "";
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0 || isInsideIgnoredRange(start, ignoredRanges)) {
      continue;
    }

    const end = start + token.length;
    const isClosing = slash === "/";
    const isSelfClosing = !isClosing && /\/\s*>$/.test(token);

    if (!isClosing) {
      if (isSelfClosing) {
        continue;
      }
      stack.push({
        start,
        openTag: token
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
      openTag: top.openTag,
      closeTag: token,
      body: text.slice(top.start + top.openTag.length, start)
    });
  }

  return blocks;
}

function collectIgnoredRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(IGNORED_TOKEN_REGEX)) {
    const start = typeof match.index === "number" ? match.index : -1;
    const token = match[0] ?? "";
    if (start < 0 || token.length === 0) {
      continue;
    }
    ranges.push({
      start,
      end: start + token.length
    });
  }
  return ranges;
}

function isInsideIgnoredRange(offset: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isAlreadyWrappedInCdata(body: string): boolean {
  return /^(\s*)<!\[CDATA\[[\s\S]*\]\]>(\s*)$/.test(body);
}

function escapeCdataContent(body: string): string {
  return body.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
