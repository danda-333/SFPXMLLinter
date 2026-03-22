import * as vscode from "vscode";

export interface DiagnosticsPublisherServiceDeps {
  diagnostics: vscode.DiagnosticCollection;
  onChanged?: () => void;
}

export class DiagnosticsPublisherService {
  private readonly byUri = new Map<string, { uri: vscode.Uri; diagnostics: readonly vscode.Diagnostic[] }>();
  private static readonly DEFAULT_SOURCE = "sfp-xml-linter";

  public constructor(private readonly deps: DiagnosticsPublisherServiceDeps) {}

  public set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void {
    const normalized = this.normalizeDiagnostics(diagnostics);
    this.byUri.set(uri.toString(), { uri, diagnostics: normalized });
    this.deps.diagnostics.set(uri, normalized);
    this.deps.onChanged?.();
  }

  public setBatch(updates: ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]>): void {
    const normalizedUpdates: Array<[vscode.Uri, readonly vscode.Diagnostic[] | undefined]> = [];
    for (const [uri, diagnostics] of updates) {
      const key = uri.toString();
      if (!diagnostics || diagnostics.length === 0) {
        this.byUri.delete(key);
        normalizedUpdates.push([uri, diagnostics]);
      } else {
        const normalized = this.normalizeDiagnostics(diagnostics);
        this.byUri.set(key, { uri, diagnostics: normalized });
        normalizedUpdates.push([uri, normalized]);
      }
    }
    this.deps.diagnostics.set(normalizedUpdates);
    this.deps.onChanged?.();
  }

  public delete(uri: vscode.Uri): void {
    this.byUri.delete(uri.toString());
    this.deps.diagnostics.delete(uri);
    this.deps.onChanged?.();
  }

  public forEach(callback: (uri: vscode.Uri) => void): void {
    this.deps.diagnostics.forEach((uri) => callback(uri));
  }

  public getEntries(): ReadonlyArray<{ uri: vscode.Uri; diagnostics: readonly vscode.Diagnostic[] }> {
    return [...this.byUri.values()];
  }

  private normalizeDiagnostics(diagnostics: readonly vscode.Diagnostic[]): readonly vscode.Diagnostic[] {
    return diagnostics.map((diagnostic) => {
      if ((diagnostic.source ?? "").trim().length > 0) {
        return diagnostic;
      }
      const clone = new vscode.Diagnostic(
        diagnostic.range,
        diagnostic.message,
        diagnostic.severity
      );
      clone.code = diagnostic.code;
      clone.source = DiagnosticsPublisherService.DEFAULT_SOURCE;
      clone.relatedInformation = diagnostic.relatedInformation;
      clone.tags = diagnostic.tags;
      return clone;
    });
  }
}
