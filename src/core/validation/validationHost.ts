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
  }

  public run(request: ValidationRequest): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const module of this.modules) {
      diagnostics.push(...module.run(request));
    }
    return diagnostics;
  }

  public runMode(request: ValidationRequest, mode: ValidationModule["mode"]): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const module of this.modules) {
      if (module.mode !== mode) {
        continue;
      }
      diagnostics.push(...module.run(request));
    }
    return diagnostics;
  }

  public getDisabledModuleIds(): readonly string[] {
    return [...this.disabledModuleIds].sort((a, b) => a.localeCompare(b));
  }
}
