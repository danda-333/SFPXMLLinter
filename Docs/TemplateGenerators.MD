# Template Generators API

This document describes user-defined build generators used by SFP XML Linter template builder.

## Where generators are loaded from

- Default folder: `XML_Generators`
- Supported files: `*.js`, `*.cjs`, `*.mjs`, `*.ts`
- Config:
  - `sfpXmlLinter.templateBuilder.generators.enableUserScripts`
  - `sfpXmlLinter.templateBuilder.generators.userScriptsRoots`

## Generator kinds

There are two generator kinds:

1. `document`
2. `snippet`

### 1) Document generator

Runs over full rendered XML document.

```js
module.exports = {
  kind: "document",
  id: "my-document-generator",
  description: "Runs over the whole XML.",
  applies(ctx) {
    return /<\s*WorkFlow\b/i.test(ctx.document.getXml());
  },
  run(ctx) {
    const result = ctx.document.append("//WorkFlow/ActionShareCodes", "\n<!-- demo -->\n");
    if (result.insertCount === 0) {
      ctx.warn("my-generator-no-target", "Target XPath not found.");
    }
  }
};
```

### 2) Snippet generator

Runs only for blocks marked by `UseGenerator`.

```js
module.exports = {
  kind: "snippet",
  id: "my-snippet-generator",
  selector: "Demo/Hello",
  description: "Transforms one marked snippet.",
  run(ctx) {
    const name = (ctx.snippet.attrs.get("Name") ?? "World").trim() || "World";
    const safeName = ctx.helpers.xml.escapeAttr(name);
    ctx.replaceSnippet(`<Label Text="Hello ${safeName}" />`);
  }
};
```

Template usage:

```xml
<GeneratorSnippet UseGenerator="Demo/Hello" Name="Team" />
```

## Context API

Both kinds receive `ctx`.

- `ctx.input.xml`
- `ctx.input.sourceTemplateText`
- `ctx.input.relativeTemplatePath`
- `ctx.input.mode`
- `ctx.log(message)`
- `ctx.warn(code, message)`

Shared document API:

- `ctx.document.getXml()`
- `ctx.document.setXml(xml)`
- `ctx.document.insertByXPath(xpath, content, mode, allowMultiple)`
- `ctx.document.append(xpath, content, allowMultiple)`
- `ctx.document.prepend(xpath, content, allowMultiple)`
- `ctx.document.before(xpath, content, allowMultiple)`
- `ctx.document.after(xpath, content, allowMultiple)`

Shared XML helpers:

- `ctx.helpers.xml.parseAttributes(rawAttrs)`
- `ctx.helpers.xml.extractTagBody(text, tagName)`
- `ctx.helpers.xml.escapeAttr(value)`
- `ctx.helpers.xml.escapeRegex(value)`

Snippet-only API:

- `ctx.useGenerator`
- `ctx.snippet.tagName`
- `ctx.snippet.outerXml`
- `ctx.snippet.innerXml`
- `ctx.snippet.attrs`
- `ctx.snippet.start`
- `ctx.snippet.end`
- `ctx.replaceSnippet(xml)`
- `ctx.removeSnippet()`

## Commands for quick generator scaffolding

Extension commands:

- `SFP XML Linter: Create Generator Template (Document)`
- `SFP XML Linter: Create Generator Template (Snippet)`

These commands create hello-world JS templates in `XML_Generators`:

- `hello.document.generator.js`
- `hello.snippet.generator.js`

If file name already exists, numeric suffix is used automatically.

