import * as vscode from "vscode";

export interface CoreCommandsRegistrarServiceDeps {
  suppressNextSqlSuggest: () => void;
  runBuildCurrentOrSelection: (uri?: vscode.Uri, uris?: vscode.Uri[]) => Promise<void>;
  runBuildAll: () => Promise<void>;
  compareTemplateWithBuiltXml: () => Promise<void>;
  createDocumentGeneratorTemplate: () => Promise<void>;
  createSnippetGeneratorTemplate: () => Promise<void>;
  showBuildQueueLog: () => void;
  showIndexLog: () => void;
  showCompositionLog: () => void;
  showPipelineStats: () => void;
  exportTrace: () => Promise<void>;
  exportUsageSnapshot: () => Promise<void>;
  refreshCompositionView: () => void;
  compositionCopySummary: (payload?: { text?: string }) => Promise<void>;
  compositionLogNonEffectiveUsings: (payload?: { title?: string; lines?: string[] }) => void;
}

export class CoreCommandsRegistrarService {
  public constructor(private readonly deps: CoreCommandsRegistrarServiceDeps) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.suppressNextSqlSuggest", () => {
        this.deps.suppressNextSqlSuggest();
      }),
      vscode.commands.registerCommand("sfpXmlLinter.buildXmlTemplates", async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        await this.deps.runBuildCurrentOrSelection(uri, uris);
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.buildXmlTemplatesAll", async () => {
        await this.deps.runBuildAll();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.compareTemplateWithBuiltXml", async () => {
        await this.deps.compareTemplateWithBuiltXml();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.createDocumentGeneratorTemplate", async () => {
        await this.deps.createDocumentGeneratorTemplate();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.createSnippetGeneratorTemplate", async () => {
        await this.deps.createSnippetGeneratorTemplate();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.showBuildQueueLog", () => {
        this.deps.showBuildQueueLog();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.showIndexLog", () => {
        this.deps.showIndexLog();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.showCompositionLog", () => {
        this.deps.showCompositionLog();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.showPipelineStats", () => {
        this.deps.showPipelineStats();
      }),
      vscode.commands.registerCommand("sfpXmlLinter.exportTrace", async () => {
        await this.deps.exportTrace();
      }),
      vscode.commands.registerCommand("sfpXmlLinter.exportUsageSnapshot", async () => {
        await this.deps.exportUsageSnapshot();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.refreshCompositionView", () => {
        this.deps.refreshCompositionView();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.compositionCopySummary", async (payload?: { text?: string }) => {
        await this.deps.compositionCopySummary(payload);
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "sfpXmlLinter.compositionLogNonEffectiveUsings",
        (payload?: { title?: string; lines?: string[] }) => {
          this.deps.compositionLogNonEffectiveUsings(payload);
        }
      )
    );
  }
}

