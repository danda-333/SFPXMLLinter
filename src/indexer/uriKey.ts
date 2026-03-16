import * as vscode from "vscode";

export function toIndexUriKey(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    return uri.fsPath.replace(/\\/g, "/").toLowerCase();
  }
  return uri.toString();
}

