module.exports = {
  kind: "document",
  id: "user-add-flag",
  description: "Example user-defined generator that appends marker node to Form.",
  applies(ctx) {
    return /<\s*Form\b/i.test(ctx.document.getXml());
  },
  run(ctx) {
    const xml = ctx.document.getXml();
    const marker = "<GeneratedByUserScript Value=\"yes\" />";
    if (xml.includes(marker)) {
      return;
    }
    const updated = xml.replace(/<\/\s*Form\s*>/i, `${marker}</Form>`);
    if (updated !== xml) {
      ctx.document.setXml(updated);
    }
  }
};
