import { WorkspaceIndex } from "../../indexer/types";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import { buildDocumentCompositionModel } from "../../composition/documentModel";
import { populateUsingInsertTraceFromText } from "../../composition/usingImpact";
import { FeatureRegistryStore } from "../../composition/registry";
import { TemplateMutationRecord } from "../../template/buildXmlTemplatesCore";

export type BuildTemplateEvaluation = {
  status: "update" | "nochange" | "error";
  templateText: string;
  debugLines: readonly string[];
};

export type BuildTemplateMutationTelemetry = {
  outputRelativePath: string;
  outputFsPath: string;
  mutations: readonly TemplateMutationRecord[];
  renderedOutputText?: string;
};

export interface CompositionTelemetryCollector {
  entries: Map<string, BuildTemplateEvaluation>;
  mutationsByTemplate: Map<string, BuildTemplateMutationTelemetry>;
  onTemplateEvaluated: (
    relativeTemplatePath: string,
    status: "update" | "nochange" | "error",
    templateText: string,
    debugLines: readonly string[]
  ) => void;
  onTemplateMutations: (
    relativeTemplatePath: string,
    outputRelativePath: string,
    outputFsPath: string,
    mutations: readonly TemplateMutationRecord[],
    renderedOutputText?: string
  ) => void;
}

export interface CompositionTelemetryServiceDeps {
  getTemplateIndex: () => WorkspaceIndex;
  getRegistry: () => ReturnType<FeatureRegistryStore["getRegistry"]>;
  logComposition: (message: string) => void;
}

export class CompositionTelemetryService {
  public constructor(private readonly deps: CompositionTelemetryServiceDeps) {}

  public createBuildTelemetryCollector(): CompositionTelemetryCollector {
    const entries = new Map<string, BuildTemplateEvaluation>();
    const mutationsByTemplate = new Map<string, BuildTemplateMutationTelemetry>();
    return {
      entries,
      mutationsByTemplate,
      onTemplateEvaluated: (
        relativeTemplatePath: string,
        status: "update" | "nochange" | "error",
        templateText: string,
        debugLines: readonly string[]
      ) => {
        entries.set(relativeTemplatePath, {
          status,
          templateText,
          debugLines
        });
      },
      onTemplateMutations: (
        relativeTemplatePath: string,
        outputRelativePath: string,
        outputFsPath: string,
        mutations: readonly TemplateMutationRecord[],
        renderedOutputText?: string
      ) => {
        mutationsByTemplate.set(relativeTemplatePath, {
          outputRelativePath,
          outputFsPath,
          mutations,
          renderedOutputText
        });
      }
    };
  }

  public logBuildCompositionSnapshot(
    sourceLabel: string,
    evaluations: ReadonlyMap<string, BuildTemplateEvaluation>,
    mode: "fast" | "debug" | "release"
  ): void {
    if (mode === "release" || evaluations.size === 0) {
      return;
    }

    const index = this.deps.getTemplateIndex();
    const sorted = [...evaluations.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxLogged = mode === "debug" ? 30 : 0;
    let withUsings = 0;
    let totalEffective = 0;
    let totalPartial = 0;
    let totalUnused = 0;
    let totalXPathDebug = 0;
    let logged = 0;

    for (const [relativeTemplatePath, evaluation] of sorted) {
      const facts = parseDocumentFactsFromText(evaluation.templateText);
      populateUsingInsertTraceFromText(facts, evaluation.templateText, index);
      const model = buildDocumentCompositionModel(facts, index);
      if (model.usings.length === 0) {
        continue;
      }

      withUsings++;
      const effective = model.usings.filter((item) => item.impact.kind === "effective").length;
      const partial = model.usings.filter((item) => item.impact.kind === "partial").length;
      const unused = model.usings.filter((item) => item.impact.kind === "unused").length;
      totalEffective += effective;
      totalPartial += partial;
      totalUnused += unused;
      const xpathDebugCount = evaluation.debugLines.filter((line) => line.includes("[TargetXPath]")).length;
      totalXPathDebug += xpathDebugCount;

      if (logged < maxLogged) {
        this.deps.logComposition(
          `[build:${sourceLabel}] ${relativeTemplatePath} status=${evaluation.status} usings=${model.usings.length} effective=${effective} partial=${partial} unused=${unused} xpathDebug=${xpathDebugCount}`
        );
        for (const usingItem of model.usings.filter((item) => item.impact.kind !== "effective")) {
          const usingLabel = usingItem.sectionValue
            ? `${usingItem.rawComponentValue}#${usingItem.sectionValue}`
            : usingItem.rawComponentValue;
          this.deps.logComposition(
            `  using ${usingLabel}: ${usingItem.impact.kind} (${usingItem.impact.successfulCount}/${usingItem.impact.relevantCount})`
          );
          if (mode === "debug") {
            for (const contribution of usingItem.contributions) {
              const trace = contribution.insertTrace;
              const traceLabel = trace
                ? `insert=${trace.finalInsertCount}, strategy=${trace.strategy}, placeholder=${trace.placeholderCount}, xpath=${trace.targetXPathMatchCount}, clamp=${trace.targetXPathClampedCount}, fallback=${trace.fallbackSymbolCount}`
                : "trace=missing";
              this.deps.logComposition(
                `    contribution ${contribution.contribution.contributionName}: usage=${contribution.usage}, rootRelevant=${contribution.rootRelevant}, ${traceLabel}`
              );
            }
          }
        }
        logged++;
      }
    }

    if (withUsings === 0) {
      this.deps.logComposition(`[build:${sourceLabel}] evaluated templates=${evaluations.size}, withUsings=0`);
      if (mode === "debug") {
        this.logFeatureOrderingSnapshot(sourceLabel);
      }
      return;
    }

    const suppressed = Math.max(0, withUsings - logged);
    this.deps.logComposition(
      `[build:${sourceLabel}] summary templates=${evaluations.size}, withUsings=${withUsings}, effective=${totalEffective}, partial=${totalPartial}, unused=${totalUnused}, xpathDebug=${totalXPathDebug}${suppressed > 0 ? `, suppressed=${suppressed}` : ""}`
    );
    if (mode === "debug") {
      this.logFeatureOrderingSnapshot(sourceLabel);
    }
  }

  private logFeatureOrderingSnapshot(sourceLabel: string): void {
    const registry = this.deps.getRegistry();
    for (const [featureName, manifest] of registry.manifestsByFeature.entries()) {
      const orderingParts = manifest.parts.filter((part) =>
        part.ordering && ((part.ordering.before.length > 0) || (part.ordering.after.length > 0) || !!part.ordering.group)
      );
      if (orderingParts.length === 0) {
        continue;
      }

      const edges = new Map<string, Set<string>>();
      const indegree = new Map<string, number>();
      const partIds = new Set(manifest.parts.map((part) => part.id));
      const addEdge = (from: string, to: string): void => {
        const bucket = edges.get(from) ?? new Set<string>();
        if (!bucket.has(to)) {
          bucket.add(to);
          edges.set(from, bucket);
          indegree.set(to, (indegree.get(to) ?? 0) + 1);
          indegree.set(from, indegree.get(from) ?? 0);
        }
      };

      for (const part of manifest.parts) {
        indegree.set(part.id, indegree.get(part.id) ?? 0);
        const ordering = part.ordering;
        if (!ordering) {
          continue;
        }
        for (const target of ordering.before) {
          if (partIds.has(target)) {
            addEdge(part.id, target);
          }
        }
        for (const target of ordering.after) {
          if (partIds.has(target)) {
            addEdge(target, part.id);
          }
        }
      }

      const queue = [...manifest.parts.map((part) => part.id).filter((id) => (indegree.get(id) ?? 0) === 0)];
      const ordered: string[] = [];
      while (queue.length > 0) {
        queue.sort((a, b) => a.localeCompare(b));
        const current = queue.shift();
        if (!current) {
          break;
        }
        ordered.push(current);
        for (const target of edges.get(current) ?? []) {
          const next = (indegree.get(target) ?? 0) - 1;
          indegree.set(target, next);
          if (next === 0) {
            queue.push(target);
          }
        }
      }

      const orderingConflicts = (registry.effectiveModelsByFeature.get(featureName)?.conflicts ?? [])
        .filter((conflict) => conflict.code === "ordering-conflict");
      const unresolved = manifest.parts.map((part) => part.id).filter((id) => !ordered.includes(id));

      this.deps.logComposition(
        `[build:${sourceLabel}] [ordering] ${featureName}: parts=${manifest.parts.length}, constraints=${[...edges.values()].reduce((acc, value) => acc + value.size, 0)}, resolved=${ordered.length}, conflicts=${orderingConflicts.length}`
      );
      if (ordered.length > 0) {
        this.deps.logComposition(`  [ordering] resolved order: ${ordered.join(" -> ")}`);
      }
      if (unresolved.length > 0) {
        this.deps.logComposition(`  [ordering] unresolved parts: ${unresolved.join(", ")}`);
      }
      for (const part of orderingParts) {
        const ordering = part.ordering!;
        this.deps.logComposition(
          `  [ordering] part=${part.id}, group=${ordering.group ?? "(none)"}, before=${ordering.before.join(", ") || "(none)"}, after=${ordering.after.join(", ") || "(none)"}`
        );
      }
    }
  }
}
