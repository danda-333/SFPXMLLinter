import { XPathInsertMode } from "../buildXmlTemplatesCore";
import { XmlHelpers } from "./helpers";

export type TemplateGeneratorMode = "fast" | "debug" | "release";

export interface TemplateGeneratorInput {
  xml: string;
  sourceTemplateText: string;
  relativeTemplatePath: string;
  mode: TemplateGeneratorMode;
}

export interface TemplateGeneratorWarning {
  code: string;
  message: string;
}

export interface TemplateGeneratorExecutionOptions {
  enabled: boolean;
  timeoutMs: number;
  userGenerators?: LoadedTemplateGenerator[];
}

export interface TemplateGeneratorExecutionReport {
  xml: string;
  durationMs: number;
  appliedGeneratorIds: string[];
  warnings: TemplateGeneratorWarning[];
}

export interface XPathInsertOperationResult {
  matchCount: number;
  insertCount: number;
}

export interface GeneratorDocumentHandle {
  getXml(): string;
  setXml(xml: string): void;
  insertByXPath(
    targetXPath: string,
    content: string,
    mode?: XPathInsertMode,
    allowMultipleInserts?: boolean
  ): XPathInsertOperationResult;
  append(targetXPath: string, content: string, allowMultipleInserts?: boolean): XPathInsertOperationResult;
  prepend(targetXPath: string, content: string, allowMultipleInserts?: boolean): XPathInsertOperationResult;
  before(targetXPath: string, content: string, allowMultipleInserts?: boolean): XPathInsertOperationResult;
  after(targetXPath: string, content: string, allowMultipleInserts?: boolean): XPathInsertOperationResult;
}

export interface SnippetBlock {
  tagName: string;
  outerXml: string;
  innerXml: string;
  attrs: Map<string, string>;
  start: number;
  end: number;
}

export interface GeneratorContextBase {
  input: TemplateGeneratorInput;
  document: GeneratorDocumentHandle;
  helpers: {
    xml: XmlHelpers;
  };
  log(line: string): void;
  warn(code: string, message: string): void;
}

export interface DocumentGeneratorContext extends GeneratorContextBase {}

export interface SnippetGeneratorContext extends GeneratorContextBase {
  useGenerator: string;
  snippet: SnippetBlock;
  replaceSnippet(xml: string): void;
  removeSnippet(): void;
}

export interface DocumentTemplateGenerator {
  kind: "document";
  id: string;
  description: string;
  applies?(context: DocumentGeneratorContext): boolean;
  run(context: DocumentGeneratorContext): void;
}

export interface SnippetTemplateGenerator {
  kind: "snippet";
  id: string;
  description: string;
  selector: string;
  applies?(context: SnippetGeneratorContext): boolean;
  run(context: SnippetGeneratorContext): void;
}

export type LoadedTemplateGenerator = DocumentTemplateGenerator | SnippetTemplateGenerator;
