import { tokenizeXml } from "./tokenizer";
import { CDataNode, CommentNode, ElementNode, OrphanClosingNode, TextNode, XmlDeclNode, XmlDocumentAst, XmlNode, XmlToken } from "./types";

export function parseXmlTolerant(source: string): XmlDocumentAst {
  const tokens = tokenizeXml(source);
  const root: ElementNode = {
    kind: "element",
    name: "__root__",
    openToken: { kind: "openingTag", raw: "", start: 0, end: 0, name: "__root__", attributesRaw: "" },
    selfClosing: false,
    invalid: false,
    children: [],
    start: 0,
    end: source.length,
    rules: new Set<string>()
  };
  const stack: ElementNode[] = [root];
  let recoveries = 0;

  for (const token of tokens) {
    const current = stack[stack.length - 1];
    if (token.kind === "text") {
      const node: TextNode = {
        kind: "text",
        raw: token.raw,
        start: token.start,
        end: token.end,
        rules: new Set<string>()
      };
      current.children.push(node);
      continue;
    }

    if (token.kind === "comment") {
      const node: CommentNode = {
        kind: "comment",
        raw: token.raw,
        start: token.start,
        end: token.end,
        rules: new Set<string>()
      };
      current.children.push(node);
      continue;
    }

    if (token.kind === "cdata") {
      const node: CDataNode = {
        kind: "cdata",
        raw: token.raw,
        start: token.start,
        end: token.end,
        rules: new Set<string>()
      };
      current.children.push(node);
      continue;
    }

    if (token.kind === "xmlDecl") {
      const node: XmlDeclNode = {
        kind: "xmlDecl",
        raw: token.raw,
        start: token.start,
        end: token.end,
        rules: new Set<string>()
      };
      current.children.push(node);
      continue;
    }

    if (token.kind === "openingTag" || token.kind === "selfClosingTag") {
      const element: ElementNode = {
        kind: "element",
        name: token.name ?? "",
        openToken: token,
        selfClosing: token.kind === "selfClosingTag",
        invalid: false,
        children: [],
        start: token.start,
        end: token.end,
        rules: new Set<string>()
      };
      current.children.push(element);
      if (!element.selfClosing) {
        stack.push(element);
      }
      continue;
    }

    if (token.kind === "closingTag") {
      const name = token.name ?? "";
      const matchIndex = findMatchingElementIndex(stack, name);
      if (matchIndex < 0) {
        const orphan: OrphanClosingNode = {
          kind: "orphanClosing",
          raw: token.raw,
          name,
          start: token.start,
          end: token.end,
          rules: new Set<string>()
        };
        current.children.push(orphan);
        recoveries++;
        continue;
      }

      for (let i = stack.length - 1; i > matchIndex; i--) {
        const invalid = stack.pop();
        if (!invalid || invalid === root) {
          continue;
        }
        invalid.invalid = true;
        invalid.end = computeNodeEnd(invalid, invalid.openToken.end);
        recoveries++;
      }

      const matched = stack.pop();
      if (!matched || matched === root) {
        recoveries++;
        continue;
      }

      matched.closeToken = token;
      matched.end = token.end;
    }
  }

  while (stack.length > 1) {
    const unclosed = stack.pop();
    if (!unclosed || unclosed === root) {
      continue;
    }
    unclosed.invalid = true;
    unclosed.end = computeNodeEnd(unclosed, unclosed.openToken.end);
    recoveries++;
  }

  const invalidNodes = countInvalidNodes(root.children);
  return {
    source,
    lineEnding: detectLineEnding(source),
    nodes: root.children,
    recoveries,
    invalidNodes
  };
}

function findMatchingElementIndex(stack: ElementNode[], name: string): number {
  for (let i = stack.length - 1; i >= 1; i--) {
    if (stack[i].name === name) {
      return i;
    }
  }
  return -1;
}

function computeNodeEnd(node: ElementNode, fallback: number): number {
  if (node.children.length === 0) {
    return fallback;
  }

  return node.children[node.children.length - 1].end;
}

function countInvalidNodes(nodes: readonly XmlNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === "element") {
      if (node.invalid) {
        count++;
      }
      count += countInvalidNodes(node.children);
    }
  }
  return count;
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

