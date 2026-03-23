import * as vscode from "vscode";
import { getSettings } from "../../config/settings";
import { migrateLegacyAliasesInText } from "../../template/legacyTemplateAliasMigration";

export interface LegacyTemplateAliasMigrationCommandsServiceDeps {
  logBuild?: (message: string) => void;
}

type MigrationScope = "current" | "workspace";

export class LegacyTemplateAliasMigrationCommandsService {
  public constructor(private readonly deps: LegacyTemplateAliasMigrationCommandsServiceDeps) {}

  public async runInteractiveMigration(): Promise<void> {
    const scope = await this.pickScope();
    if (!scope) {
      return;
    }

    if (scope === "current") {
      await this.migrateCurrentFile();
      return;
    }

    await this.migrateWorkspace();
  }

  private async pickScope(): Promise<MigrationScope | undefined> {
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "Current file",
          detail: "Migrate legacy aliases in active XML document.",
          scope: "current" as const
        },
        {
          label: "Workspace",
          detail: "Migrate legacy aliases in all XML files under configured SFP roots.",
          scope: "workspace" as const
        }
      ],
      {
        title: "Migrate Legacy Template Aliases",
        placeHolder: "Choose migration scope"
      }
    );
    return selected?.scope;
  }

  private async migrateCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!document || document.languageId !== "xml") {
      vscode.window.showWarningMessage("Open an XML document first.");
      return;
    }
    const result = migrateLegacyAliasesInText(document.getText());
    if (!result.changed) {
      vscode.window.showInformationMessage("No legacy aliases found in current file.");
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    edit.replace(document.uri, fullRange, result.text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showWarningMessage("Failed to apply alias migration in current file.");
      return;
    }

    this.deps.logBuild?.(
      `MIGRATE legacy aliases current file: ${vscode.workspace.asRelativePath(document.uri, false)} | tags=${result.tagChanges} placeholders=${result.placeholderChanges}`
    );
    vscode.window.showInformationMessage(
      `Migrated current file: ${result.tagChanges} tag alias(es), ${result.placeholderChanges} placeholder alias(es).`
    );
  }

  private async migrateWorkspace(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    const candidates = await vscode.workspace.findFiles("**/*.xml", "**/{.git,node_modules,dist,out}/**");
    const roots = getSettings().workspaceRoots.map((entry) => entry.replace(/\\/g, "/").toLowerCase());
    const targetUris = candidates.filter((uri) => {
      const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
      return roots.some((root) => rel === root || rel.startsWith(`${root}/`));
    });

    let changedFiles = 0;
    let changedTags = 0;
    let changedPlaceholders = 0;

    const openDocs = new Map<string, vscode.TextDocument>();
    for (const doc of vscode.workspace.textDocuments) {
      openDocs.set(doc.uri.toString(), doc);
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const fsWrites: Array<{ uri: vscode.Uri; text: string }> = [];

    for (const uri of targetUris) {
      const openDoc = openDocs.get(uri.toString());
      const sourceText = openDoc ? openDoc.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      const migration = migrateLegacyAliasesInText(sourceText);
      if (!migration.changed) {
        continue;
      }

      changedFiles++;
      changedTags += migration.tagChanges;
      changedPlaceholders += migration.placeholderChanges;

      if (openDoc) {
        const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(sourceText.length));
        workspaceEdit.replace(uri, fullRange, migration.text);
      } else {
        fsWrites.push({ uri, text: migration.text });
      }
    }

    if (changedFiles === 0) {
      vscode.window.showInformationMessage("No legacy aliases found in workspace roots.");
      return;
    }

    if (workspaceEdit.entries().length > 0) {
      const applied = await vscode.workspace.applyEdit(workspaceEdit);
      if (!applied) {
        vscode.window.showWarningMessage("Failed to apply workspace alias migration edits.");
        return;
      }
    }

    for (const write of fsWrites) {
      await vscode.workspace.fs.writeFile(write.uri, Buffer.from(write.text, "utf8"));
    }

    this.deps.logBuild?.(
      `MIGRATE legacy aliases workspace: files=${changedFiles} tags=${changedTags} placeholders=${changedPlaceholders}`
    );
    vscode.window.showInformationMessage(
      `Migrated workspace aliases in ${changedFiles} file(s): ${changedTags} tag alias(es), ${changedPlaceholders} placeholder alias(es).`
    );
  }
}
