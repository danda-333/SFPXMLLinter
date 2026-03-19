import * as vscode from "vscode";
import { SfpXmlLinterSettings } from "../../config/settings";

export function isReindexRelevantUri(uri: vscode.Uri, settings: SfpXmlLinterSettings): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
  if (!rel.endsWith(".xml")) {
    return false;
  }

  return settings.workspaceRoots.some((root) => {
    const normalized = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (normalized.length === 0) {
      return false;
    }

    return rel === normalized || rel.startsWith(`${normalized}/`) || rel.includes(`/${normalized}/`);
  });
}

export function isSfpSettingsUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  const fileName = uri.fsPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  return fileName === ".sfpxmlsetting" || fileName === ".sfpxmlsettings";
}

export function getProjectKeyForUri(uri: vscode.Uri, settings: SfpXmlLinterSettings): string | undefined {
  if (uri.scheme !== "file") {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  const relLower = rel.toLowerCase();

  let bestRootStart = Number.MAX_SAFE_INTEGER;
  let matched = false;
  for (const root of settings.workspaceRoots) {
    const normalized = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!normalized) {
      continue;
    }

    if (relLower === normalized || relLower.startsWith(`${normalized}/`)) {
      matched = true;
      bestRootStart = 0;
      break;
    }

    const token = `/${normalized}/`;
    const idx = relLower.indexOf(token);
    if (idx < 0) {
      continue;
    }

    matched = true;
    const start = idx + 1;
    if (start < bestRootStart) {
      bestRootStart = start;
    }
  }

  if (!matched) {
    return undefined;
  }

  const prefix = bestRootStart <= 0 ? "." : rel.slice(0, bestRootStart - 1);
  const workspaceKey = workspaceFolder?.uri.fsPath ?? "__no_workspace__";
  return `${workspaceKey}|${prefix || "."}`;
}

