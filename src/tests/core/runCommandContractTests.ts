import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

type PackageJsonLike = {
  contributes?: {
    commands?: Array<{ command?: string }>;
  };
  activationEvents?: string[];
};

function run(): void {
  const repoRoot = path.resolve(__dirname, "../../..");
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonLike;
  const contributedCommands = new Set(
    (packageJson.contributes?.commands ?? [])
      .map((entry) => entry.command)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const activationEvents = new Set((packageJson.activationEvents ?? []).filter((value) => typeof value === "string"));

  const commandRegistrationSources = [
    path.join(repoRoot, "src/core/ui/coreCommandsRegistrarService.ts"),
    path.join(repoRoot, "src/core/ui/compositionCommandsRegistrarService.ts"),
    path.join(repoRoot, "src/core/ui/workspaceMaintenanceCommandsRegistrarService.ts")
  ];
  const registeredCommands = new Set<string>();
  const registerRegex = /registerCommand\(\s*"([^"]+)"/gms;
  for (const sourcePath of commandRegistrationSources) {
    const content = fs.readFileSync(sourcePath, "utf8");
    for (const match of content.matchAll(registerRegex)) {
      const commandId = match[1] ?? "";
      if (commandId.startsWith("sfpXmlLinter.")) {
        registeredCommands.add(commandId);
      }
    }
  }

  for (const commandId of contributedCommands) {
    assert.ok(
      registeredCommands.has(commandId),
      `Contributed command '${commandId}' is not registered in command registrar services.`
    );
    assert.ok(
      activationEvents.has(`onCommand:${commandId}`),
      `Contributed command '${commandId}' is missing activation event 'onCommand:${commandId}'.`
    );
  }

  const requiredInternalCommands = new Set<string>([
    "sfpXmlLinter.suppressNextSqlSuggest",
    "sfpXmlLinter.compositionCopySummary",
    "sfpXmlLinter.compositionLogNonEffectiveUsings",
    "sfpXmlLinter.compositionApplyPrimitiveQuickFix"
  ]);

  for (const commandId of requiredInternalCommands) {
    assert.ok(
      registeredCommands.has(commandId),
      `Internal command '${commandId}' is missing registration.`
    );
  }

  const requiredContributedCommands = new Set<string>([
    "sfpXmlLinter.buildXmlTemplates",
    "sfpXmlLinter.buildXmlTemplatesAll",
    "sfpXmlLinter.compareTemplateWithBuiltXml",
    "sfpXmlLinter.createDocumentGeneratorTemplate",
    "sfpXmlLinter.createSnippetGeneratorTemplate",
    "sfpXmlLinter.showBuildQueueLog",
    "sfpXmlLinter.showIndexLog",
    "sfpXmlLinter.showCompositionLog",
    "sfpXmlLinter.showPipelineStats",
    "sfpXmlLinter.exportTrace",
    "sfpXmlLinter.exportUsageSnapshot",
    "sfpXmlLinter.generateFeatureManifestBootstrap",
    "sfpXmlLinter.refreshCompositionView",
    "sfpXmlLinter.compositionOpenSource",
    "sfpXmlLinter.compositionOpenSourceBeside",
    "sfpXmlLinter.compositionOpenSourceSidePreview",
    "sfpXmlLinter.compositionShowUsages",
    "sfpXmlLinter.compositionCompare",
    "sfpXmlLinter.workspaceDiagnosticsReport",
    "sfpXmlLinter.rebuildIndex",
    "sfpXmlLinter.revalidateWorkspace",
    "sfpXmlLinter.revalidateProject",
    "sfpXmlLinter.switchProjectScopeToActiveFile",
    "sfpXmlLinter.formatDocumentTolerant",
    "sfpXmlLinter.formatSelectionTolerant",
    "sfpXmlLinter.migrateLegacyTemplateAliases"
  ]);
  for (const commandId of requiredContributedCommands) {
    assert.ok(
      contributedCommands.has(commandId),
      `Required contributed command '${commandId}' is missing from package.json contributes.commands.`
    );
  }

  console.log("Command contract tests passed.");
}

run();
