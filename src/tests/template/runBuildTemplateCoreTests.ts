import { strict as assert } from "node:assert";
import { buildComponentLibrary, extractUsingComponentRefs, renderTemplateText, type ComponentSource } from "../../template/buildXmlTemplatesCore";

interface Case {
  name: string;
  components: ComponentSource[];
  template: string;
  expected: string;
  maxDepth?: number;
  expectedDebugLogs?: string[];
  inheritedUsingsXml?: string;
}

function run(): void {
  const cases: Case[] = [
    {
      name: "placeholder-contribution-custom-params",
      components: [
        {
          key: "Common/Shared/Assign",
          text: `
<Feature>
  <Contribution Name="Html" Insert="placeholder" Root="Form">
    <Wrap>{{CustomParam}}|{{FormIdent}}</Wrap>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="ITSMRequest">
  <Usings>
    <Using Feature="Common/Shared/Assign" Contribution="Html" />
  </Usings>
  <Body>{{Feature:Common/Shared/Assign,Contribution:Html,CustomParam:ParamValue}}</Body>
</Form>`,
      expected: `
<Form Ident="ITSMRequest">
  <Body>
    <Wrap>ParamValue|ITSMRequest</Wrap>
  </Body>
</Form>`
    },
    {
      name: "legacy-component-section-tags-still-work",
      components: [
        {
          key: "Common/Legacy",
          text: `
<Component>
  <Section Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="LegacyAdded" />
  </Section>
</Component>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Legacy" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Control Ident="LegacyAdded" />
  </Controls>
</Form>`
    },
    {
      name: "using-append-contribution-filter-and-root",
      components: [
        {
          key: "Common/CompA",
          text: `
<Feature>
  <Contribution Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="AddedByUsing" />
  </Contribution>
  <Contribution Name="Controls" Root="WorkFlow" TargetXPath="//WorkFlow/Controls" Insert="append">
    <Control Ident="MustNotBeAdded" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="A">
  <Usings>
    <Using Feature="Common/CompA" Contribution="Controls" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Form>`,
      expected: `
<Form Ident="A">
  <Controls>
    <Control Ident="Base" />
    <Control Ident="AddedByUsing" />
  </Controls>
</Form>`
    },
    {
      name: "commented-component-contribution-is-ignored",
      components: [
        {
          key: "Common/Legacy",
          text: `
<Component>
  <!--
  <Section Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="CommentedOutControl" />
  </Section>
  -->
  <Section Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="LegacyAdded" />
  </Section>
</Component>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Legacy" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Control Ident="LegacyAdded" />
  </Controls>
</Form>`
    },
    {
      name: "commented-using-is-ignored",
      components: [
        {
          key: "Common/Buttons/CloseButton",
          text: `
<Feature>
  <Contribution Name="Buttons" Root="Form" TargetXPath="//Form/Buttons" Insert="append">
    <Button Ident="CloseButton" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="A">
  <Usings>
    <!-- <Using Feature="Common/Buttons/CloseButton" /> -->
  </Usings>
  <Buttons>
    <Button Ident="BaseButton" />
  </Buttons>
</Form>`,
      expected: `
<Form Ident="A">
  <Buttons>
    <Button Ident="BaseButton" />
  </Buttons>
</Form>`
    },
    {
      name: "inherited-usings-are-applied-when-provided",
      components: [
        {
          key: "Common/Shared/FormOwned",
          text: `
<Feature>
  <Contribution Name="ControlShareCodes" Root="WorkFlow" TargetXPath="//WorkFlow/ControlShareCodes" Insert="append">
    <ControlShareCode Ident="InheritedControlShareCode_{{Suffix}}_{{FormIdent}}" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<WorkFlow FormIdent="Demo">
  <ControlShareCodes>
  </ControlShareCodes>
</WorkFlow>`,
      inheritedUsingsXml: `<Using Feature="Common/Shared/FormOwned" Suffix="FromInherited" />`,
      expected: `
<WorkFlow FormIdent="Demo">
  <ControlShareCodes>
    <ControlShareCode Ident="InheritedControlShareCode_FromInherited_Demo" />
  </ControlShareCodes>
</WorkFlow>`
    },
    {
      name: "insert-modes-prepend-before-after-append",
      components: [
        {
          key: "Common/Prepend",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="prepend"><Prepend /></Contribution></Feature>`
        },
        {
          key: "Common/Before",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="before"><Before /></Contribution></Feature>`
        },
        {
          key: "Common/After",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="after"><After /></Contribution></Feature>`
        },
        {
          key: "Common/Append",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="append"><Append /></Contribution></Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Prepend" />
    <Using Feature="Common/Before" />
    <Using Feature="Common/After" />
    <Using Feature="Common/Append" />
  </Usings>
  <Target>
    <Base />
  </Target>
</Form>`,
      expected: `
<Form>
  <Before />
  <Target>
    <Prepend />
    <Base />
    <Append />
  </Target>
  <After />
</Form>`
    },
    {
      name: "xpath-multiple-matches-use-first-by-default",
      components: [
        {
          key: "Common/MultiFirst",
          text: `
<Feature>
  <Contribution Name="S" Root="Form" TargetXPath="//Form/Controls | //Form/Buttons" Insert="append">
    <Inserted />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/MultiFirst" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Inserted />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expectedDebugLogs: ["[TargetXPath] '//Form/Controls | //Form/Buttons' matched 2 nodes; using first match only"]
    },
    {
      name: "xpath-multiple-matches-allow-multiple-inserts",
      components: [
        {
          key: "Common/MultiAll",
          text: `
<Feature>
  <Contribution Name="S" Root="Form" TargetXPath="//Form/Controls | //Form/Buttons" Insert="append" AllowMultipleInserts="true">
    <Inserted />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/MultiAll" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Inserted />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
    <Inserted />
  </Buttons>
</Form>`,
      expectedDebugLogs: ["[TargetXPath] '//Form/Controls | //Form/Buttons' matched 2 nodes; applying to all matches"]
    },
    {
      name: "include-with-contribution-and-params",
      components: [
        {
          key: "Lib/Renderable",
          text: `
<Feature>
  <Contribution Name="Main" Insert="placeholder" Root="Form">
    <Rendered Value="{{Custom}}" Form="{{FormIdent}}" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Feature="Lib/Renderable" Contribution="Main" Custom="X" />
  </Host>
</Form>`,
      expected: `
<Form Ident="REQ">
  <Host>
    <Rendered Value="X" Form="REQ" />
  </Host>
</Form>`
    },
    {
      name: "include-without-contribution-uses-feature-inner-content",
      components: [
        {
          key: "Lib/Whole",
          text: `
<Feature>
  <A />
  <B Attr="{{FormIdent}}" />
</Feature>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Feature="Lib/Whole" />
  </Host>
</Form>`,
      expected: `
<Form Ident="REQ">
  <Host>
    <A />
    <B Attr="REQ" />
  </Host>
</Form>`
    },
    {
      name: "nested-placeholders-and-param-propagation",
      components: [
        {
          key: "C/A",
          text: `
<Feature>
  <Contribution Name="Main" Insert="placeholder">
    <A>{{Feature:C/B,Contribution:Main,Nested:{{Value}}}}</A>
  </Contribution>
</Feature>`
        },
        {
          key: "C/B",
          text: `
<Feature>
  <Contribution Name="Main" Insert="placeholder">
    <B>{{Nested}}</B>
  </Contribution>
</Feature>`
        }
      ],
      template: `<Form><Usings><Using Feature="C/A" Contribution="Main" /><Using Feature="C/B" Contribution="Main" /></Usings>{{Feature:C/A,Contribution:Main,Value:42}}</Form>`,
      expected: `<Form><A><B>42</B></A></Form>`
    },
    {
      name: "unknown-component-placeholder-stays-unchanged",
      components: [],
      template: `<Form>{{Feature:Missing/Comp,Contribution:S}}</Form>`,
      expected: `<Form>{{Feature:Missing/Comp,Contribution:S}}</Form>`
    },
    {
      name: "placeholder-requires-active-using-namespace",
      components: [
        {
          key: "Common/Shared/Assign",
          text: `
<Feature>
  <Contribution Name="Html" Insert="placeholder" Root="Form">
    <Wrap>ShouldNotRenderWithoutUsing</Wrap>
  </Contribution>
</Feature>`
        }
      ],
      template: `<Form>{{Feature:Common/Shared/Assign,Contribution:Html}}</Form>`,
      expected: `<Form>{{Feature:Common/Shared/Assign,Contribution:Html}}</Form>`
    },
    {
      name: "sfp-component-root-template-is-preserved",
      components: [
        {
          key: "Shared/Sample",
          text: `
<Feature>
  <Contribution Name="Controls" Insert="append" TargetXPath="//Component/Controls" Root="Component">
    <Control Ident="Injected" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Component Ident="RuntimeComponent" xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
  <Usings>
    <Using Feature="Shared/Sample" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Component>`,
      expected: `
<Component Ident="RuntimeComponent" xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
  <Controls>
    <Control Ident="Base" />
    <Control Ident="Injected" />
  </Controls>
</Component>`
    },
    {
      name: "nested-sfp-component-inside-form-is-preserved",
      components: [
        {
          key: "Common/KnowledgeBase",
          text: `
<Feature>
  <Contribution Root="Form" Name="Component" TargetXPath="//Form/Components" Insert="append">
    <Component ComponentIdent="ITSMKnowledgeBaseComponent" Ident="ITSMKnowledgeBase">
      <KnowledgeBaseTree CountSectionIdent="KnowledgeBaseSection" Type="ArticleOnly" />
    </Component>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="ITSMInovation">
  <Usings>
    <Using Feature="Common/KnowledgeBase" />
  </Usings>
  <Components>
    <Component ComponentIdent="TimeLineComponent" Ident="TimeLine" />
  </Components>
</Form>`,
      expected: `
<Form Ident="ITSMInovation">
  <Components>
    <Component ComponentIdent="TimeLineComponent" Ident="TimeLine" />
    <Component ComponentIdent="ITSMKnowledgeBaseComponent" Ident="ITSMKnowledgeBase">
      <KnowledgeBaseTree CountSectionIdent="KnowledgeBaseSection" Type="ArticleOnly" />
    </Component>
  </Components>
</Form>`
    },
    {
      name: "using-placeholder-contributions-are-skipped-during-using-phase",
      components: [
        {
          key: "C/Place",
          text: `
<Feature>
  <Contribution Name="Html" Insert="placeholder" Root="Form">
    <Block>OK</Block>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="C/Place" Contribution="Html" />
  </Usings>
  <Host>{{Feature:C/Place,Contribution:Html}}</Host>
</Form>`,
      expected: `
<Form>
  <Host><Block>OK</Block></Host>
</Form>`
    },
    {
      name: "contribution-patch-append-slot-applies-and-slot-markers-are-removed",
      components: [
        {
          key: "Common/Shared/Resolve",
          text: `
<Feature>
  <Contribution Name="Html" Root="Form" TargetXPath="//Form/Host" Insert="append">
    <Card>
      <Row>Base</Row>
      <ContributionSlot Name="GeneralResolutionCard.Body.End" />
    </Card>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Shared/Resolve" Contribution="Html" />
  </Usings>
  <ContributionPatches>
    <ContributionPatch Feature="Common/Shared/Resolve" Contribution="Html">
      <AppendSlot Name="GeneralResolutionCard.Body.End">
        <Row>ReporterResponseDeadlineDateTime</Row>
      </AppendSlot>
    </ContributionPatch>
  </ContributionPatches>
  <Host></Host>
</Form>`,
      expected: `
<Form>
  <Host>
    <Card>
      <Row>Base</Row>
      <Row>ReporterResponseDeadlineDateTime</Row>
    </Card>
  </Host>
</Form>`
    },
    {
      name: "primitive-use-with-slot-and-params",
      components: [
        {
          key: "Common/Dialogs/ConfirmFormDialogSection",
          text: `
<Primitive>
  <Template Name="Dialog">
    <Section Root="Form" xsi:type="ConfirmFormDialogSection" Ident="{{DialogIdent}}" TitleResourceKey="{{TitleKey}}">
      <HTMLTemplate><![CDATA[
        {{Slot:Body}}
      ]]></HTMLTemplate>
    </Section>
  </Template>
</Primitive>`
        },
        {
          key: "Common/Snippets/ControlRow",
          text: `
<Primitive>
  <Template>
    <div class="row"><ControlLabel ControlID="{{ControlID}}" /><Control ID="{{ControlID}}" /></div>
  </Template>
</Primitive>`
        }
      ],
      template: `
<Form>
  <Sections>
    <UsePrimitive Name="Common/Dialogs/ConfirmFormDialogSection" Template="Dialog" DialogIdent="AssignDialogSection" TitleKey="AssignDialogTitle">
      <Slot Name="Body">
        <UsePrimitive Name="Common/Snippets/ControlRow" ControlID="DialogAssignedGroupID" />
      </Slot>
    </UsePrimitive>
  </Sections>
</Form>`,
      expected: `
<Form>
  <Sections>
    <Section Root="Form" xsi:type="ConfirmFormDialogSection" Ident="AssignDialogSection" TitleResourceKey="AssignDialogTitle">
      <HTMLTemplate><![CDATA[
        <div class="row"><ControlLabel ControlID="DialogAssignedGroupID" /><Control ID="DialogAssignedGroupID" /></div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Form>`
    },
    {
      name: "primitive-use-template-selection-and-default-slot-empty",
      components: [
        {
          key: "Common/Snippets/Badge",
          text: `
<Primitive>
  <Template Name="Short"><span>{{Text}}</span></Template>
  <Template Name="Long"><div class="badge">{{Text}} - {{Suffix}}</div>{{Slot:Extra}}</Template>
</Primitive>`
        }
      ],
      template: `
<Form>
  <Body>
    <UsePrimitive Primitive="Common/Snippets/Badge" Template="Short" Text="OK" />
    <UsePrimitive Primitive="Common/Snippets/Badge" Template="Long" Text="Warning" Suffix="ITSM" />
  </Body>
</Form>`,
      expected: `
<Form>
  <Body>
    <span>OK</span>
    <div class="badge">Warning - ITSM</div>
  </Body>
</Form>`
    },
    {
      name: "repeat-values-sugar-expands-inline",
      components: [],
      template: `
<Form>
  <Controls>
    <Repeat Param="Level" Values="2,3,4">
      <Control Ident="ITSMCategoryLevel{{Level}}Ident" />
    </Repeat>
  </Controls>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="ITSMCategoryLevel2Ident" />
    <Control Ident="ITSMCategoryLevel3Ident" />
    <Control Ident="ITSMCategoryLevel4Ident" />
  </Controls>
</Form>`
    },
    {
      name: "repeat-range-sugar-expands-inline",
      components: [],
      template: `
<Form>
  <Buttons>
    <Repeat Param="N" From="1" To="3">
      <Button Ident="Action{{N}}Button" />
    </Repeat>
  </Buttons>
</Form>`,
      expected: `
<Form>
  <Buttons>
    <Button Ident="Action1Button" />
    <Button Ident="Action2Button" />
    <Button Ident="Action3Button" />
  </Buttons>
</Form>`
    },
    {
      name: "if-sugar-equals-and-not-equals",
      components: [],
      template: `
<Form Ident="ITSMRequest">
  <Sections>
    <If Param="FormIdent" Equals="ITSMRequest">
      <Section Ident="FormSpecificSection" />
    </If>
    <If Param="FormIdent" NotEquals="ITSMRequest">
      <Section Ident="MustNotRender" />
    </If>
  </Sections>
</Form>`,
      expected: `
<Form Ident="ITSMRequest">
  <Sections>
    <Section Ident="FormSpecificSection" />
  </Sections>
</Form>`
    },
    {
      name: "case-sugar-selects-branch-and-default",
      components: [],
      template: `
<Form Ident="ITSMRequest">
  <Actions>
    <Case Param="Mode" Value="AssignToMe">
      <When Value="Assign">
        <Action Ident="AssignAction" />
      </When>
      <When Value="AssignToMe,AssignToMeMultipleGroup">
        <Action Ident="AssignToMeAction" />
      </When>
      <Default>
        <Action Ident="FallbackAction" />
      </Default>
    </Case>
    <Case Param="Mode" Value="UnknownMode">
      <When Value="Assign">
        <Action Ident="AssignAction2" />
      </When>
      <Default>
        <Action Ident="FallbackAction2" />
      </Default>
    </Case>
  </Actions>
</Form>`,
      expected: `
<Form Ident="ITSMRequest">
  <Actions>
    <Action Ident="AssignToMeAction" />
    <Action Ident="FallbackAction2" />
  </Actions>
</Form>`
    },
    {
      name: "repeat-case-combination",
      components: [],
      template: `
<Form>
  <Controls>
    <Repeat Param="Level" Values="2,3,4,5">
      <Case Value="{{Level}}">
        <When Value="2,3,4">
          <Control Ident="ITSMCategoryLevel{{Level}}Ident" />
        </When>
      </Case>
    </Repeat>
  </Controls>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="ITSMCategoryLevel2Ident" />
    <Control Ident="ITSMCategoryLevel3Ident" />
    <Control Ident="ITSMCategoryLevel4Ident" />
  </Controls>
</Form>`
    }
  ];

  let failures = 0;
  for (const c of cases) {
    try {
      const library = buildComponentLibrary(c.components);
      const debugLogs: string[] = [];
      const actual = renderTemplateText(
        c.template,
        library,
        c.maxDepth ?? 12,
        (line) => debugLogs.push(line),
        c.inheritedUsingsXml
      );
      assert.equal(normalize(actual), normalize(c.expected));
      if (c.expectedDebugLogs) {
        assert.deepEqual(debugLogs, c.expectedDebugLogs);
      }
      console.log(`PASS: ${c.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${c.name}`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      } else {
        console.error(`  ${String(error)}`);
      }
    }
  }

  runRefsTest();

  if (failures > 0) {
    throw new Error(`Template core tests failed (${failures} case(s)).`);
  }
  console.log(`Template core tests passed (${cases.length} cases + extractUsingComponentRefs).`);
}

function runRefsTest(): void {
  const input = `
<Form>
  <Usings>
    <Using Feature="Common\\Shared\\Assign.feature.xml" />
    <Using Name="Library/One.xml" />
    <!-- <Using Feature="Common/ShouldNotBeFound.xml" /> -->
  </Usings>
  <UsePrimitive Name="Common/Dialogs/ConfirmFormDialogSection.primitive.xml" />
  <!-- <UsePrimitive Name="Common/ShouldNotBeFoundPrimitive.xml" /> -->
  <Include Feature="Common/IncA.feature.xml" />
  <Include Name="Common/IncB.xml" />
  <!-- <Include Feature="Common/ShouldNotBeFoundInclude.xml" /> -->
  <X>{{Feature:Common/Two.xml,Contribution:S}}</X>
  <Y>{{Name:Common/Three.feature.xml,Contribution:S}}</Y>
  <!-- {{Feature:Common/ShouldNotBeFoundPlaceholder.xml,Contribution:S}} -->
</Form>`;
  const refs = extractUsingComponentRefs(input).sort((a, b) => a.localeCompare(b));
  const expected = [
    "Common/Dialogs/ConfirmFormDialogSection",
    "Common/IncA",
    "Common/IncB",
    "Common/Shared/Assign",
    "Common/Three",
    "Common/Two",
    "Library/One"
  ].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(refs, expected);
  console.log("PASS: extract-using-component-refs");
}

function normalize(value: string): string {
  let out = value.replace(/\r\n/g, "\n");
  out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  out = out.replace(/<\/?[\w:.-]+(?:\s+[^<>]*?)?\s*\/?>/g, (tag) => normalizeTag(tag));
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/>\s+</g, "><");
  out = out.trim();
  return out.trimEnd();
}

function normalizeTag(tag: string): string {
  if (tag.startsWith("<?") || tag.startsWith("<!") || tag.startsWith("<!--")) {
    return tag;
  }
  const isClosing = /^<\s*\//.test(tag);
  const isSelfClosing = /\/\s*>$/.test(tag);
  const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag);
  const name = nameMatch?.[1] ?? "";
  if (!name) {
    return tag;
  }
  if (isClosing) {
    return `</${name}>`;
  }
  const attrs: string[] = [];
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }
    if (typeof match[2] === "string") {
      attrs.push(`${key}="${match[2]}"`);
    } else {
      attrs.push(`${key}='${match[3] ?? ""}'`);
    }
  }
  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (isSelfClosing) {
    return `<${name}${attrText}/>`;
  }
  return `<${name}${attrText}>`;
}

run();
