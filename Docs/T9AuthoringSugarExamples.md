# T9 Authoring Sugar Examples

T9 pokryva jednoduche authoring sugar konstrukce:
- `Repeat`
- `If`
- `Case`
- `Primitive` + `UsePrimitive` (params + slots)

Builder je pri renderu rozepise do standardniho finalniho XML.

## Repeat

```xml
<Repeat Param="Level" Values="2,3,4,5">
  <Control Ident="ITSMCategoryLevel{{Level}}Ident" />
</Repeat>
```

Alternativne ciselny rozsah:

```xml
<Repeat Param="N" From="1" To="3">
  <Button Ident="Action{{N}}Button" />
</Repeat>
```

## If

```xml
<If Param="FormIdent" Equals="ITSMRequest">
  <Section Ident="RequestOnlySection" />
</If>
```

Podporovane atributy:
- `Equals`
- `NotEquals`
- `In` (CSV seznam)
- `IsEmpty`

Bez explicitni podminky se vyhodnocuje truthy/falsy hodnota parametru.

## Case

```xml
<Case Param="Mode">
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
```

`Case` vybira prvni odpovidajici `When`; pokud nic nesedi, pouzije `Default`.

## Primitive / UsePrimitive

Definice primitive:

```xml
<Primitive>
  <Template Name="Dialog">
    <Section Root="Form" xsi:type="ConfirmFormDialogSection" Ident="{{DialogIdent}}" TitleResourceKey="{{TitleKey}}">
      <HTMLTemplate><![CDATA[
        {{Slot:Body}}
      ]]></HTMLTemplate>
    </Section>
  </Template>
</Primitive>
```

Pouziti primitive:

```xml
<UsePrimitive Name="Common/Dialogs/ConfirmFormDialogSection" Template="Dialog" DialogIdent="AssignDialogSection" TitleKey="AssignDialogTitle">
  <Slot Name="Body">
    <UsePrimitive Name="Common/Snippets/ControlRow" ControlID="DialogAssignedGroupID" />
  </Slot>
</UsePrimitive>
```

Poznamky:
- primitive soubory lze umistit do `XML_Primitives`.
- slot placeholder ma tvar `{{Slot:Body}}`.
- params fungují stejne jako u feature placeholderu (`{{ParamName}}`).

## Poznamka k T11

Slozitejsi transformace (napr. lift opakovanych action sekvenci do `ActionShareCode`) zustavaji v `T11`.

## ContributionPatch / ContributionSlot

Pokud chceme rozsireni existujici contribution bez kopirovani cele feature, muzeme
v contribution definovat extension point pomoci `ContributionSlot`.

Priklad ve feature:

```xml
<Contribution Name="Html" Root="Form" TargetXPath="//Form/Controls" Insert="append">
  <Control ID="GeneralResolutionCardPlaceHolder">
    <div class="card-body">
      <div class="row"><div class="col-md-12"><Control ID="SolutionDescription" /></div></div>
      <ContributionSlot Name="GeneralResolutionCard.Body.End" />
    </div>
  </Control>
</Contribution>
```

Priklad v template:

```xml
<Usings>
  <Using Feature="Common/Shared/Resolve" Contribution="Html" />
</Usings>

<ContributionPatches>
  <ContributionPatch Feature="Common/Shared/Resolve" Contribution="Html">
    <AppendSlot Name="GeneralResolutionCard.Body.End">
      <div class="row">
        <div class="col-md-12">
          <div class="form-group">
            <ControlLabel ControlID="ReporterResponseDeadlineDateTime" />
            <Control ID="ReporterResponseDeadlineDateTime" />
          </div>
        </div>
      </div>
    </AppendSlot>
  </ContributionPatch>
</ContributionPatches>
```

Poznamky:
- aktualne je podporovana operace `AppendSlot`.
- `ContributionSlot` je pouze build-time marker; ve finalnim XML se necha jen jeho obsah.
- patch je cileny na `Feature/Component` + konkretni `Contribution`.
