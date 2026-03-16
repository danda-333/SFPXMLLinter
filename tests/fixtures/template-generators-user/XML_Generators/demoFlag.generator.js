module.exports = {
  kind: "document",
  id: "demo-flag-generator",
  description: "Fixture-only document generator used for multi-generator/fail-safe scenarios.",
  applies(ctx) {
    const rel = String(ctx.input.relativeTemplatePath ?? "").replace(/\\/g, "/");
    return rel.includes("999_T11MultiGeneratorDemo/") || rel.includes("999_T11FailSafeDemo/");
  },
  run(ctx) {
    const marker = "<GeneratedByDemoGenerator Value=\"yes\" />";
    const xml = ctx.document.getXml();
    if (xml.includes(marker)) {
      return;
    }
    const updated = xml.replace(/<\/\s*Form\s*>/i, `${marker}</Form>`);
    if (updated !== xml) {
      ctx.document.setXml(updated);
    }
  }
};
