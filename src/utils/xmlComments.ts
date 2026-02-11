export function maskXmlComments(text: string): string {
  if (!text.includes("<!--")) {
    return text;
  }

  return text.replace(/<!--[\s\S]*?-->/g, (comment) => {
    let out = "";
    for (let i = 0; i < comment.length; i++) {
      const ch = comment[i];
      out += ch === "\n" || ch === "\r" ? ch : " ";
    }
    return out;
  });
}
