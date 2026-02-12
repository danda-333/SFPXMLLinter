import * as vscode from "vscode";

const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}/g;

export class SfpXmlColorProvider implements vscode.DocumentColorProvider {
  provideDocumentColors(document: vscode.TextDocument): vscode.ProviderResult<vscode.ColorInformation[]> {
    const text = document.getText();
    const out: vscode.ColorInformation[] = [];

    for (const match of text.matchAll(HEX_COLOR_REGEX)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0 || !isValidHexLength(value) || !hasWordBoundaries(text, start, value.length)) {
        continue;
      }

      const color = parseHexColor(value);
      if (!color) {
        continue;
      }

      const range = new vscode.Range(document.positionAt(start), document.positionAt(start + value.length));
      out.push(new vscode.ColorInformation(range, color));
    }

    return out;
  }

  provideColorPresentations(
    color: vscode.Color,
    context: { document: vscode.TextDocument; range: vscode.Range }
  ): vscode.ProviderResult<vscode.ColorPresentation[]> {
    const original = context.document.getText(context.range);
    const preferShort = original.length === 4 || original.length === 5;
    const includeAlpha = original.length === 5 || original.length === 9 || color.alpha < 1;
    const uppercase = /[A-F]/.test(original);

    let label = toHex(color, includeAlpha);
    if (preferShort) {
      const short = toShortHex(color, includeAlpha);
      if (short) {
        label = short;
      }
    }

    if (uppercase) {
      label = label.toUpperCase();
    } else {
      label = label.toLowerCase();
    }

    const presentation = new vscode.ColorPresentation(label);
    presentation.textEdit = vscode.TextEdit.replace(context.range, label);
    return [presentation];
  }
}

function isValidHexLength(value: string): boolean {
  const n = value.length - 1;
  return n === 3 || n === 4 || n === 6 || n === 8;
}

function hasWordBoundaries(text: string, start: number, length: number): boolean {
  const prev = start > 0 ? text[start - 1] : "";
  const next = start + length < text.length ? text[start + length] : "";
  return !isWordChar(prev) && !isWordChar(next);
}

function isWordChar(ch: string): boolean {
  return /[0-9A-Za-z_]/.test(ch);
}

function parseHexColor(value: string): vscode.Color | undefined {
  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return new vscode.Color(r / 255, g / 255, b / 255, 1);
  }

  if (hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const a = parseInt(hex[3] + hex[3], 16);
    return new vscode.Color(r / 255, g / 255, b / 255, a / 255);
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return new vscode.Color(r / 255, g / 255, b / 255, a / 255);
  }

  return undefined;
}

function toHex(color: vscode.Color, includeAlpha: boolean): string {
  const r = channelToHex(color.red);
  const g = channelToHex(color.green);
  const b = channelToHex(color.blue);
  const a = channelToHex(color.alpha);
  return includeAlpha ? `#${r}${g}${b}${a}` : `#${r}${g}${b}`;
}

function toShortHex(color: vscode.Color, includeAlpha: boolean): string | undefined {
  const full = toHex(color, includeAlpha).slice(1);
  const pairs = full.match(/../g);
  if (!pairs) {
    return undefined;
  }

  for (const pair of pairs) {
    if (pair[0] !== pair[1]) {
      return undefined;
    }
  }

  return `#${pairs.map((p) => p[0]).join("")}`;
}

function channelToHex(value: number): string {
  const n = Math.max(0, Math.min(255, Math.round(value * 255)));
  return n.toString(16).padStart(2, "0");
}
