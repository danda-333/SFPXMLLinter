import * as path from "node:path";
import { buildAutoManifestCandidates } from "./autoManifest";

export interface BootstrapManifestDraft {
  feature: string;
  manifestPath: string;
  manifestText: string;
  sourceFiles: string[];
}

export function buildBootstrapManifestDraft(
  rootDir: string,
  activeFilePath: string
): BootstrapManifestDraft | undefined {
  const normalizedActive = normalizePath(activeFilePath);
  const candidates = buildAutoManifestCandidates(rootDir);
  if (candidates.length === 0) {
    return undefined;
  }

  let candidate = candidates.find((item) =>
    item.sourceFiles.some((source) => normalizePath(source.filePath) === normalizedActive)
  );

  if (!candidate) {
    const activeBase = stripFeatureSuffix(path.basename(normalizedActive));
    candidate = candidates.find((item) => item.feature.toLowerCase() === activeBase.toLowerCase());
  }

  if (!candidate) {
    return undefined;
  }

  const entrypointRelative = candidate.manifest.entrypoint ?? candidate.sourceFiles[0]?.relativePath;
  const parentDir = entrypointRelative ? path.dirname(entrypointRelative) : "";
  const manifestPath = path.join(rootDir, parentDir, `${candidate.feature}.feature.json`);
  const manifestText = `${JSON.stringify(candidate.manifest, null, 2)}\n`;

  return {
    feature: candidate.feature,
    manifestPath,
    manifestText,
    sourceFiles: candidate.sourceFiles.map((item) => item.relativePath)
  };
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}

function stripFeatureSuffix(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".feature.xml")) {
    return name.slice(0, -".feature.xml".length);
  }
  if (lower.endsWith(".component.xml")) {
    return name.slice(0, -".component.xml".length);
  }
  if (lower.endsWith(".xml")) {
    return name.slice(0, -".xml".length);
  }
  return name;
}
