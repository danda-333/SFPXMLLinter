module.exports = {
  kind: "snippet",
  id: "button-with-confirm-dialog",
  selector: "Common/Buttons/ButtonWithDialog",
  description: "Expands UseGenerator snippet into Form Button + ConfirmFormDialogSection.",
  run(ctx) {
    const xml = ctx.helpers.xml;
    const attrs = ctx.snippet.attrs;
    const buttonIdent = (attrs.get("Ident") ?? "").trim();
    const sectionIdent = (attrs.get("DialogSectionIdent") ?? "").trim();
    if (!buttonIdent) {
      ctx.warn("generator-button-with-dialog-missing-ident", "Skipped snippet: missing Ident attribute.");
      return;
    }
    if (!sectionIdent) {
      ctx.warn("generator-button-with-dialog-missing-section", `Skipped snippet '${buttonIdent}': missing DialogSectionIdent.`);
      return;
    }

    const extensionIdent = (attrs.get("DialogExtensionIdent") ?? `${buttonIdent}ConfirmFormDialog`).trim();
    const buttonTitle = attrs.get("TitleResourceKey") ?? "";
    const isSave = attrs.get("IsSave") ?? "";
    const dialogTitle = attrs.get("DialogTitleResourceKey") ?? "";
    const dialogConfirm = attrs.get("DialogConfirmButtonTitleResourceKey") ?? "";
    const dialogClose = attrs.get("DialogCloseButtonTitleResourceKey") ?? "";

    const actions = xml.extractTagBody(ctx.snippet.innerXml, "Actions").trim();
    const dialogTemplateRaw = xml.extractTagBody(ctx.snippet.innerXml, "DialogHTMLTemplate").trim();

    const buttonXml = [
      `<Button Ident="${xml.escapeAttr(buttonIdent)}"${buttonTitle ? ` TitleResourceKey="${xml.escapeAttr(buttonTitle)}"` : ""}${isSave ? ` IsSave="${xml.escapeAttr(isSave)}"` : ""} xsi:type="FormButton">`,
      `  <Extensions>`,
      `    <Extension xsi:type="ConfirmFormDialogExtension" Ident="${xml.escapeAttr(extensionIdent)}" ConfirmFormDialogSectionIdent="${xml.escapeAttr(sectionIdent)}" />`,
      `  </Extensions>`,
      `  <Actions>${actions}</Actions>`,
      `</Button>`
    ].join("\n");

    const sectionXml = [
      `<Section xsi:type="ConfirmFormDialogSection" Ident="${xml.escapeAttr(sectionIdent)}"${dialogClose ? ` CloseButtonTitleResourceKey="${xml.escapeAttr(dialogClose)}"` : ""}${dialogConfirm ? ` ConfirmButtonTitleResourceKey="${xml.escapeAttr(dialogConfirm)}"` : ""}${dialogTitle ? ` TitleResourceKey="${xml.escapeAttr(dialogTitle)}"` : ""}>`,
      `  <HTMLTemplate>${dialogTemplateRaw}</HTMLTemplate>`,
      `</Section>`
    ].join("\n");

    const insert = ctx.document.append("//Form/Sections", `\n${sectionXml}\n`, false);
    if (insert.insertCount === 0) {
      ctx.warn("generator-button-with-dialog-sections-missing", `Could not append dialog section for '${buttonIdent}' because //Form/Sections was not found.`);
    }

    ctx.replaceSnippet(buttonXml);
  }
};
