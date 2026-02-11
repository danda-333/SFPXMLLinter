import * as vscode from "vscode";
import { maskXmlComments } from "../utils/xmlComments";

const TOKEN_TYPES = ["sfpSqlPlaceholder", "sfpSqlString"];
const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, []);

export class SfpSqlPlaceholderSemanticProvider implements vscode.DocumentSemanticTokensProvider {
  public static readonly legend = legend;

  public provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();
    const maskedText = maskXmlComments(text);
    const blockRegex = /<(?:(?:[A-Za-z_][\w.-]*:)?(?:SQL|Command))\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*:)?(?:SQL|Command))>/gi;
    const placeholderRegex = /#[^#\s]+#/g;
    const sqlStringRegex = /'(?:''|[^'\r\n])*'/g;

    for (const blockMatch of maskedText.matchAll(blockRegex)) {
      const whole = blockMatch[0];
      const content = blockMatch[1] ?? "";
      if (!whole || content.length === 0) {
        continue;
      }

      const openTagEnd = whole.indexOf(">");
      if (openTagEnd < 0) {
        continue;
      }

      const contentStartOffset = (blockMatch.index ?? 0) + openTagEnd + 1;
      const maskedContent = maskXmlComments(content);

      for (const tokenMatch of maskedContent.matchAll(placeholderRegex)) {
        const token = tokenMatch[0];
        const relativeOffset = tokenMatch.index ?? -1;
        if (!token || relativeOffset < 0) {
          continue;
        }

        const start = document.positionAt(contentStartOffset + relativeOffset);
        const end = document.positionAt(contentStartOffset + relativeOffset + token.length);
        if (start.line !== end.line) {
          continue;
        }

        builder.push(start.line, start.character, token.length, 0, 0);
      }

      for (const stringMatch of maskedContent.matchAll(sqlStringRegex)) {
        const token = stringMatch[0];
        const relativeOffset = stringMatch.index ?? -1;
        if (!token || relativeOffset < 0) {
          continue;
        }

        const start = document.positionAt(contentStartOffset + relativeOffset);
        const end = document.positionAt(contentStartOffset + relativeOffset + token.length);
        if (start.line !== end.line) {
          continue;
        }

        builder.push(start.line, start.character, token.length, 1, 0);
      }
    }

    return builder.build();
  }
}
