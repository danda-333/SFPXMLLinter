import { buildEffectiveCompositionModel } from "./effectiveModel";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildAutoManifestCandidates } from "./autoManifest";
import { buildFeatureCapabilityReport, parseFeatureManifestText } from "./manifest";
import { EffectiveCompositionModel, FeatureCapabilityReport, FeatureManifest } from "./model";

export interface FeatureManifestLoadIssue {
  source: string;
  message: string;
}

export interface FeatureManifestRegistry {
  manifestsByFeature: Map<string, FeatureManifest>;
  manifestsBySource: Map<string, FeatureManifest>;
  capabilityReportsByFeature: Map<string, FeatureCapabilityReport>;
  effectiveModelsByFeature: Map<string, EffectiveCompositionModel>;
  issues: FeatureManifestLoadIssue[];
}

export function emptyFeatureManifestRegistry(): FeatureManifestRegistry {
  return {
    manifestsByFeature: new Map(),
    manifestsBySource: new Map(),
    capabilityReportsByFeature: new Map(),
    effectiveModelsByFeature: new Map(),
    issues: []
  };
}

export function discoverFeatureManifestFiles(rootDir: string): string[] {
  const out: string[] = [];
  walk(rootDir, out);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function loadFeatureManifestRegistry(rootDir: string): FeatureManifestRegistry {
  const manifestsByFeature = new Map<string, FeatureManifest>();
  const manifestsBySource = new Map<string, FeatureManifest>();
  const capabilityReportsByFeature = new Map<string, FeatureCapabilityReport>();
  const effectiveModelsByFeature = new Map<string, EffectiveCompositionModel>();
  const issues: FeatureManifestLoadIssue[] = [];

  for (const file of discoverFeatureManifestFiles(rootDir)) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const manifest = parseFeatureManifestText(text, file);
      if (manifestsByFeature.has(manifest.feature)) {
        issues.push({
          source: file,
          message: `Duplicate feature manifest for '${manifest.feature}'.`
        });
        continue;
      }

      manifestsByFeature.set(manifest.feature, manifest);
      manifestsBySource.set(file, manifest);
      capabilityReportsByFeature.set(manifest.feature, buildFeatureCapabilityReport(manifest));
    } catch (error) {
      issues.push({
        source: file,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const candidate of buildAutoManifestCandidates(rootDir)) {
    if (manifestsByFeature.has(candidate.feature)) {
      continue;
    }

    manifestsByFeature.set(candidate.feature, candidate.manifest);
    manifestsBySource.set(candidate.manifest.source ?? `auto:${candidate.feature}`, candidate.manifest);
    capabilityReportsByFeature.set(candidate.feature, buildFeatureCapabilityReport(candidate.manifest));
  }

  const registry = {
    manifestsByFeature,
    manifestsBySource,
    capabilityReportsByFeature,
    effectiveModelsByFeature,
    issues
  };

  for (const manifest of manifestsByFeature.values()) {
    effectiveModelsByFeature.set(manifest.feature, buildEffectiveCompositionModel(manifest, registry));
  }

  return registry;
}

export function loadFeatureManifestRegistryFromRoots(rootDirs: readonly string[]): FeatureManifestRegistry {
  const merged = emptyFeatureManifestRegistry();

  for (const rootDir of rootDirs) {
    const partial = loadFeatureManifestRegistry(rootDir);
    mergeRegistryInto(merged, partial, rootDir);
  }

  merged.effectiveModelsByFeature.clear();
  for (const manifest of merged.manifestsByFeature.values()) {
    merged.effectiveModelsByFeature.set(manifest.feature, buildEffectiveCompositionModel(manifest, merged));
  }

  return merged;
}

function mergeRegistryInto(target: FeatureManifestRegistry, partial: FeatureManifestRegistry, rootDir: string): void {
  for (const [feature, manifest] of partial.manifestsByFeature.entries()) {
    if (target.manifestsByFeature.has(feature)) {
      target.issues.push({
        source: rootDir,
        message: `Duplicate feature manifest for '${feature}' across workspace roots.`
      });
      continue;
    }

    target.manifestsByFeature.set(feature, manifest);
  }

  for (const [source, manifest] of partial.manifestsBySource.entries()) {
    target.manifestsBySource.set(source, manifest);
  }

  for (const [feature, report] of partial.capabilityReportsByFeature.entries()) {
    if (!target.capabilityReportsByFeature.has(feature)) {
      target.capabilityReportsByFeature.set(feature, report);
    }
  }

  for (const [feature, model] of partial.effectiveModelsByFeature.entries()) {
    if (!target.effectiveModelsByFeature.has(feature)) {
      target.effectiveModelsByFeature.set(feature, model);
    }
  }

  target.issues.push(...partial.issues);
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".feature.json")) {
      out.push(fullPath);
    }
  }
}
