import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";
import { DiagnosticsHoverProvider } from "../../providers/diagnosticsHoverProvider";
import { HoverRegistry, DocumentationHoverResolver } from "../../providers/hoverRegistry";
import { SfpXmlCompletionProvider } from "../../providers/completionProvider";
import { SfpXmlReferencesProvider } from "../../providers/referencesProvider";
import { SfpXmlDefinitionProvider } from "../../providers/definitionProvider";
import { SfpXmlRenameProvider } from "../../providers/renameProvider";
import { SfpSqlPlaceholderSemanticProvider } from "../../providers/sqlPlaceholderSemanticProvider";
import { SfpXmlColorProvider } from "../../providers/colorProvider";
import { SfpXmlIgnoreCodeActionProvider } from "../../providers/ignoreCodeActionProvider";
import { FormatterOptions } from "../../formatter/types";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";

export interface FormatRangeResult {
  range: vscode.Range;
  text: string;
  recoveries: number;
  invalidNodes: number;
}

export interface LanguageProvidersRegistrarServiceDeps {
  diagnostics: vscode.DiagnosticCollection;
  documentationHoverResolver: DocumentationHoverResolver;
  getIndexForUri: (uri: vscode.Uri | undefined) => WorkspaceIndex;
  getFactsForDocument: (document: vscode.TextDocument) => ReturnType<typeof parseDocumentFactsFromText>;
  getSymbolIdentsForUriKind: (uri: vscode.Uri, kind: string) => readonly string[];
  getSymbolReferenceLocationsByKindIdent: (kind: string, ident: string) => readonly vscode.Location[];
  resolveOwningFormForDiagnostics: (
    formIdent: string,
    preferredIndex: WorkspaceIndex
  ) => { form: import("../../indexer/types").IndexedForm; index: WorkspaceIndex } | undefined;
  createFormatterOptionsFromFormattingOptions: (
    options: vscode.FormattingOptions,
    document: vscode.TextDocument
  ) => FormatterOptions;
  formatDocument: (
    text: string,
    options: FormatterOptions
  ) => { text: string; recoveries: number; invalidNodes: number };
  formatRangeLikeDocument: (
    document: vscode.TextDocument,
    range: vscode.Range,
    options: FormatterOptions
  ) => FormatRangeResult;
  logFormatter: (message: string) => void;
}

export class LanguageProvidersRegistrarService {
  public constructor(private readonly deps: LanguageProvidersRegistrarServiceDeps) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider({ language: "xml" }, new DiagnosticsHoverProvider(this.deps.diagnostics)),
      vscode.languages.registerHoverProvider({ language: "xml" }, new HoverRegistry([this.deps.documentationHoverResolver])),
      vscode.languages.registerCompletionItemProvider(
        { language: "xml" },
        new SfpXmlCompletionProvider(
          (uri) => this.deps.getIndexForUri(uri),
          (formIdent, preferredIndex) => this.deps.resolveOwningFormForDiagnostics(formIdent, preferredIndex),
          (document) => this.deps.getFactsForDocument(document),
          (uri, kind) => this.deps.getSymbolIdentsForUriKind(uri, kind)
        ),
        "<",
        " ",
        ":",
        "\"",
        "'",
        "=",
        "@"
      ),
      vscode.languages.registerReferenceProvider(
        { language: "xml" },
        new SfpXmlReferencesProvider(
          (uri) => this.deps.getIndexForUri(uri),
          (document) => this.deps.getFactsForDocument(document),
          (kind, ident) => this.deps.getSymbolReferenceLocationsByKindIdent(kind, ident)
        )
      ),
      vscode.languages.registerDefinitionProvider({ language: "xml" }, new SfpXmlDefinitionProvider((uri) => this.deps.getIndexForUri(uri))),
      vscode.languages.registerRenameProvider(
        { language: "xml" },
        new SfpXmlRenameProvider(
          (uri) => this.deps.getIndexForUri(uri),
          (document) => this.deps.getFactsForDocument(document),
          (kind, ident) => this.deps.getSymbolReferenceLocationsByKindIdent(kind, ident)
        )
      ),
      vscode.languages.registerDocumentSemanticTokensProvider(
        { language: "xml" },
        new SfpSqlPlaceholderSemanticProvider(),
        SfpSqlPlaceholderSemanticProvider.legend
      ),
      vscode.languages.registerColorProvider({ language: "xml" }, new SfpXmlColorProvider()),
      vscode.languages.registerDocumentFormattingEditProvider({ language: "xml" }, {
        provideDocumentFormattingEdits: (document, options) => {
          const startedAt = Date.now();
          const formatterOptions = this.deps.createFormatterOptionsFromFormattingOptions(options, document);
          const result = this.deps.formatDocument(document.getText(), formatterOptions);
          const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
          this.deps.logFormatter(
            `PROVIDER format document done in ${Date.now() - startedAt} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`
          );
          return [vscode.TextEdit.replace(fullRange, result.text)];
        }
      }),
      vscode.languages.registerDocumentRangeFormattingEditProvider({ language: "xml" }, {
        provideDocumentRangeFormattingEdits: (document, range, options) => {
          const startedAt = Date.now();
          const formatterOptions = this.deps.createFormatterOptionsFromFormattingOptions(options, document);
          const result = this.deps.formatRangeLikeDocument(document, range, formatterOptions);
          this.deps.logFormatter(
            `PROVIDER format range done in ${Date.now() - startedAt} ms (recoveries=${result.recoveries}, invalidNodes=${result.invalidNodes})`
          );
          return [vscode.TextEdit.replace(result.range, result.text)];
        }
      }),
      vscode.languages.registerCodeActionsProvider({ language: "xml" }, new SfpXmlIgnoreCodeActionProvider(), {
        providedCodeActionKinds: SfpXmlIgnoreCodeActionProvider.providedCodeActionKinds
      })
    );
  }
}
