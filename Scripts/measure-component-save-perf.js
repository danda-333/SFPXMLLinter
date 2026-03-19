const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const workspaceRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'linter-performance');

const ioStats = {
  readCount: 0,
  readBytes: 0,
  readMs: 0,
  writeCount: 0,
  writeBytes: 0,
  writeMs: 0,
  statCount: 0,
  statMs: 0
};

const originalReadFile = fs.promises.readFile.bind(fs.promises);
const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
const originalStat = fs.promises.stat.bind(fs.promises);

fs.promises.readFile = async function patchedReadFile(...args) {
  const t0 = Date.now();
  const data = await originalReadFile(...args);
  ioStats.readCount++;
  ioStats.readMs += Date.now() - t0;
  ioStats.readBytes += Buffer.byteLength(data);
  return data;
};

fs.promises.writeFile = async function patchedWriteFile(...args) {
  const t0 = Date.now();
  const content = args[1];
  await originalWriteFile(...args);
  ioStats.writeCount++;
  ioStats.writeMs += Date.now() - t0;
  if (Buffer.isBuffer(content)) {
    ioStats.writeBytes += content.length;
  } else if (typeof content === 'string') {
    ioStats.writeBytes += Buffer.byteLength(content);
  } else if (content instanceof Uint8Array) {
    ioStats.writeBytes += content.byteLength;
  }
};

fs.promises.stat = async function patchedStat(...args) {
  const t0 = Date.now();
  const stat = await originalStat(...args);
  ioStats.statCount++;
  ioStats.statMs += Date.now() - t0;
  return stat;
};

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
    this.scheme = 'file';
  }
  static file(fsPath) { return new Uri(fsPath); }
  static parse(value) {
    if (value.startsWith('file://')) {
      return new Uri(decodeURIComponent(value.replace('file://', '')));
    }
    return new Uri(value);
  }
  toString() {
    return `file://${this.fsPath.replace(/\\/g, '/')}`;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = base instanceof Uri ? base : base.uri;
    this.pattern = pattern;
  }
}

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class TextDocument {
  constructor(uri, text) { this.uri = uri; this._text = text; this.languageId = 'xml'; }
  getText() { return this._text; }
  positionAt(offset) {
    const text = this._text;
    const safe = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let lastLineStart = 0;
    for (let i = 0; i < safe; i++) {
      if (text.charCodeAt(i) === 10) {
        line++;
        lastLineStart = i + 1;
      }
    }
    return new Position(line, safe - lastLineStart);
  }
}

const state = {
  workspaceRoot,
  textDocuments: [],
  config: {
    workspaceRoots: ['XML', 'XML_Templates', 'XML_Components', 'XML_Primitives'],
    resourcesRoots: ['Resources'],
    hoverDocsFiles: [],
    rules: {},
    incompleteMode: false,
    'templateBuilder.autoBuildOnSave': true,
    'templateBuilder.componentSaveBuildScope': 'dependents',
    'templateBuilder.generatorsEnabled': true,
    'templateBuilder.generatorTimeoutMs': 300,
    'templateBuilder.generatorEnableUserScripts': true,
    'templateBuilder.generatorUserScriptsRoots': ['XML_Generators'],
    'templateBuilder.postBuildFormat': true,
    'templateBuilder.provenanceMode': 'off',
    'formatter.maxConsecutiveBlankLines': 2
  }
};

function collectXmlFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  const out = [];
  const stack = [baseDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.xml$/i.test(entry.name)) out.push(Uri.file(full));
    }
  }
  return out;
}

function parseRootFromPattern(globPattern) {
  const normalized = globPattern.replace(/\\/g, '/');
  const withoutPrefix = normalized.replace(/^\*\*\//, '');
  return withoutPrefix.split('/')[0];
}

const vscodeMock = {
  Uri,
  RelativePattern,
  Position,
  Range,
  Location,
  DiagnosticSeverity,
  Diagnostic,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: 'fixture', index: 0 }],
    textDocuments: state.textDocuments,
    fs: {
      async readFile(uri) { return new Uint8Array(await fs.promises.readFile(uri.fsPath)); },
      async writeFile(uri, content) { await fs.promises.writeFile(uri.fsPath, Buffer.from(content)); },
      async createDirectory(uri) { await fs.promises.mkdir(uri.fsPath, { recursive: true }); },
      async stat(uri) {
        const s = await fs.promises.stat(uri.fsPath);
        return { type: 0, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
      }
    },
    async findFiles(pattern) {
      const p = typeof pattern === 'string' ? pattern : pattern.pattern;
      const base = typeof pattern === 'string' ? workspaceRoot : pattern.baseUri.fsPath;
      const root = parseRootFromPattern(p);
      if (!root) return [];
      return collectXmlFiles(path.join(base, root));
    },
    async openTextDocument(uri) {
      const text = fs.readFileSync(uri.fsPath, 'utf8');
      const doc = new TextDocument(uri, text);
      return doc;
    },
    getWorkspaceFolder(uri) {
      const root = workspaceRoot.replace(/\\/g, '/').toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, '/').toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(workspaceRoot), name: 'fixture', index: 0 } : undefined;
    },
    asRelativePath(uri) {
      const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
      return path.relative(workspaceRoot, fsPath).replace(/\\/g, '/');
    },
    getConfiguration(section) {
      if (section !== 'sfpXmlLinter') return { get: (_k, d) => d };
      return { get: (k, d) => (state.config[k] ?? d) };
    }
  },
  window: {
    showInformationMessage() {},
    showErrorMessage() {}
  }
};

const moduleAny = Module;
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};

async function run() {
  const { WorkspaceIndexer } = require('../out/indexer/workspaceIndexer');
  const { BuildXmlTemplatesService } = require('../out/template/buildXmlTemplatesService');
  const { DependencyValidationService } = require('../out/core/validation/dependencyValidationService');
  const { UpdateOrchestrator } = require('../out/orchestrator/updateOrchestrator');
  const { DiagnosticsEngine } = require('../out/diagnostics/engine');

  const templateIndexer = new WorkspaceIndexer(['XML_Templates', 'XML_Components', 'XML_Primitives']);
  const runtimeIndexer = new WorkspaceIndexer(['XML']);

  await templateIndexer.rebuildIndex({ scope: 'all' });
  await runtimeIndexer.rebuildIndex({ scope: 'all' });

  const buildService = new BuildXmlTemplatesService();
  const workspaceFolder = vscodeMock.workspace.workspaceFolders[0];
  const componentPath = path.join(workspaceRoot, 'XML_Components', 'Common', 'Controls', 'AdditionalFields.component.xml');
  const componentUri = Uri.file(componentPath);
  const componentText = fs.readFileSync(componentPath, 'utf8');
  const doc = new TextDocument(componentUri, componentText);

  const logs = [];
  const queuedValidationUris = [];
  const diagnosticsEngine = new DiagnosticsEngine();
  const depValidationService = new DependencyValidationService({
    getTemplateIndex: () => templateIndexer.getIndex(),
    getRuntimeIndex: () => runtimeIndexer.getIndex(),
    isReindexRelevantUri: (uri) => uri.scheme === 'file' && /\.xml$/i.test(uri.fsPath),
    shouldValidateUriForActiveProjects: () => true,
    validateOpenDocumentNow: () => {},
    enqueueValidationLow: (uri) => {
      queuedValidationUris.push(uri);
    },
    logIndex: (m) => logs.push(m)
  });

  let lastBuildMs = 0;
  let lastBuildTargets = 0;
  let lastBuildUpdated = 0;
  let lastBuildSkipped = 0;
  let lastQueueProcessMs = 0;
  let lastQueueDiagnostics = 0;

  const orchestrator = new UpdateOrchestrator({
    log: (m) => logs.push(m),
    isReindexRelevantUri: (uri) => uri.scheme === 'file' && /\.xml$/i.test(uri.fsPath),
    refreshIncremental: (document) => templateIndexer.refreshXmlDocument(document),
    collectAffectedFormIdentsForComponent: (componentKey) => depValidationService.collectAffectedFormIdentsForComponent(componentKey),
    enqueueDependentValidationForFormIdents: (formIdents, sourceLabel) => depValidationService.enqueueDependentValidationForFormIdents(formIdents, sourceLabel),
    triggerAutoBuild: async (document) => {
      const t0 = Date.now();
      const targets = await buildService.findTemplatesUsingComponent(workspaceFolder, document.uri.fsPath);
      lastBuildTargets = targets.length;
      let updated = 0;
      let skipped = 0;
      for (const target of targets) {
        const result = await buildService.runForPath(workspaceFolder, target, {
          silent: true,
          mode: 'fast',
          postBuildFormat: true,
          provenanceMode: 'off',
          formatterMaxConsecutiveBlankLines: 2,
          generatorsEnabled: true,
          generatorTimeoutMs: 300,
          generatorEnableUserScripts: true,
          generatorUserScriptsRoots: ['XML_Generators']
        });
        updated += result.summary?.updated ?? 0;
        skipped += result.summary?.skipped ?? 0;
      }
      lastBuildMs = Date.now() - t0;
      lastBuildUpdated = updated;
      lastBuildSkipped = skipped;
    },
    queueFullReindex: () => {}
  });

  async function measureOne(label) {
    ioStats.readCount = 0;
    ioStats.readBytes = 0;
    ioStats.readMs = 0;
    ioStats.writeCount = 0;
    ioStats.writeBytes = 0;
    ioStats.writeMs = 0;
    ioStats.statCount = 0;
    ioStats.statMs = 0;
    queuedValidationUris.length = 0;
    lastQueueProcessMs = 0;
    lastQueueDiagnostics = 0;

    const started = Date.now();
    await orchestrator.handleDocumentSave(doc, true);
    const queueStarted = Date.now();
    let diagnosticsCount = 0;
    for (const uri of queuedValidationUris) {
      const text = fs.readFileSync(uri.fsPath, 'utf8');
      const vdoc = new TextDocument(uri, text);
      const rel = path.relative(workspaceRoot, uri.fsPath).replace(/\\\\/g, '/').toLowerCase();
      const index = rel.includes('xml_templates/') || rel.includes('xml_components/') || rel.includes('xml_primitives/')
        ? templateIndexer.getIndex()
        : runtimeIndexer.getIndex();
      diagnosticsCount += diagnosticsEngine.buildDiagnostics(vdoc, index).length;
    }
    lastQueueProcessMs = Date.now() - queueStarted;
    lastQueueDiagnostics = diagnosticsCount;
    const total = Date.now() - started;
    const depQueue = logs.find((line) => String(line).includes('SAVE dependency revalidation queued')) || 'n/a';
    console.log(`[save-perf] ${label}: total=${total} ms, build=${lastBuildMs} ms, targets=${lastBuildTargets}, updated=${lastBuildUpdated}, skipped=${lastBuildSkipped}`);
    console.log(`[save-perf] ${label}: queuedValidation files=${queuedValidationUris.length}, process=${lastQueueProcessMs} ms, diagnostics=${lastQueueDiagnostics}`);
    console.log(
      `[save-perf] ${label}: io read=${ioStats.readCount} (${Math.round(ioStats.readBytes / 1024)} KiB, ${ioStats.readMs} ms), ` +
      `write=${ioStats.writeCount} (${Math.round(ioStats.writeBytes / 1024)} KiB, ${ioStats.writeMs} ms), ` +
      `stat=${ioStats.statCount} (${ioStats.statMs} ms)`
    );
    console.log(`[save-perf] ${label}: ${depQueue}`);
  }

  await measureOne('cold');
  await measureOne('warm');
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
