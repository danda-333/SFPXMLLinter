import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";
import { FormatterOptions } from "../../formatter/types";

type FormatterRangeResult = {
  text: string;
  recoveries: number;
  invalidNodes: number;
  range: vscode.Range;
};

export interface WorkspaceMaintenanceCommandsRegistrarServiceDeps {
  queueReindexAll: () => Promise<void>;
  revalidateWorkspace: () => Promise<void>;
  revalidateProject: () => Promise<void>;
  switchProjectScopeToUri: (uri: vscode.Uri) => Promise<void>;
  rebuildTemplateIndex: () => Promise<void>;
  rebuildRuntimeIndex: () => Promise<void>;
  globConfiguredXmlFiles: () => Promise<vscode.Uri[]>;
  getIndexForUri: (uri: vscode.Uri) => WorkspaceIndex;
  parseDocumentFacts: (document: vscode.TextDocument) => unknown;
  buildDiagnosticsForDocument: (document: vscode.TextDocument, index: WorkspaceIndex, facts: unknown) => vscode.Diagnostic[];
  createFormatterOptions: (editorOptions: vscode.TextEditorOptions, document: vscode.TextDocument) => FormatterOptions;
  formatDocument: (source: string, options: FormatterOptions) => {
    text: string;
    recoveries: number;
    invalidNodes: number;
  };
  formatRangeLikeDocument: (
    document: vscode.TextDocument,
    range: vscode.Range,
    options: FormatterOptions
  ) => FormatterRangeResult;
  logFormatter: (message: string) => void;
}

export class WorkspaceMaintenanceCommandsRegistrarService {
  public constructor(private readonly deps: WorkspaceMaintenanceCommandsRegistrarServiceDeps) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.rebuildIndex", async () => {
        const start = Date.now();
        await this.deps.queueReindexAll();
        const durationMs = Date.now() - start;
        vscode.window.showInformationMessage(`SFP XML Linter index rebuilt in ${durationMs} ms.`);
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.revalidateWorkspace", async () => {
        await this.deps.revalidateWorkspace();
      }),
      vscode.commands.registerCommand("sfpXmlLinter.revalidateProject", async () => {
        await this.deps.revalidateProject();
      }),
      vscode.commands.registerCommand("sfpXmlLinter.switchProjectScopeToActiveFile", async () => {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (!active || active.scheme !== "file") {
          vscode.window.showInformationMessage("SFP XML Linter: Open an XML file from target project first.");
          return;
        }

        await this.deps.switchProjectScopeToUri(active);
        vscode.window.showInformationMessage("SFP XML Linter: Active project scope switched.");
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.workspaceDiagnosticsReport", async () => {
        const output = vscode.window.createOutputChannel("SFP XML Linter");
        output.clear();
        output.appendLine("SFP XML Linter - Workspace Diagnostics Report");
        output.appendLine("");

        await this.deps.rebuildTemplateIndex();
        await this.deps.rebuildRuntimeIndex();
        const uris = await this.deps.globConfiguredXmlFiles();

        const byRule = new Map<string, number>();
        let total = 0;

        for (const uri of uris) {
          const doc = await vscode.workspace.openTextDocument(uri);
          const currentIndex = this.deps.getIndexForUri(uri);
          const facts = currentIndex.parsedFactsByUri.get(uri.toString()) ?? this.deps.parseDocumentFacts(doc);
          const ds = this.deps.buildDiagnosticsForDocument(doc, currentIndex, facts);
          if (ds.length === 0) {
            continue;
          }

          output.appendLine(`${vscode.workspace.asRelativePath(uri, false)} (${ds.length})`);
          for (const d of ds) {
            const rule = typeof d.code === "string" ? d.code : "unknown";
            byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
            total++;
            output.appendLine(`  - [${rule}] line ${d.range.start.line + 1}: ${d.message}`);
          }
        }

        output.appendLine("");
        output.appendLine(`Total diagnostics: ${total}`);
        output.appendLine("By rule:");
        for (const [rule, count] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          output.appendLine(`  ${rule}: ${count}`);
        }

        output.show(true);
      }),
      vscode.commands.registerCommand("sfpXmlLinter.formatDocumentTolerant", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }

        if (editor.document.languageId !== "xml") {
          vscode.window.showInformationMessage("SFP XML Tolerant Formatter works only for XML documents.");
          return;
        }

        const startedAt = Date.now();
        const options = this.deps.createFormatterOptions(editor.options, editor.document);
        const result = this.deps.formatDocument(editor.document.getText(), options);
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
        await editor.edit((editBuilder) => {
          editBuilder.replace(fullRange, result.text);
        });
        const durationMs = Date.now() - startedAt;
        this.deps.logFormatter(`FORMAT document done in ${durationMs} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`);
        vscode.window.setStatusBarMessage(
          `SFP XML Formatter: done in ${durationMs} ms (recoveries=${result.recoveries}, invalid=${result.invalidNodes})`,
          4000
        );
      }),
      vscode.commands.registerCommand("sfpXmlLinter.formatSelectionTolerant", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }

        if (editor.document.languageId !== "xml") {
          vscode.window.showInformationMessage("SFP XML Tolerant Formatter works only for XML documents.");
          return;
        }

        const nonEmptySelections = editor.selections.filter((selection) => !selection.isEmpty);
        if (nonEmptySelections.length === 0) {
          vscode.window.showInformationMessage("No text selected.");
          return;
        }

        const startedAt = Date.now();
        const options = this.deps.createFormatterOptions(editor.options, editor.document);
        const sortedSelections = [...nonEmptySelections].sort((a, b) => editor.document.offsetAt(b.start) - editor.document.offsetAt(a.start));
        let totalRecoveries = 0;
        let totalInvalidNodes = 0;
        await editor.edit((editBuilder) => {
          for (const selection of sortedSelections) {
            const result = this.deps.formatRangeLikeDocument(editor.document, selection, options);
            totalRecoveries += result.recoveries;
            totalInvalidNodes += result.invalidNodes;
            editBuilder.replace(result.range, result.text);
          }
        });
        const durationMs = Date.now() - startedAt;
        this.deps.logFormatter(
          `FORMAT selection done in ${durationMs} ms (selections=${sortedSelections.length}, recoveries=${totalRecoveries}, invalidNodes=${totalInvalidNodes})`
        );
        vscode.window.setStatusBarMessage(
          `SFP XML Formatter Selection: ${sortedSelections.length} selection(s), ${durationMs} ms`,
          4000
        );
      })
    );
  }
}

