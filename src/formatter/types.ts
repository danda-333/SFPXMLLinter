export type XmlTokenKind =
  | "xmlDecl"
  | "openingTag"
  | "closingTag"
  | "selfClosingTag"
  | "comment"
  | "cdata"
  | "text";

export interface XmlToken {
  kind: XmlTokenKind;
  raw: string;
  start: number;
  end: number;
  name?: string;
  attributesRaw?: string;
}

interface BaseNode {
  kind: string;
  start: number;
  end: number;
  rules: Set<string>;
}

export interface XmlDeclNode extends BaseNode {
  kind: "xmlDecl";
  raw: string;
}

export interface TextNode extends BaseNode {
  kind: "text";
  raw: string;
}

export interface CommentNode extends BaseNode {
  kind: "comment";
  raw: string;
}

export interface CDataNode extends BaseNode {
  kind: "cdata";
  raw: string;
}

export interface OrphanClosingNode extends BaseNode {
  kind: "orphanClosing";
  raw: string;
  name: string;
}

export interface ElementNode extends BaseNode {
  kind: "element";
  name: string;
  openToken: XmlToken;
  closeToken?: XmlToken;
  selfClosing: boolean;
  invalid: boolean;
  children: XmlNode[];
}

export type XmlNode = XmlDeclNode | TextNode | CommentNode | CDataNode | OrphanClosingNode | ElementNode;

export interface XmlDocumentAst {
  source: string;
  lineEnding: "\n" | "\r\n";
  nodes: XmlNode[];
  recoveries: number;
  invalidNodes: number;
}

export interface FormatterOptions {
  indentUnit: string;
  lineEnding: "\n" | "\r\n";
  tabSize: number;
  insertSpaces: boolean;
  maxConsecutiveBlankLines: number;
  forceInlineAttributes: boolean;
  typeAttributeFirst: boolean;
}
