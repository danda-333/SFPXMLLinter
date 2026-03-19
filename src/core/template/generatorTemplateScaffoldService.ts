import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type GeneratorTemplateKind = "document" | "snippet";

export interface GeneratorTemplateScaffoldServiceDeps {
  getWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
  logBuild: (message: string) => void;
}

export class GeneratorTemplateScaffoldService {
  public constructor(private readonly deps: GeneratorTemplateScaffoldServiceDeps) {}

  public async createGeneratorTemplateFile(kind: GeneratorTemplateKind): Promise<void> {
    const folder = this.deps.getWorkspaceFolder();
    if (!folder) {
      vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    const baseDir = path.join(folder.uri.fsPath, "XML_Generators");
    const baseFileName = kind === "document"
      ? "hello.document.generator.js"
      : "hello.snippet.generator.js";
    const targetPath = await this.nextAvailableFilePath(baseDir, baseFileName);
    const targetUri = vscode.Uri.file(targetPath);

    const content = kind === "document"
      ? this.buildDocumentGeneratorTemplate()
      : this.buildSnippetGeneratorTemplate();

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
    const opened = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(opened, { preview: false });
    const rel = vscode.workspace.asRelativePath(targetUri, false);
    vscode.window.showInformationMessage(`SFP XML Linter: Created ${kind} generator template at ${rel}.`);
    this.deps.logBuild(`Generator template created: kind=${kind} path=${rel}`);
  }

  private async nextAvailableFilePath(baseDir: string, fileName: string): Promise<string> {
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, Math.max(0, fileName.length - ext.length));
    let candidate = path.join(baseDir, fileName);
    let index = 1;
    while (await this.pathExists(candidate)) {
      candidate = path.join(baseDir, `${stem}.${index}${ext}`);
      index++;
    }
    return candidate;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private buildDocumentGeneratorTemplate(): string {
    return `module.exports = {
  kind: "document",
  id: "hello-document-generator",
  description: "Hello World document generator example.",

  // Optional: skip files where this generator should not run.
  applies(ctx) {
    return /<\\s*Form\\b/i.test(ctx.document.getXml());
  },

  // Input: full XML document via ctx.document.getXml()
  // Output: mutate the document via ctx.document.setXml(...) or ctx.document.append/prepend/before/after(...)
  run(ctx) {
    const marker = "<!-- hello-document-generator -->";
    const xml = ctx.document.getXml();
    if (xml.includes(marker)) {
      return;
    }

    const result = ctx.document.append("//Form", "\\n  " + marker + "\\n", false);
    if (result.insertCount === 0) {
      ctx.warn("hello-document-no-form", "No //Form node found, nothing inserted.");
    }
  }
};
`;
  }

  private buildSnippetGeneratorTemplate(): string {
    return `module.exports = {
  kind: "snippet",
  id: "hello-snippet-generator",
  selector: "Demo/HelloSnippet",
  description: "Hello World snippet generator example.",

  // This runs only for blocks with: UseGenerator="Demo/HelloSnippet"
  // Example input:
  // <GeneratorSnippet UseGenerator="Demo/HelloSnippet" Name="Team" />
  run(ctx) {
    const name = (ctx.snippet.attrs.get("Name") ?? "World").trim() || "World";
    const safeName = ctx.helpers.xml.escapeAttr(name);
    const replacement = "<Label Text=\\"Hello " + safeName + "\\" />";
    ctx.replaceSnippet(replacement);
  }
};
`;
  }
}

