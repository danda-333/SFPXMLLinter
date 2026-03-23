import * as vscode from "vscode";
import { ValidationModule, ValidationRequest } from "./types";

export interface ValidationHostDeps {
  hasFactKind?: (kind: string) => boolean;
  hasSymbolKind?: (kind: string) => boolean;
  log?: (message: string) => void;
}

export class ValidationHost {
  private readonly modules: ValidationModule[] = [];
  private readonly disabledModuleIds = new Set<string>();
  private readonly runsByModuleId = new Map<string, number>();
  private readonly diagnosticsByModuleId = new Map<string, number>();

  public constructor(private readonly deps: ValidationHostDeps = {}) {}

  public register(module: ValidationModule): void {
    if (module.enabled === false) {
      this.disabledModuleIds.add(module.id);
      this.deps.log?.(`[validation] module disabled by flag: ${module.id}`);
      return;
    }

    const missingFacts = (module.needsFacts ?? []).filter((kind) => !(this.deps.hasFactKind?.(kind) ?? true));
    const missingSymbols = (module.needsSymbols ?? []).filter((kind) => !(this.deps.hasSymbolKind?.(kind) ?? true));
    if (missingFacts.length > 0 || missingSymbols.length > 0) {
      this.disabledModuleIds.add(module.id);
      this.deps.log?.(
        `[validation] module disabled due to missing dependencies: ${module.id}` +
          `${missingFacts.length > 0 ? ` missingFacts=[${missingFacts.join(", ")}]` : ""}` +
          `${missingSymbols.length > 0 ? ` missingSymbols=[${missingSymbols.join(", ")}]` : ""}`
      );
      return;
    }

    this.modules.push(module);
    this.runsByModuleId.set(module.id, this.runsByModuleId.get(module.id) ?? 0);
    this.diagnosticsByModuleId.set(module.id, this.diagnosticsByModuleId.get(module.id) ?? 0);
  }

  public run(request: ValidationRequest): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const module of this.modules) {
      const produced = module.run(request);
      diagnostics.push(...produced);
      this.runsByModuleId.set(module.id, (this.runsByModuleId.get(module.id) ?? 0) + 1);
      this.diagnosticsByModuleId.set(module.id, (this.diagnosticsByModuleId.get(module.id) ?? 0) + produced.length);
    }
    return diagnostics;
  }

  public runMode(request: ValidationRequest, mode: ValidationModule["mode"]): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const module of this.modules) {
      if (module.mode !== mode) {
        continue;
      }
      const produced = module.run(request);
      diagnostics.push(...produced);
      this.runsByModuleId.set(module.id, (this.runsByModuleId.get(module.id) ?? 0) + 1);
      this.diagnosticsByModuleId.set(module.id, (this.diagnosticsByModuleId.get(module.id) ?? 0) + produced.length);
    }
    return diagnostics;
  }

  public getDisabledModuleIds(): readonly string[] {
    return [...this.disabledModuleIds].sort((a, b) => a.localeCompare(b));
  }

  public getModuleUsageStats(): Array<{
    moduleId: string;
    runs: number;
    diagnostics: number;
  }> {
    return this.modules
      .map((module) => ({
        moduleId: module.id,
        runs: this.runsByModuleId.get(module.id) ?? 0,
        diagnostics: this.diagnosticsByModuleId.get(module.id) ?? 0
      }))
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }

  public getDeadModuleIds(): readonly string[] {
    return this.getModuleUsageStats()
      .filter((item) => item.runs > 0 && item.diagnostics === 0)
      .map((item) => item.moduleId);
  }
}
