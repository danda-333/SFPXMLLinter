import { strict as assert } from "node:assert";
import * as path from "node:path";
import { runTemplateGenerators } from "../../template/generators";
import { loadUserGeneratorsFromFiles, loadWorkspaceUserGenerators } from "../../template/generators/userGeneratorLoader";

async function run(): Promise<void> {
  const generators = await loadGeneratorFixtures();
  testLiftRepeatedActions(generators);
  testExpandButtonWithDialog(generators);
  testReuseExistingActionShareCode(generators);
  testAmbiguousExistingShareCodeWarning(generators);
  testDeterministicIdempotentOutput(generators);
  await testUserDefinedGeneratorSupport();
  console.log("Template generators tests passed.");
}

async function loadGeneratorFixtures() {
  const files = [
    path.resolve(process.cwd(), "tests/fixtures/template-generators-user/XML_Generators/actionShareCodeLift.generator.js"),
    path.resolve(process.cwd(), "tests/fixtures/template-generators-user/XML_Generators/buttonWithDialog.generator.js")
  ];
  return loadUserGeneratorsFromFiles(files);
}

function testLiftRepeatedActions(generators: Awaited<ReturnType<typeof loadGeneratorFixtures>>): void {
  const input = `
<WorkFlow FormIdent="TestForm">
  <ActionShareCodes>
  </ActionShareCodes>
  <Buttons>
    <Button Ident="AssignButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
    <Button Ident="AssignToMeButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
  </Buttons>
</WorkFlow>`;

  const result = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/WorkFlow.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  assert.equal(result.appliedGeneratorIds.includes("lift-repeated-actions-to-sharecode"), true);
  assert.equal(result.xml.includes(`ActionShareCode Ident="AutoLiftActionShareCode1"`), true);
  assert.equal(
    result.xml.match(/<Action xsi:type="ShareCode" Ident="AutoLiftActionShareCode1" \/>/g)?.length ?? 0,
    2
  );
  console.log("PASS: generators-lift-repeated-actions");
}

function testExpandButtonWithDialog(generators: Awaited<ReturnType<typeof loadGeneratorFixtures>>): void {
  const input = `
<Form FormIdent="TestForm">
  <Buttons>
    <GeneratorSnippet UseGenerator="Common/Buttons/ButtonWithDialog" Ident="AssignButton" TitleResourceKey="AssignButton_ITSM" IsSave="true" DialogSectionIdent="AssignConfirmFormDialogSection" DialogExtensionIdent="AssignConfirmFormDialog" DialogTitleResourceKey="AssignConfirmFormDialogSectionTitle_ITSM" DialogConfirmButtonTitleResourceKey="AssignConfirmFormDialogSectionConfirmButton_ITSM" DialogCloseButtonTitleResourceKey="AssignConfirmFormDialogSectionCloseButton_ITSM">
      <Actions>
        <Action xsi:type="ShareCode" Ident="Assignee_Update_FromDialog_ActionShare" />
      </Actions>
      <DialogHTMLTemplate><![CDATA[
        <div class="row">
          <div class="col-md-12">
            <div class="form-group">
              <ControlLabel ControlID="DialogAssignedGroupID" />
              <Control ID="DialogAssignedGroupID" />
            </div>
          </div>
        </div>
      ]]></DialogHTMLTemplate>
    </GeneratorSnippet>
  </Buttons>
  <Sections>
  </Sections>
</Form>`;

  const result = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/ButtonWithDialog.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  assert.equal(result.appliedGeneratorIds.includes("button-with-confirm-dialog"), true);
  assert.equal(result.xml.includes("UseGenerator=\"Common/Buttons/ButtonWithDialog\""), false);
  assert.equal(
    result.xml.includes('<Extension xsi:type="ConfirmFormDialogExtension" Ident="AssignConfirmFormDialog" ConfirmFormDialogSectionIdent="AssignConfirmFormDialogSection" />'),
    true
  );
  assert.equal(
    result.xml.includes('<Section xsi:type="ConfirmFormDialogSection" Ident="AssignConfirmFormDialogSection"'),
    true
  );
  console.log("PASS: generators-button-with-dialog");
}

function testReuseExistingActionShareCode(generators: Awaited<ReturnType<typeof loadGeneratorFixtures>>): void {
  const input = `
<WorkFlow FormIdent="TestForm">
  <ActionShareCodes>
    <ActionShareCode Ident="ExistingAssignActionShare">
      <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
      <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
    </ActionShareCode>
  </ActionShareCodes>
  <Buttons>
    <Button Ident="AssignButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
    <Button Ident="AssignToMeButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
  </Buttons>
</WorkFlow>`;

  const result = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/Reuse.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  assert.equal(result.xml.includes(`AutoLiftActionShareCode`), false);
  assert.equal(
    result.xml.match(/<Action xsi:type="ShareCode" Ident="ExistingAssignActionShare" \/>/g)?.length ?? 0,
    2
  );
  console.log("PASS: generators-reuse-existing-sharecode");
}

function testAmbiguousExistingShareCodeWarning(generators: Awaited<ReturnType<typeof loadGeneratorFixtures>>): void {
  const input = `
<WorkFlow FormIdent="TestForm">
  <ActionShareCodes>
    <ActionShareCode Ident="ExistingA">
      <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
      <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
    </ActionShareCode>
    <ActionShareCode Ident="ExistingB">
      <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
      <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
    </ActionShareCode>
  </ActionShareCodes>
  <Buttons>
    <Button Ident="AssignButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
    <Button Ident="AssignToMeButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
  </Buttons>
</WorkFlow>`;

  const result = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/Ambiguous.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  assert.equal(result.appliedGeneratorIds.length, 0);
  assert.equal(result.warnings.some((item) => item.code === "generator-ambiguous-existing-sharecode"), true);
  assert.equal(
    result.xml.match(/<Action xsi:type="SetValue" ControlIdent="AssignedGroupID"/g)?.length ?? 0,
    4
  );
  console.log("PASS: generators-ambiguous-existing-warning");
}

function testDeterministicIdempotentOutput(generators: Awaited<ReturnType<typeof loadGeneratorFixtures>>): void {
  const input = `
<WorkFlow FormIdent="TestForm">
  <ActionShareCodes>
  </ActionShareCodes>
  <Buttons>
    <Button Ident="AssignButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
    <Button Ident="AssignToMeButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'X'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'Y'" />
      </Actions>
    </Button>
  </Buttons>
</WorkFlow>`;

  const first = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/Idempotent.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  const second = runTemplateGenerators(
    {
      xml: first.xml,
      sourceTemplateText: first.xml,
      relativeTemplatePath: "Demo/Idempotent.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: generators
    }
  );

  assert.equal(second.xml, first.xml);
  assert.equal(second.appliedGeneratorIds.length, 0);
  console.log("PASS: generators-idempotent");
}

async function testUserDefinedGeneratorSupport(): Promise<void> {
  const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/template-generators-user");
  const loaded = await loadWorkspaceUserGenerators(fixturesRoot, ["XML_Generators"]);
  assert.equal(loaded.length >= 3, true);
  assert.equal(loaded.some((item) => item.id === "user-add-flag"), true);

  const input = `<Form><Meta /></Form>`;
  const result = runTemplateGenerators(
    {
      xml: input,
      sourceTemplateText: input,
      relativeTemplatePath: "Demo/User.xml",
      mode: "debug"
    },
    {
      enabled: true,
      timeoutMs: 300,
      userGenerators: loaded
    }
  );

  assert.equal(result.xml.includes(`<GeneratedByUserScript Value="yes" />`), true);
  assert.equal(result.appliedGeneratorIds.includes("user-add-flag"), true);
  console.log("PASS: generators-user-defined");
}

void run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
