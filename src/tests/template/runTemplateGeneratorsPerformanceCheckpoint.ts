import { strict as assert } from "node:assert";
import * as path from "node:path";
import { runTemplateGenerators } from "../../template/generators";
import { loadUserGeneratorsFromFiles } from "../../template/generators/userGeneratorLoader";

async function run(): Promise<void> {
  const generators = await loadUserGeneratorsFromFiles([
    path.resolve(process.cwd(), "tests/fixtures/template-generators-user/XML_Generators/actionShareCodeLift.generator.js"),
    path.resolve(process.cwd(), "tests/fixtures/template-generators-user/XML_Generators/buttonWithDialog.generator.js"),
    path.resolve(process.cwd(), "tests/fixtures/template-generators-user/XML_Generators/addFlag.generator.js")
  ]);

  const iterations = Math.max(20, Number(process.env.SFP_TPL_GEN_PERF_ITERATIONS ?? 120));
  const maxOverheadMs = Math.max(200, Number(process.env.SFP_TPL_GEN_MAX_OVERHEAD_MS ?? 2500));
  const maxAverageOverheadMs = Math.max(1, Number(process.env.SFP_TPL_GEN_MAX_AVG_OVERHEAD_MS ?? 20));

  const workload = [
    {
      xml: `
<WorkFlow FormIdent="T11PerfWorkFlow">
  <ActionShareCodes>
  </ActionShareCodes>
  <Buttons>
    <Button Ident="AssignButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'A'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'B'" />
      </Actions>
    </Button>
    <Button Ident="AssignToMeButton">
      <Actions>
        <Action xsi:type="SetValue" ControlIdent="AssignedGroupID" Value="'A'" />
        <Action xsi:type="SetValue" ControlIdent="AssignedAccountID" Value="'B'" />
      </Actions>
    </Button>
  </Buttons>
</WorkFlow>`,
      relativeTemplatePath: "Perf/T11PerfWorkFlow.xml"
    },
    {
      xml: `
<Form FormIdent="T11PerfForm">
  <Meta />
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
</Form>`,
      relativeTemplatePath: "Perf/T11PerfForm.xml"
    }
  ] as const;

  for (let i = 0; i < 15; i++) {
    for (const sample of workload) {
      runTemplateGenerators(
        {
          xml: sample.xml,
          sourceTemplateText: sample.xml,
          relativeTemplatePath: sample.relativeTemplatePath,
          mode: "release"
        },
        {
          enabled: true,
          timeoutMs: 300,
          userGenerators: generators
        }
      );
    }
  }

  const baselineStartedAt = process.hrtime.bigint();
  let baselineSignature = "";
  for (let i = 0; i < iterations; i++) {
    for (const sample of workload) {
      const result = runTemplateGenerators(
        {
          xml: sample.xml,
          sourceTemplateText: sample.xml,
          relativeTemplatePath: sample.relativeTemplatePath,
          mode: "release"
        },
        {
          enabled: false,
          timeoutMs: 300,
          userGenerators: generators
        }
      );
      baselineSignature = `${baselineSignature.length}:${result.xml.length}`;
    }
  }
  const baselineMs = Number(process.hrtime.bigint() - baselineStartedAt) / 1_000_000;

  const generatorStartedAt = process.hrtime.bigint();
  let generatedSignature = "";
  for (let i = 0; i < iterations; i++) {
    for (const sample of workload) {
      const result = runTemplateGenerators(
        {
          xml: sample.xml,
          sourceTemplateText: sample.xml,
          relativeTemplatePath: sample.relativeTemplatePath,
          mode: "release"
        },
        {
          enabled: true,
          timeoutMs: 300,
          userGenerators: generators
        }
      );
      generatedSignature = `${generatedSignature.length}:${result.xml.length}`;
    }
  }
  const generatorsMs = Number(process.hrtime.bigint() - generatorStartedAt) / 1_000_000;

  assert.notEqual(baselineSignature.length, 0);
  assert.notEqual(generatedSignature.length, 0);

  const overheadMs = Math.max(0, generatorsMs - baselineMs);
  const operations = iterations * workload.length;
  const averageOverheadMs = overheadMs / operations;

  assert.equal(
    overheadMs <= maxOverheadMs,
    true,
    `Generator overhead too high: ${overheadMs.toFixed(2)} ms > ${maxOverheadMs} ms (iterations=${iterations})`
  );
  assert.equal(
    averageOverheadMs <= maxAverageOverheadMs,
    true,
    `Average generator overhead too high: ${averageOverheadMs.toFixed(3)} ms/op > ${maxAverageOverheadMs} ms/op`
  );

  console.log(
    `PASS: generators-performance-checkpoint baseline=${baselineMs.toFixed(2)} ms, withGenerators=${generatorsMs.toFixed(2)} ms, overhead=${overheadMs.toFixed(2)} ms, avg=${averageOverheadMs.toFixed(3)} ms/op`
  );
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
