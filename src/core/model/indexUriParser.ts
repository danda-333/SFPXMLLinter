import * as vscode from "vscode";

export function parseIndexUriKey(uriKey: string): vscode.Uri | undefined {
  try {
    if (uriKey.includes("://")) {
      const parsed = vscode.Uri.parse(uriKey);
      return parsed.scheme === "file" ? vscode.Uri.file(parsed.fsPath) : parsed;
    }
    return vscode.Uri.file(uriKey);
  } catch {
    return undefined;
  }
}

