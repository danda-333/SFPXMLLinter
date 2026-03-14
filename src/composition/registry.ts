import { EffectiveCompositionModel, FeatureCapabilityReport, FeatureManifest } from "./model";
import { FeatureManifestLoadIssue, FeatureManifestRegistry, emptyFeatureManifestRegistry, loadFeatureManifestRegistry, loadFeatureManifestRegistryFromRoots } from "./workspace";

export class FeatureRegistryStore {
  private registry: FeatureManifestRegistry = emptyFeatureManifestRegistry();

  public rebuild(rootDir: string): FeatureManifestRegistry {
    this.registry = loadFeatureManifestRegistry(rootDir);
    return this.registry;
  }

  public rebuildMany(rootDirs: readonly string[]): FeatureManifestRegistry {
    this.registry = loadFeatureManifestRegistryFromRoots(rootDirs);
    return this.registry;
  }

  public getRegistry(): FeatureManifestRegistry {
    return this.registry;
  }

  public getManifest(feature: string): FeatureManifest | undefined {
    return this.registry.manifestsByFeature.get(feature);
  }

  public getCapabilityReport(feature: string): FeatureCapabilityReport | undefined {
    return this.registry.capabilityReportsByFeature.get(feature);
  }

  public getEffectiveModel(feature: string): EffectiveCompositionModel | undefined {
    return this.registry.effectiveModelsByFeature.get(feature);
  }

  public getIssues(): readonly FeatureManifestLoadIssue[] {
    return this.registry.issues;
  }
}
