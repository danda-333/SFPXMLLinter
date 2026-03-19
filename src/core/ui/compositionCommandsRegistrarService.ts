import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildBootstrapManifestDraft } from "../../composition/bootstrapManifest";
import { applyCompositionPrimitiveQuickFix, CompositionPrimitiveQuickFixPayload } from "../../composition/primitiveQuickFix";

type CompositionSourceNode = {
  sourceLocation?: vscode.Location;
  resourceUri?: vscode.Uri;
  compareLeftUri?: vscode.Uri;
  compareRightUri?: vscode.Uri;
  compareTitle?: string;
  label?: string;
};

type CompositionOpenMode = "peek" | "side" | "sidePreview" | "newTab" | "current";

export interface CompositionCommandsRegistrarServiceDeps {
  logComposition: (message: string) => void;
  refreshCompositionView: () => void;
  validateDocument: (document: vscode.TextDocument) => void | Promise<void>;
}

export class CompositionCommandsRegistrarService {
  public constructor(private readonly deps: CompositionCommandsRegistrarServiceDeps) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.generateFeatureManifestBootstrap", async () => {
        await this.generateFeatureManifestBootstrap();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSource", async (node?: CompositionSourceNode) => {
        await this.openCompositionSource(node, this.getCompositionOpenMode());
      }),
      vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSourceBeside", async (node?: CompositionSourceNode) => {
        await this.openCompositionSource(node, "side");
      }),
      vscode.commands.registerCommand("sfpXmlLinter.compositionOpenSourceSidePreview", async (node?: CompositionSourceNode) => {
        await this.openCompositionSource(node, "sidePreview");
      }),
      vscode.commands.registerCommand("sfpXmlLinter.compositionCompare", async (node?: CompositionSourceNode) => {
        await this.compareCompositionTarget(node);
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "sfpXmlLinter.compositionApplyPrimitiveQuickFix",
        async (payload?: CompositionPrimitiveQuickFixPayload) => {
          await this.applyPrimitiveQuickFix(payload);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("sfpXmlLinter.compositionShowUsages", async (node?: {
        usageLocations?: vscode.Location[];
        label?: string;
      }) => {
        await this.showUsages(node);
      })
    );
  }

  private async compareCompositionTarget(node?: CompositionSourceNode): Promise<void> {
    const pair = await this.resolveComparePair(node);
    if (!pair) {
      vscode.window.showInformationMessage("SFP XML Linter: Compare target is not available for this item.");
      return;
    }

    await vscode.commands.executeCommand("vscode.diff", pair.left, pair.right, pair.title);
  }

  private async resolveComparePair(node?: CompositionSourceNode): Promise<{ left: vscode.Uri; right: vscode.Uri; title: string } | undefined> {
    if (node?.compareLeftUri && node?.compareRightUri) {
      const leftExists = await this.pathExists(node.compareLeftUri.fsPath);
      const rightExists = await this.pathExists(node.compareRightUri.fsPath);
      if (leftExists && rightExists) {
        return {
          left: node.compareLeftUri,
          right: node.compareRightUri,
          title: node.compareTitle ?? `SFP Compare: ${vscode.workspace.asRelativePath(node.compareLeftUri, false)} ↔ ${vscode.workspace.asRelativePath(node.compareRightUri, false)}`
        };
      }
    }

    const uri = node?.sourceLocation?.uri ?? node?.resourceUri;
    if (!uri || uri.scheme !== "file") {
      return undefined;
    }

    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    if (/^XML_Templates\//i.test(rel)) {
      const output = vscode.Uri.file(uri.fsPath.replace(/[\\/]XML_Templates([\\/])/i, `${path.sep}XML$1`));
      const outputExists = await this.pathExists(output.fsPath);
      if (!outputExists) {
        return undefined;
      }
      return {
        left: uri,
        right: output,
        title: `SFP Compare: ${rel} ↔ ${rel.replace(/^XML_Templates\//i, "XML/")}`
      };
    }

    if (/^XML\//i.test(rel)) {
      const template = vscode.Uri.file(uri.fsPath.replace(/[\\/]XML([\\/])/i, `${path.sep}XML_Templates$1`));
      const templateExists = await this.pathExists(template.fsPath);
      if (!templateExists) {
        return undefined;
      }
      return {
        left: template,
        right: uri,
        title: `SFP Compare: ${vscode.workspace.asRelativePath(template, false)} ↔ ${rel}`
      };
    }

    return undefined;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getCompositionOpenMode(): CompositionOpenMode {
    const raw = vscode.workspace
      .getConfiguration("sfpXmlLinter")
      .get<string>("composition.openMode", "newTab");
    if (raw === "side" || raw === "sidePreview" || raw === "newTab" || raw === "current" || raw === "peek") {
      return raw;
    }
    return "newTab";
  }

  private async openCompositionSource(node: CompositionSourceNode | undefined, mode: CompositionOpenMode): Promise<void> {
    const location = node?.sourceLocation;
    if (location) {
      if (mode === "peek") {
        await vscode.commands.executeCommand(
          "editor.action.peekLocations",
          location.uri,
          location.range.start,
          [location],
          "peek"
        );
        return;
      }

      await vscode.window.showTextDocument(location.uri, {
        selection: location.range,
        viewColumn: mode === "side" || mode === "sidePreview" ? vscode.ViewColumn.Beside : undefined,
        preview: mode === "sidePreview" || mode === "current",
        preserveFocus: mode === "sidePreview"
      });
      return;
    }

    if (node?.resourceUri) {
      await vscode.window.showTextDocument(node.resourceUri, {
        viewColumn: mode === "side" || mode === "sidePreview" ? vscode.ViewColumn.Beside : undefined,
        preview: mode === "sidePreview" || mode === "current",
        preserveFocus: mode === "sidePreview"
      });
      return;
    }

    vscode.window.showInformationMessage("SFP XML Linter: Source location is not available for this item.");
  }

  private async applyPrimitiveQuickFix(payload?: CompositionPrimitiveQuickFixPayload): Promise<void> {
    if (!payload?.uri || !payload?.kind || !(payload?.name ?? "").trim()) {
      vscode.window.showInformationMessage("SFP XML Linter: Primitive quick fix payload is incomplete.");
      return;
    }
    const debugName = (payload.name ?? "").trim();
    const debugKind = payload.kind;
    const debugPrimitive = (payload.primitiveKey ?? "").trim();
    this.deps.logComposition(
      `Primitive quick-fix START kind=${debugKind} name='${debugName}' primitive='${debugPrimitive || "(none)"}'`
    );

    const deps = this.deps;
    const result = await applyCompositionPrimitiveQuickFix(payload, {
      getDiagnostics(uri) {
        return vscode.languages.getDiagnostics(uri as vscode.Uri);
      },
      async getCodeActions(uri, range) {
        const actions =
          (await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
            "vscode.executeCodeActionProvider",
            uri as vscode.Uri,
            range as vscode.Range,
            vscode.CodeActionKind.QuickFix
          )) ?? [];
        return actions.map((action) => {
          if (action instanceof vscode.CodeAction) {
            return {
              title: action.title,
              edit: action.edit,
              command: action.command
                ? {
                    command: action.command.command,
                    arguments: action.command.arguments
                  }
                : undefined
            };
          }

          return {
            title: action.title,
            command: {
              command: action.command,
              arguments: action.arguments
            }
          };
        });
      },
      async applyEdit(edit) {
        await vscode.workspace.applyEdit(edit as vscode.WorkspaceEdit);
      },
      async executeCommand(command, ...args) {
        await vscode.commands.executeCommand(command, ...args);
      },
      async openDocument(uri) {
        return vscode.workspace.openTextDocument(uri as vscode.Uri);
      },
      async validateDocument(document) {
        await Promise.resolve(deps.validateDocument(document as vscode.TextDocument));
      },
      async askRevalidate(message) {
        deps.logComposition(`Primitive quick-fix RETRY prompt: ${message}`);
        const pick = await vscode.window.showInformationMessage(message, "Revalidate");
        deps.logComposition(`Primitive quick-fix RETRY selected=${pick === "Revalidate" ? "yes" : "no"}`);
        return pick === "Revalidate";
      }
    });

    if (result === "missing-diagnostic") {
      vscode.window.showInformationMessage("SFP XML Linter: Matching diagnostic was not found.");
      this.deps.logComposition("Primitive quick-fix DONE result=missing-diagnostic");
    } else if (result === "missing-action") {
      vscode.window.showInformationMessage("SFP XML Linter: Matching quick fix action was not found.");
      this.deps.logComposition("Primitive quick-fix DONE result=missing-action");
    } else if (result === "invalid") {
      this.deps.logComposition("Primitive quick-fix DONE result=invalid");
    } else {
      this.deps.logComposition("Primitive quick-fix DONE result=applied");
    }
  }

  private async showUsages(node?: {
    usageLocations?: vscode.Location[];
    label?: string;
  }): Promise<void> {
    const locations = node?.usageLocations ?? [];
    if (locations.length === 0) {
      vscode.window.showInformationMessage(`SFP XML Linter: No usages found for ${node?.label ?? "selected item"}.`);
      return;
    }

    if (locations.length === 1) {
      const [location] = locations;
      await vscode.window.showTextDocument(location.uri, {
        selection: location.range,
        preview: false
      });
      return;
    }

    const picks = locations.map((location) => {
      const relative = vscode.workspace.asRelativePath(location.uri, false);
      const line = location.range.start.line + 1;
      const column = location.range.start.character + 1;
      return {
        label: `${relative}:${line}:${column}`,
        description: node?.label,
        location
      };
    });

    const picked = await vscode.window.showQuickPick(picks, {
      title: `Usages of ${node?.label ?? "selected item"}`,
      matchOnDescription: true
    });
    if (!picked) {
      return;
    }

    await vscode.window.showTextDocument(picked.location.uri, {
      selection: picked.location.range,
      preview: false
    });
  }

  private async generateFeatureManifestBootstrap(): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== "file") {
      vscode.window.showInformationMessage("SFP XML Linter: Open a feature XML file first.");
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (!workspaceFolder) {
      vscode.window.showInformationMessage("SFP XML Linter: Active file must be inside a workspace folder.");
      return;
    }

    const draft = buildBootstrapManifestDraft(workspaceFolder.uri.fsPath, activeUri.fsPath);
    if (!draft) {
      vscode.window.showInformationMessage(
        "SFP XML Linter: No feature candidate found for this file. Open a *.feature.xml inside XML_Components."
      );
      return;
    }

    const targetUri = vscode.Uri.file(draft.manifestPath);
    const alreadyExists = await fs
      .access(draft.manifestPath)
      .then(() => true)
      .catch(() => false);

    if (alreadyExists) {
      const choice = await vscode.window.showWarningMessage(
        `SFP XML Linter: '${vscode.workspace.asRelativePath(targetUri, false)}' already exists. Overwrite?`,
        { modal: true },
        "Overwrite"
      );
      if (choice !== "Overwrite") {
        return;
      }
    }

    await fs.mkdir(path.dirname(draft.manifestPath), { recursive: true });
    await fs.writeFile(draft.manifestPath, draft.manifestText, "utf8");
    this.deps.logComposition(
      `Bootstrap manifest generated for feature '${draft.feature}': ${vscode.workspace.asRelativePath(targetUri, false)}`
    );
    const opened = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(opened, { preview: false });
    vscode.window.showInformationMessage(
      `SFP XML Linter: Generated bootstrap manifest for '${draft.feature}'.`
    );
    this.deps.refreshCompositionView();
  }
}
