import { strict as assert } from "node:assert";
import { migrateLegacyAliasesInText } from "../../template/legacyTemplateAliasMigration";

function run(): void {
  testTagAliasMigration();
  testPlaceholderMigration();
  testCommentedContentIsIgnored();
  console.log("Legacy template alias migration tests passed.");
}

function testTagAliasMigration(): void {
  const input = `<Form><Usings><Using Component="Common/A" Section="Buttons" /><Include Name="Common/B" Section="Cols" /></Usings></Form>`;
  const result = migrateLegacyAliasesInText(input);
  assert.equal(result.changed, true);
  assert.equal(result.tagChanges, 2);
  assert.equal(
    result.text,
    `<Form><Usings><Using Feature="Common/A" Contribution="Buttons" /><Include Feature="Common/B" Contribution="Cols" /></Usings></Form>`
  );
}

function testPlaceholderMigration(): void {
  const input = `<Form>{{Component:Common/A,Section:Html,Param:1}}</Form>`;
  const result = migrateLegacyAliasesInText(input);
  assert.equal(result.changed, true);
  assert.equal(result.placeholderChanges, 1);
  assert.equal(result.text, `<Form>{{Feature:Common/A,Contribution:Html,Param:1}}</Form>`);
}

function testCommentedContentIsIgnored(): void {
  const input = `<!-- <Using Component="X" Section="Y" /> -->\n<Form>{{Feature:Common/A,Contribution:Html}}</Form>`;
  const result = migrateLegacyAliasesInText(input);
  assert.equal(result.changed, false);
  assert.equal(result.tagChanges, 0);
  assert.equal(result.placeholderChanges, 0);
  assert.equal(result.text, input);
}

run();
