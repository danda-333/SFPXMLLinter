export interface LegacyAliasMigrationResult {
  text: string;
  changed: boolean;
  tagChanges: number;
  placeholderChanges: number;
}

export function migrateLegacyAliasesInText(text: string): LegacyAliasMigrationResult {
  const commentRanges = getXmlCommentRanges(text);
  let tagChanges = 0;
  let placeholderChanges = 0;

  const withTagMigration = text.replace(/<\s*(Using|Include)\b[^>]*>/gi, (full, _tagName, offset) => {
    const start = Number(offset) || 0;
    if (isOffsetInRanges(start, commentRanges)) {
      return full;
    }
    const migrated = migrateLegacyTagAliases(full);
    if (migrated !== full) {
      tagChanges++;
    }
    return migrated;
  });

  const withPlaceholderMigration = withTagMigration.replace(/\{\{[\s\S]*?\}\}/g, (full, offset) => {
    const start = Number(offset) || 0;
    if (isOffsetInRanges(start, commentRanges)) {
      return full;
    }
    const migrated = migrateLegacyPlaceholderAliases(full);
    if (migrated !== full) {
      placeholderChanges++;
    }
    return migrated;
  });

  return {
    text: withPlaceholderMigration,
    changed: withPlaceholderMigration !== text,
    tagChanges,
    placeholderChanges
  };
}

export function migrateLegacyTagAliases(tagText: string): string {
  let out = tagText;

  const hasFeature = /\bFeature\s*=/i.test(out);
  if (hasFeature) {
    out = out.replace(/\s+\bComponent\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
    out = out.replace(/\s+\bName\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
  } else {
    out = out.replace(/\bComponent\s*=/gi, "Feature=");
    out = out.replace(/\bName\s*=/gi, "Feature=");
    out = dedupeFirstAttribute(out, "Feature");
  }

  if (/\bContribution\s*=/i.test(out)) {
    out = out.replace(/\s+\bSection\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
  } else {
    out = out.replace(/\bSection\s*=/gi, "Contribution=");
  }

  return out;
}

export function migrateLegacyPlaceholderAliases(placeholderText: string): string {
  const bodyMatch = /^\{\{([\s\S]*)\}\}$/.exec(placeholderText);
  if (!bodyMatch) {
    return placeholderText;
  }

  const body = bodyMatch[1] ?? "";
  const pairs = body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const outPairs: string[] = [];
  let hasFeature = false;
  let hasContribution = false;

  for (const pair of pairs) {
    const idx = pair.indexOf(":");
    if (idx <= 0) {
      outPairs.push(pair);
      continue;
    }
    const rawKey = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    const keyLower = rawKey.toLowerCase();

    if ((keyLower === "component" || keyLower === "name") && !hasFeature) {
      outPairs.push(`Feature:${value}`);
      hasFeature = true;
      continue;
    }
    if (keyLower === "feature") {
      outPairs.push(`Feature:${value}`);
      hasFeature = true;
      continue;
    }
    if (keyLower === "section" && !hasContribution) {
      outPairs.push(`Contribution:${value}`);
      hasContribution = true;
      continue;
    }
    if (keyLower === "contribution") {
      outPairs.push(`Contribution:${value}`);
      hasContribution = true;
      continue;
    }

    outPairs.push(pair);
  }

  return `{{${outPairs.join(",")}}}`;
}

function dedupeFirstAttribute(tagText: string, attrName: string): string {
  const attrRegex = new RegExp(`\\b${attrName}\\s*=\\s*(\"[^\"]*\"|'[^']*')`, "gi");
  let found = false;
  return tagText
    .replace(attrRegex, (full) => {
      if (!found) {
        found = true;
        return full;
      }
      return "";
    })
    .replace(/\s{2,}/g, " ");
}

function getXmlCommentRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /<!--[\s\S]*?-->/g;
  for (const match of text.matchAll(regex)) {
    const start = match.index;
    if (typeof start !== "number") {
      continue;
    }
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function isOffsetInRanges(offset: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) {
      return true;
    }
  }
  return false;
}
