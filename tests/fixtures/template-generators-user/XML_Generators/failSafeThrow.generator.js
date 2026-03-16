module.exports = {
  kind: "document",
  id: "fail-safe-throw-generator",
  description: "Fixture-only generator that throws to validate fail-safe behavior.",
  applies(ctx) {
    const rel = String(ctx.input.relativeTemplatePath ?? "").replace(/\\/g, "/");
    return rel.includes("999_T11FailSafeDemo/");
  },
  run() {
    throw new Error("Intentional fixture generator error");
  }
};
