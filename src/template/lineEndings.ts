export function normalizeLineEndingsForTemplate(text: string, templateText: string): string {
  const preferredEol = detectPreferredEol(templateText);
  const normalized = text.replace(/\r\n|\n|\r/g, "\n");
  if (preferredEol === "\n") {
    return normalized;
  }
  return normalized.replace(/\n/g, preferredEol);
}

export function detectPreferredEol(text: string): "\r\n" | "\n" {
  const firstCrLf = text.indexOf("\r\n");
  const firstLf = text.indexOf("\n");
  if (firstCrLf >= 0 && (firstLf < 0 || firstCrLf <= firstLf)) {
    return "\r\n";
  }
  return "\n";
}
