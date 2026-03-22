import { SfpXmlLinterSettings } from "../../config/settings";
import {
  BuildRunPerformanceStats,
  BuildRunOptions,
  TemplateInheritedUsingEntry
} from "../../template/buildXmlTemplatesService";
import { TemplateMutationRecord } from "../../template/buildXmlTemplatesCore";

export type TemplateBuildRunMode = "fast" | "debug" | "release";

export interface TemplateBuildRunOptionsFactoryDeps {
  getSettings: () => SfpXmlLinterSettings;
  getExtensionVersion: () => string | undefined;
  buildInheritedUsingsSnapshotFromIndex: () => ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]>;
  logBuild: (message: string) => void;
  onBuildRunPerformance?: (stats: BuildRunPerformanceStats) => void;
}

export class TemplateBuildRunOptionsFactory {
  public constructor(private readonly deps: TemplateBuildRunOptionsFactoryDeps) {}

  public createBuildRunOptions(
    silent: boolean,
    mode: TemplateBuildRunMode,
    onTemplateEvaluated?: (
      relativeTemplatePath: string,
      status: "update" | "nochange" | "error",
      templateText: string,
      debugLines: readonly string[]
    ) => void,
    onTemplateMutations?: (
      relativeTemplatePath: string,
      outputRelativePath: string,
      outputFsPath: string,
      mutations: readonly TemplateMutationRecord[],
      renderedOutputText?: string
    ) => void
  ): BuildRunOptions {
    const onTemplateEvaluatedSafe =
      onTemplateEvaluated ??
      (() => {
        // no-op
      });
    const onTemplateMutationsSafe =
      onTemplateMutations ??
      (() => {
        // no-op
      });
    const settings = this.deps.getSettings();
    const provenanceLabel = `v${this.deps.getExtensionVersion() ?? "unknown"}`;

    return {
      silent,
      mode,
      postBuildFormat: settings.templateBuilderPostBuildFormat,
      legacyTagAliasesEnabled: settings.templateBuilderLegacyComponentSectionSupport,
      provenanceMode: settings.templateBuilderProvenanceMode,
      provenanceLabel,
      formatterMaxConsecutiveBlankLines: settings.formatterMaxConsecutiveBlankLines,
      generatorsEnabled: settings.templateBuilderGeneratorsEnabled,
      generatorTimeoutMs: settings.templateBuilderGeneratorTimeoutMs,
      generatorEnableUserScripts: settings.templateBuilderGeneratorEnableUserScripts,
      generatorUserScriptsRoots: settings.templateBuilderGeneratorUserScriptsRoots,
      inheritedUsingsByFormIdent: this.deps.buildInheritedUsingsSnapshotFromIndex(),
      onLogLine: (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return;
        }

        const processingMatch = /^\[(\d+)\/(\d+)\]\s+(.+)$/.exec(trimmed);
        if (processingMatch) {
          if (mode === "release") {
            return;
          }
          const [, current, total, relPath] = processingMatch;
          this.deps.logBuild(`FILE ${current}/${total}: ${relPath}`);
          return;
        }

        if (/^(UPDATED|SKIPPED)\b/i.test(trimmed)) {
          if (mode !== "debug") {
            return;
          }
          return;
        }

        if (/^ERROR\b/i.test(trimmed)) {
          this.deps.logBuild(trimmed);
          return;
        }

        if (/^\[generator\]\[warning\]/i.test(trimmed)) {
          this.deps.logBuild(trimmed);
          return;
        }

        if (/^Done\./i.test(trimmed) || /^Errors:/i.test(trimmed) || /^\[stderr\]/.test(trimmed)) {
          this.deps.logBuild(trimmed);
        }
      },
      onFileStatus: (relativeTemplatePath: string, status: "update" | "nochange" | "error") => {
        if (mode === "release") {
          return;
        }
        this.deps.logBuild(`RESULT ${relativeTemplatePath}: ${status}`);
      },
      onPerformanceStats: this.deps.onBuildRunPerformance,
      onTemplateEvaluated: onTemplateEvaluatedSafe,
      onTemplateMutations: onTemplateMutationsSafe
    };
  }
}
