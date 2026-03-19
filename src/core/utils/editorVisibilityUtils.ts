import * as vscode from "vscode";

export function getUserOpenUris(): vscode.Uri[] {
  const map = new Map<string, vscode.Uri>();

  for (const editor of vscode.window.visibleTextEditors) {
    map.set(editor.document.uri.toString(), editor.document.uri);
  }

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (input.uri.scheme === "file") {
          map.set(input.uri.toString(), input.uri);
        }
        continue;
      }

      if (input instanceof vscode.TabInputTextDiff) {
        if (input.original.scheme === "file") {
          map.set(input.original.toString(), input.original);
        }
        if (input.modified.scheme === "file") {
          map.set(input.modified.toString(), input.modified);
        }
        continue;
      }
    }
  }

  return [...map.values()];
}

export function isUserOpenDocument(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return getUserOpenUris().some((u) => u.toString() === key);
}

