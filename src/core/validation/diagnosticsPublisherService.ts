import * as vscode from "vscode";

export interface DiagnosticsPublisherServiceDeps {
  diagnostics: vscode.DiagnosticCollection;
  onChanged?: () => void;
}

export class DiagnosticsPublisherService {
  public constructor(private readonly deps: DiagnosticsPublisherServiceDeps) {}

  public set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void {
    this.deps.diagnostics.set(uri, diagnostics);
    this.deps.onChanged?.();
  }

  public setBatch(updates: ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]>): void {
    this.deps.diagnostics.set(updates);
    this.deps.onChanged?.();
  }

  public delete(uri: vscode.Uri): void {
    this.deps.diagnostics.delete(uri);
    this.deps.onChanged?.();
  }

  public forEach(callback: (uri: vscode.Uri) => void): void {
    this.deps.diagnostics.forEach((uri) => callback(uri));
  }
}

