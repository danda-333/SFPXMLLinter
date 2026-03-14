# Implementation Plan: SFP Feature Templating v2

Posledni aktualizace: `2026-03-14`

## Cil
Posunout soucasny XML template builder od prostych `Using` insertu k feature-oriented systemu, ktery:

- zachova XML jako hlavni authoring format,
- zjednodusi skladani business feature napric `Form`, `WorkFlow`, `DataView` a `View`,
- snizi riziko nekompletnich nebo rozbitych feature,
- zpruhledni finalni dopad builderu v editoru,
- vytvori zaklad pro dalsi ergonomicka rozsireni a programovatelne generovani.

## Aktualni stav implementace
### Hotovo
- novy authoring naming:
  - `Feature`
  - `Contribution`
  - `*.feature.xml`
- docasna legacy podpora:
  - `Component`
  - `Section`
  - `*.component.xml`
- XML-first composition fixtures pro pilot feature `Assign`
- auto-manifest builder z XML:
  - pokud `*.feature.json` neexistuje, manifest se postavi z `Feature/Contribution` XML
- podpora metadata primo v XML:
  - top-level `Manifest`
  - centralni `ContributionContract`
  - inline metadata primo na `Contribution`
- aktivni model kontraktu:
  - `provides`
  - `expects`
  - `expectsXPath`
  - `requires`
- `FeatureRegistryStore`
- capability report
- builder/extension composition output channel
- prvni feature-aware diagnostiky:
  - `unknown-feature-requirement`
  - `missing-feature-expectation`
  - `missing-feature-expected-xpath`
- prvni `Using impact analysis` nad beznymi XML soubory:
  - `unused-using`
  - `partial-using`
- Tree View + diagnostics jsou sjednocene nad stejnym indexem:
  - strict index-only cteni bez fallback parseru v Tree View a beznych diagnostics
  - insert-based vyhodnoceni `unused/partial/effective` pro `Using`
  - insert count je indexovana metrika (`placeholder`, `TargetXPath` + clamp, fallback symbol count)
- jednotny `DocumentCompositionModel` pro bezne XML:
  - sdilena mezivrstva pro `Using` impact + contribution detail
  - sdilene cteni pro validator i Tree View
  - sjednocene agregace injected symbolu (`Controls/Buttons/Sections/ShareCodes`)
- sjednoceny vypocet insert trace:
  - indexer, runtime diagnostics, Tree View i fixture runner pouzivaji stejnou implementaci
- snapshot testy nad document composition modelem:
  - `runDocumentCompositionModelTests`
  - kontrola `usings`, impactu, filtered contribution a injected symbolu
- Tree View navigace a debug ergonomie:
  - source navigation pres inline tlacitka
  - `Open` s konfigurovatelnym modem (`newTab`, `current`, `side`, `sidePreview`, `peek`)
  - `Side Preview` bez ztraty focusu (`preserveFocus`)
  - `Using` strom: root-relevant contribution + `Filtered`
  - detailni `Meta` + placeholder usage lokace
- primitive ergonomie v editoru:
  - quick-fix akce pro primitive diagnostiky:
    - `unknown-primitive` (create/open primitive source)
    - `primitive-missing-slot` (doplnit `Slot`)
    - `primitive-missing-param` (doplnit chybejici parametr)
    - `primitive-cycle` (rychle odstraneni cyklickeho `UsePrimitive`)
- Tree View primitive contracts:
  - detail `required/provided/missing` pro params a slots
  - data jdou z indexu (bez extra fallback parseru v Tree View)
- linter-performance fixture rozsireno o primitive-heavy scenar:
  - nova sada primitive souboru + template/workflow usage scenar
  - scenar drzi startup threshold do 2 s
- primitive fallback debug snapshot testy:
  - snapshot fixture + test runner validuje fallback debug logy deterministicky

### Prave probiha
- dokonceni `effective composition model` jako jednotneho zdroje i pro builder/debug vrstvu
  - odstranit zbytkove duplikace mezi build debug a composition modelem
- doplnovani dalsich inference pravidel nad `Assign`
- priprava form-owned inheritance vrstvy nad stabilizovanym modelem

### Zatim pred nami
- form-owned inheritance
- hlubsi Tree View navigace:
  - quick actions
  - statistiky
- hlubsi Using impact analysis
- ordering model
- authoring sugar vrstvy
- final output quality nad novym feature systemem
- programovatelne generovani uvnitr feature

## Hlavni principy
1. Zachovat XML komponenty jako hlavni authoring mechanizmus.
2. Drzet komponenty a jejich kategorizaci feature-oriented, ne ciste technicky.
3. Source of truth pro aktivni feature bude primarne `Form`.
4. Naming zavadet manualne, ne generovat automaticky.
5. Builder musi byt citelny, debugovatelný a predvidatelny.
6. Slozite intra-feature patterny resit pozdeji pres `JS/TS` build-time evaluaci, ne novym pseudojazykem.

## Schvalena rozhodnuti
1. Mega-komponenty rozkladat uvnitr feature, ne globalne na `Controls/Buttons/WorkFlow/Views`.
2. `WorkFlow` a `DataView` maji umet sdilet aktivni feature set z formulare.
3. Pro editor chceme primarne vlastni `Tree View`, inline preview zatim ne.
4. Finalni build XML ma umet volitelne projit internim formatterem.
5. Builder ma mit vlastni output/debug channel.
6. Provenance markery ve finalnim XML budou jen jako volitelna feature a musi byt context-aware.
7. Konflikty se muzou deterministicky vyresit prvnim moznym zpusobem, ale musi se reportovat do `Tree View` a output channelu.
8. Builder ma mit oddelene rezimy `fast`, `debug`, `release`.
9. `*.feature.json` zustava podporovany, ale pokud neexistuje, system ma umet postavit zakladni manifest automaticky z templating XML.
10. Novy authoring naming je:
   - `Feature`
   - `Contribution`
   - `*.feature.xml`
   Legacy `Component` / `Section` / `*.component.xml` zustava docasne podporovany.

## Rozsah v1
- Feature-oriented struktura komponent.
- Feature manifest a dependency model.
- Jednotny `effective composition model` jako sdilena mezivrstva.
- Form-owned feature inheritance pro `WorkFlow` a `DataView`.
- Builder debug output a capability report.
- Tree View nad finalnim slozenym modelem.
- Zakladni ordering model pro insertovane casti.
- Ergonomicke authoring sugar vrstvy, ktere se pri buildu rozpoji do standardniho SFP XML.

## Mimo rozsah v1
- Automaticke generovani naming konvenci.
- Plne automaticke deduplikovani stejnych action sekvenci.
- Plna transformace existujiciho XML modelu (`modify/merge/delete` nad zakladnim XML).
- `JS/TS` generatory a programove definovane komponenty.
- Inline preview primo v editoru.

## Cílovy koncept
### 1. Feature-oriented skladani
Kazda business feature ma jeden hlavni vstupni bod a muze byt rozdelena na mensi casti:

```text
Common/
  Features/
    Assign/
      Assign.feature.xml
      Assign.Form.feature.xml
      Assign.WorkFlow.feature.xml
      Assign.View.feature.xml
```

Hlavni feature root sklada vsechny souvisejici casti dohromady, ale feature zustava dohledatelna jako jeden celek.

### 2. Tri vrstvy reuse
- `Primitive`
  - maly sdileny XML fragment, idealne bez plneho `Using`
- `Subcomponent`
  - mensi cast feature
- `Feature component`
  - business feature jako celek

### 3. Feature contracts
Feature bude umet deklarovat:
- co poskytuje (`provides`),
- co contribution ocekava (`expects`),
- jaky presny cil musi ve slozenem XML existovat (`expectsXPath`),
- na cem zavisi (`requires`),
- z jakych casti se sklada (`parts`).

### 4. Form-owned feature model
`Form` je vlastnik aktivnich feature. `WorkFlow` a `DataView` mohou:
- feature zdedit z formulare,
- lokalne je rozsirit,
- lokalne nektere prebit.

## Implementacni faze
### Faze T1: Stabilizace domenoveho modelu `[HOTOVO]`
Cil:
- z notes udelat explicitni datovy model, nad kterym pujde builder i editor.

Vystupy:
- navrh feature manifestu,
- navrh `provides / expects / expectsXPath / requires / parts`,
- navrh capability reportu,
- navrh ordering modelu,
- navrh builder modes,
- navrh dokumentace k feature manifestum a composition modelu,
- navrh bootstrap generatoru pro vytvoreni zakladniho `*.feature.json`,
- navrh precedence modelu:
  - explicitni JSON manifest
  - auto-manifest z XML
  - pripadny budouci merge model XML + JSON override.

Poznamky:
- v teto fazi jeste bez integrace do buildu,
- cilem je mit stabilni kontrakty.

Definition of Done:
- je popsany format feature manifestu,
- je popsany format capability reportu,
- je rozhodnuto, jaka metadata pocitame automaticky a jaka se deklaruji rucne,
- je popsano, jak manifest autorovat a jaky minimalni bootstrap umi generator vytvorit,
- je rozhodnuto, co se deje kdyz `*.feature.json` chybi.

### Faze T2: Feature manifest + dependency validator `[HOTOVO]`
Cil:
- zavadet feature contracts a zacit hlidat nekompletni nebo rozbite feature.

Implementace:
- nacitani feature manifestu,
- fallback auto-manifest builder z templating XML, pokud `*.feature.json` neexistuje,
- bootstrap generator `*.feature.json`, ktery z existujicich casti vytvori zakladni strukturu a predvyplni `provides`,
- dokumentace s priklady:
  - kdy pouzit `provides`,
  - kdy pouzit `expects`,
  - kdy pouzit `requires`,
  - kdy pouzit `expects`,
  - kdy pouzit `expectsXPath`,
  - jak delit feature na `parts`,
  - kdy staci auto-manifest a kdy ma smysl dopsat rucni JSON,
- automaticka extrakce `provides` a casti `requires` z XML,
- slouceni s rucne deklarovanymi semantickymi zavislostmi,
- nove diagnostiky:
  - `missing-feature-dependency`
  - `missing-feature-expectation`
  - `incomplete-feature`
  - `duplicate-feature-provider`
  - `orphan-feature-part`

Definition of Done:
- validace umi nahlasit nekompletni feature,
- pilot feature ma funkcni manifest a regression testy,
- existuje pouzitelna dokumentace a bootstrap generator pro zalozeni nove feature,
- feature bez JSON manifestu umi fungovat aspon v auto-manifest rezimu.

Aktualni stav:
- XML-first auto-manifest rezim je hotovy
- pilot `Assign` je hotovy
- feature-aware diagnostiky jsou rozsirene:
  - `missing-feature-dependency`
  - `duplicate-feature-provider`
  - `orphan-feature-part`
  - `incomplete-feature`
- bootstrap generator je hotovy (`SFP XML Linter: Generate Feature Manifest Bootstrap`)
- uzivatelska dokumentace manifest authoringu je hotova (`Docs/FeatureManifestAuthoring.md`)

Doporuceny pilot:
- `Assign`

### Faze T3: Form-owned feature inheritance `[HOTOVO]`
Cil:
- odstranit nutnost duplikovat `Using` napric `Form`, `WorkFlow`, `DataView`.

Implementace:
- `Form` bude zdroj aktivnich feature,
- `WorkFlow` a `DataView` budou umet feature dediti,
- moznost lokalnich override a doplneni,
- nove diagnostiky:
  - `workflow-missing-form-feature`
  - `workflow-redundant-feature-using`
  - `dataview-redundant-feature-using`
  - `feature-inheritance-override`

Definition of Done:
- feature aktivni na formulari se promita i do odpovidajiciho `WorkFlow` a `DataView`,
- redundantni a chybejici deklarace jsou viditelne v diagnostice.

Aktualni stav:
- inheritance je aktivni:
  - `WorkFlow`/`DataView` sdili feature z `Form` pres effective using vrstvu
- redundantni using diagnostiky jsou hotove:
  - `workflow-redundant-feature-using`
  - `dataview-redundant-feature-using`
- override diagnostika je hotova:
  - `feature-inheritance-override`
- inheritance je zohlednen i v Tree View (`Using` source local/inherited)
- inheritance suppression je hotove:
  - `Using` umi `SuppressInheritance="true"` (alternativne `Inherit="false"`)
  - suppression zablokuje dedeni odpovidajici feature/contribution z `Form`
  - suppression-only `Using` negeneruje redundant/override diagnostiky

### Faze T4: Effective composition model `[HOTOVO]`
Cil:
- zavest jednotnou mezivrstvu, nad kterou budou stavet builder, validator, reference a editor tooling.

Implementace:
- navrhnout a implementovat interni model, ktery reprezentuje:
  - local deklarace,
  - injektovane casti z feature / komponent,
  - zdedene casti,
  - `provided / applied / consumed / unused`,
  - ordering metadata,
  - puvod kazde vlozene casti,
  - capability report jako odvozeny vystup,
- sjednotit cteni tohoto modelu pro:
  - validator,
  - definition/reference providery,
  - builder debug output,
  - Tree View.

Definition of Done:
- existuje jedna sdilena mezivrstva pro finalni slozeny model,
- nove funkcionality uz se nepridavaji prime do parseru faktu a ad-hoc validaci,
- validator a editor cteji stejny slozeny stav.

Aktualni stav:
- datovy model je zaveden
- registry uz drzi `effectiveModelsByFeature`
- feature validace uz pouziva effective model pro `expects` a `expectsXPath`
- model uz nese i prvni usage stavy `provided / applied / consumed / unused`
- model uz napaji contribution-level a `Using` impact diagnostiky
- `Using` status je sjednoceny na insert-based metrice (`unused/partial/effective`)
- Tree View i diagnostics jedou v beznem rezimu strict index-only (bez fallback parseru)
- novy `DocumentCompositionModel` je zaveden jako sdilena mezivrstva pro bezne XML:
  - validator `Using` impact cte tento model
  - Tree View `Using` + injected symbol agregace ctou tento model
- workflow diagnostiky a resolvovani control identu ctou stejny model:
  - reference validace (`FormControl`, `ButtonShareCode`, `ControlShareCode`) uz jede pres contribution-level vyber + inheritance
  - odpadla ad-hoc agregace symbolu pouze z raw `Using` seznamu
- provider vrstva je dal sjednocena na stejnem modelu:
  - `DefinitionProvider` workflow resolution (controls/buttons/sections/share codes)
  - `ReferencesProvider` workflow target resolution
  - `ReferencesProvider` component declaration usage (`control/button/section`) je contribution-aware podle effective usage map
  - `CompletionProvider` workflow ident/share code completion + `SuppressInheritance`/`Inherit` value completion
  - `RenameProvider` workflow target resolution
  - `DefinitionProvider` + `CompletionProvider` mapping edge-cases ve workflow (`FromIdent`/`ToIdent`) ctou modelovou injected vrstvu
  - `DefinitionProvider` + `CompletionProvider` mapovani cte `rootFormIdent` fallback i mimo workflow-only vetve
- index usage mapy pouzivaji effective using vrstvu:
  - `componentUsageFormIdentsByKey`
  - `componentContributionUsageFormIdentsByKey`
- pridana diagnostika konfliktu:
  - `suppression-conflict`
- pridana diagnostika neucinneho potlaceni dedeni:
  - `suppression-noop`
- Tree View ma suppression debug vrstvu:
  - suppression `Using` uzly se zobrazuji v sekci `Usings`
  - zobrazuje se pocet potlacenych inherited contribution
- quick-fix vrstva podporuje suppression diagnostiky:
  - `suppression-conflict`: remove conflicting using / remove suppression attribute
  - `suppression-noop`: remove suppression attribute / remove no-op using
- pridany samostatny index usage test:
  - `runWorkspaceIndexerUsageTests` overuje `componentUsageFormIdentsByKey` a `componentContributionUsageFormIdentsByKey` nad effective using scenari
- fixture composition testy overuji stabilitu modelu
- dalsi krok:
  - navazujici rozsireni (ordering/debug detaily) resit v T8/T5 nad stejnou mezivrstvou

### Faze T5: Builder observability `[HOTOVO]`
Cil:
- builder musi byt sam o sobe debugovatelný, i bez validatoru.

Implementace:
- samostatny builder output channel,
- logovani:
  - aktualne buildeneho souboru,
  - aktivnich `Using` a `Include`,
  - insertu bez efektu,
  - nenalezenych nebo vice-match `TargetXPath`,
  - partial feature application,
  - ordering rozhodnuti,
  - warnings / recoveries,
- capability report jako strukturovany mezivystup.

Definition of Done:
- pri problemu jde z outputu zjistit, proc se cast vlozila nebo nevlozila,
- builder umi prepnout chovani dle modu `fast/debug/release`.

Aktualni stav:
- existuje samostatny composition output channel
- loguje se registry rebuild a composition issues
- build pipeline loguje composition snapshot nad stejnym `DocumentCompositionModel`:
  - per-template status `effective/partial/unused`
  - detail non-effective usingu (`successful/relevant`)
  - souhrn za build run + pocet `TargetXPath` debug udalosti
- builder modes jsou hotove:
  - `fast` (minimalni overhead)
  - `debug` (detailni composition snapshot)
  - `release` (jen high-level vystup)
- navazujici rozsirovani:
  - ordering/debug detail je dalsi rozsireni nad hotovou observability vrstvou

### Faze T6: Tree View nad finalnim modelem `[HOTOVO]`
Cil:
- v editoru videt, co na finalnim formulari a workflow realne existuje.

Implementace:
- vlastni VS Code Tree View,
- strom nad finalnim slozenym modelem:
  - `Controls`
  - `Buttons`
  - `Sections`
  - `ActionShareCodes`
  - `ButtonShareCodes`
  - `ControlShareCodes`
- oznaceni local vs injected puvodu,
- statistiky a rychle akce,
- report konfliktu a partial/unused feature dopadu.

Napojeni:
- `Docs/xml-root-models.json`

Definition of Done:
- z otevreneho souboru je mozne zobrazit finalni model,
- u kazde polozky je dohledatelny puvod,
- panel umi zobrazit i warnings a quick actions.

Aktualni stav:
- existuje vlastni `SFP Composition` Tree View
- umi zobrazit feature soubory a contribution usage
- umi zobrazit bezna `Form` / `WorkFlow` XML:
  - summary
  - local vs injected `Controls`
  - local vs injected `Buttons`
  - local vs injected `Sections`
  - local vs injected workflow sharecody
  - `Using` impact
- umi source navigation a usage navigation pres inline tlacitka
- umi open mody pro debug (`newTab/current/side/sidePreview/peek`)
- cte `Using` i injected symboly ze sdileneho `DocumentCompositionModel`
- samostatna UX vrstva pro statistiky a quick actions:
  - `Statistics` sekce (impact/inserts/trace coverage)
  - `Copy Summary`
  - `Log Non-effective Usings`

### Faze T7: Using impact analysis `[HOTOVO]`
Cil:
- zviditelnit, ktere `Using` maji realny dopad a ktere jsou zbytecne.

Implementace:
- rozliseni stavu:
  - `provided`
  - `applied`
  - `consumed`
  - `unused`
- vyhodnoceni pro `Using`:
  - `unused using`
  - `partial using`
  - `effective using`
- vystup do:
  - Tree View
  - builder output channel
  - vybrane diagnostiky pro silne signaly

Definition of Done:
- je videt, kdy `Using` nic realne nepridava,
- je videt, kdy feature neco pridala, ale vysledek neni nikde spotrebovan.

Aktualni stav:
- hotove diagnostiky:
  - `unused-using`
  - `partial-using`
- status je nove insert-based nad indexovanymi insert county contribution
- `Using` impact je videt i v `Tree View`
- stejny evaluator impactu pouzivaji:
  - indexer
  - runtime diagnostics
  - Tree View
  - linter fixture runner
- builder/debug vrstva expose detailni contribution insert trace:
  - `insert`, `strategy`, `placeholder`, `xpath`, `clamp`, `fallback` pro non-effective usingy v `debug` modu

### Faze T8: Ordering model
Cil:
- oddelit aktivaci feature od poradi jejich vyslednych insertu.

Implementace:
- ordering metadata na urovni casti feature, ne celeho `Using`,
- hrube trideni pres `OrderGroup`,
- jemne vazby pres `Before` / `After`,
- validator pro:
  - missing anchor
  - cyclic ordering
  - unresolved ordering
  - conflicting ordering rules

Definition of Done:
- lze ridit poradi nezavisle pro `Form`, `WorkFlow`, `DataView`,
- poradi uz neni zavisle jen na poradi `Using`.

Aktualni stav:
- ordering metadata (`OrderGroup`/`Before`/`After`) je napojena v effective modelu na urovni part
- ordering validator hlasi:
  - missing anchor
  - conflicting ordering relations
  - ordering cycles
- diagnostika `ordering-conflict` je aktivni pro feature entrypoint
- Tree View zobrazuje ordering debug u partu (`Ordering` sekce + konflikty)
- composition testy pokryvaji ordering conflict/cycle scenare

### Faze T9: Authoring ergonomie
Cil:
- zkratit opakujici se XML patterny a zjednodusit zapis bez rozbiti finalniho SFP XML modelu.

Implementace:
- komponenta v komponente,
- lehke `Primitive` bez tezkeho `Using`,
- inline sugar pro sdilene struktury:
  - napr. inline `ConfirmFormDialog` pod `Button`,
- `Repeat` pro jednoduche opakovani bloku,
- `If` pro podminene vlozeni bloku,
- `Case` pro jednoduchy branch vyber jedne vetve,
- canonical rewrite:
  - sugar zapis -> standardni finalni SFP XML,
- zachovani standardniho finalniho XML po buildu.

Definition of Done:
- authoring je kratsi a citelnejsi,
- sugar konstrukce jsou deterministicke a snadno debugovatelne,
- finalni XML zustava kompatibilni se stavajicim SFP modelem.

### Faze T10: Final output quality
Cil:
- finalni build musi byt citelny a dohledatelny.

Implementace:
- volitelny post-build format pres interni formatter,
- volitelne provenance markery:
  - `off`
  - `compact`
  - `full`
- context-aware omezeni pro:
  - `SQL`
  - `Command`
  - `HTMLTemplate`
  - `CDATA`

Definition of Done:
- finalni XML je citelnejsi,
- debug build muze volitelne ukazovat puvod vlozenych casti bez rozbiti specialnich bloku.

### Faze T11: Programovatelne generovani uvnitr feature
Cil:
- resit slozite intra-feature patterny bez noveho pseudojazyka.

Implementace:
- build-time `JS/TS` generatory pro opakujici se patterny,
- explicitni lift opakovanych action sekvenci do `ActionShareCode`,
- bez side effectu,
- s jasnym vstupem a vystupem,
- cilene hlavne pro feature typu `FolderGroupSegment`.

Definition of Done:
- slozite opakujici se bloky lze generovat programove,
- opakovane action sekvence umi byt liftovany do sdilenych `ActionShareCode` bez manualniho copy/paste,
- XML templating zustava pro bezne skladani.

Poznamka:
- tato faze je planovana az po stabilizaci feature modelu a builder observability.

## Testovaci strategie
### 1. Feature fixture testy
- male, cilene testy na jednotlive feature,
- kontrola `provides / expects / requires`,
- kontrola partial / broken feature scenaru.

### 2. Primitive a authoring sugar testy
- testy pro primitive reuse,
- testy pro komponentu v komponente,
- testy pro inline -> canonical XML rewrite.

### 3. Builder debug testy
- testy capability reportu,
- testy builder output rezimu,
- testy konfliktu a ordering rozhodnuti.

### 4. End-to-end fixture testy
- realne priklady nad `SFPExampleProject`,
- kontrola parity finalniho buildu,
- kontrola Tree View modelu.

## Rizika a mitigace
1. Prilis rychly rust komplexity builderu
- Mitigace:
  - builder modes,
  - capability report,
  - samostatny output channel,
  - phased rollout.

2. Feature manifests budou duplicitni k XML
- Mitigace:
  - automaticky dopoctit maximum z XML,
  - manualne deklarovat jen semanticke zavislosti.

3. Tree View bude nepresny oproti realnemu buildu
- Mitigace:
  - stavet Tree View nad tim samym effective composition modelem jako builder,
  - ne nad nezavislou aproximaci.

4. Ergonomicke sugar vrstvy rozbiji finalni SFP XML
- Mitigace:
  - sugar brat jen jako authoring vrstvu,
  - canonical finalni XML generovat explicitnim rewrite krokem.

5. `JS/TS` generatory se rozrostou do neriaditelneho skriptovani
- Mitigace:
  - zavest je az pozdeji,
  - build-time only,
  - side-effect free kontrakt,
  - male, testovane vstupy a vystupy.

## Doporucene poradi realizace
1. `T1` Stabilizace domenoveho modelu
2. `T2` Feature manifest + dependency validator
3. `T4` Effective composition model
4. `T3` Form-owned feature inheritance
5. `T5` Builder observability
6. `T7` Using impact analysis
7. `T6` Tree View
8. `T8` Ordering model
9. `T9` Authoring ergonomie
10. `T10` Final output quality
11. `T11` Programovatelne generovani

## Milestones
### Milestone M1: Feature contracts foundation
Stav:
- `[HOTOVO]`

Obsah:
- `T1` Stabilizace domenoveho modelu

Vystup:
- finalni navrh feature manifestu,
- finalni navrh capability reportu,
- finalni navrh builder modes,
- rozhodnuti co se pocita automaticky a co rucne,
- osnovy dokumentace pro authoring feature manifestu,
- navrh bootstrap generatoru.

Test checkpoint:
- zde jeste neimplementujeme runtime funkcionalitu,
- probehne design review nad jednim pilotem:
  - `Assign`
- overime, ze navrzeny model umi popsat:
  - controls
  - buttons
  - sharecody
  - workflow vazby
  - zavislosti na jinych feature

Smysl testu:
- zachytit spatny navrh kontraktu driv, nez se rozleze do builderu a editoru.

Gate pro dalsi milestone:
- manifest i capability report umi bez hacku popsat aspon jednu realnou feature end-to-end.

### Milestone M2: Dependency-safe features
Stav:
- `[HOTOVO]`

Obsah:
- `T2` Feature manifest + dependency validator

Vystup:
- prvni implementace feature manifests,
- nove diagnostiky pro nekompletni nebo rozbite feature,
- regression fixture testy pro pilot feature,
- prvni verze dokumentace s priklady,
- prvni verze bootstrap generatoru `*.feature.json`.

Test checkpoint:
- male fixture testy nad zamerne rozbitou a kompletni feature,
- regression testy nad `Assign`,
- smoke test bootstrap generatoru nad realnou feature komponentou,
- manualni overeni v editoru:
  - feature kompletni
  - chybi workflow cast
  - chybi pozadovany dependency
  - existuje duplicate provider

Smysl testu:
- overit, ze validace hlida skutecne problemy feature a negeneruje sum.

Gate pro dalsi milestone:
- pilot feature ma stabilni manifest a validace umi zachytit hlavni tridy nekompletnosti,
- nova feature jde zalozit pomoci generatoru a dopsat podle dokumentace bez studia implementace.

Gate splnen:
- bootstrap generator existuje a je pokryty testem (`runCompositionBootstrapTests`)
- dokumentace manifest authoringu je doplnena
- semanticke diagnostiky pokryvaji dependency/provider/incomplete/orphan scenare

### Milestone M3: Form-owned inheritance
Stav:
- `[HOTOVO]`

Obsah:
- `T3` Form-owned feature inheritance

Vystup:
- `WorkFlow` a `DataView` umi zdedit feature z formulare,
- existuji override scenare a diagnostiky redundantnich/chybejicich deklaraci.

Test checkpoint:
- fixture testy pro:
  - dedeni `Form -> WorkFlow`
  - dedeni `Form -> DataView`
  - redundantni `Using`
  - lokalni override
- end-to-end test na realnem formulari s vice XML soubory.

Smysl testu:
- tohle je prvni zmena, ktera ovlivni authoring ve vetsim meritku, proto je potreba ji overit driv, nez pridame dalsi ergonomii.

Gate pro dalsi milestone:
- feature set je dohledatelny z formulare a nevyzaduje duplicitni zapis napric XML.

Aktualne hotovo:
- dedeni feature z `Form` do `WorkFlow`/`DataView` je aktivni pres effective using vrstvu
- redundantni using diagnostiky:
  - `workflow-redundant-feature-using`
  - `dataview-redundant-feature-using`

Aktualne hotovo navic:
- formalni override diagnostika (`feature-inheritance-override`) je aktivni
- inheritance suppression (zamerne potlaceni dedeni) je aktivni:
  - `SuppressInheritance="true"` / `Inherit="false"`
  - coverage v composition + linter fixture testech

### Milestone M4: Effective composition model
Stav:
- `[HOTOVO]`

Obsah:
- `T4` Effective composition model

Vystup:
- jednotny mezimodel finalniho slozeni,
- sdilena reprezentace local / injected / inherited prvku,
- sdilene cteni modelu pro validator a editor.

Test checkpoint:
- regression testy nad pilot feature, ze:
  - validator i definition provider vraci stejny vysledek nad shodnym dokumentem,
  - model obsahuje local i injected casti,
  - model korektne nese metadata o puvodu,
- technicky smoke test, ze nove funkcionality uz ctou tuto mezivrstvu misto ad-hoc reseni.

Smysl testu:
- tohle je architektonicky zlomovy bod; pokud nebude stabilni, dalsi funkce se zacnou znovu vetvit do paralelnich implementaci.

Gate pro dalsi milestone:
- nove funkcionality lze stavet nad jednim sdilenym slozenym modelem.

Aktualne hotovo:
- model typove existuje
- registry ho sestavuje
- validator ho uz pouziva pro prvni feature kontrakty
- usage vrstva je rozbehnuta na pilot feature
- `Using` status (`unused/partial/effective`) je sjednoceny nad indexovanou insert metrikou
- Tree View i bezne diagnostics jedou strict index-only (bez fallback parseru)
- zaveden `DocumentCompositionModel` pro bezne XML
- validator i Tree View cteji `Using` impact z jednotneho modelu
- injected symbol agregace v Tree View cte jednotny model
- workflow reference validace i workflow control-id resolution ctou jednotny model (vcetne inheritance)
- `DefinitionProvider`, `ReferencesProvider` a `CompletionProvider` workflow vetve ctou jednotny model
- `RenameProvider` workflow vetve ctou jednotny model
- `ReferencesProvider` component declaration references (`control/button/section`) pouzivaji contribution-level effective usage mapu
- index usage mapy jsou plnene z effective using vrstvy (ne raw `Using` listu)
- pridano pravidlo `suppression-conflict` + fixture coverage
- pridano pravidlo `suppression-noop` + fixture coverage
- workflow mapping edge-cases (`FromIdent`/`ToIdent`) v provider vrstvach cte modelovou injected vrstvu
- Tree View `Usings` obsahuje i suppression debug uzly
- quick-fix kodove akce pokryvaji `suppression-conflict` a `suppression-noop`
- pridany test runner `runWorkspaceIndexerUsageTests` + fixture `tests/fixtures/indexer-usage`
- pridany snapshot test `runDocumentCompositionModelTests`

Gate splnen:
- validator + provider vrstva ctou jednotnou mezivrstvu pro finalni skladani
- editorove cesty maji sjednocene source-of-truth nad composition/index modelem

### Milestone M5: Builder observability
Stav:
- `[HOTOVO]`

Obsah:
- `T5` Builder observability

Vystup:
- builder output channel,
- capability report,
- builder modes `fast/debug/release`.

Test checkpoint:
- testy builder outputu a capability reportu,
- manualni debug session nad rozbitou feature,
- overeni, ze z outputu jde dohledat:
  - proc se cast vlozila
  - proc se cast nevlozila
  - proc `TargetXPath` selhal nebo matchnul vicekrat

Smysl testu:
- nez pridame Tree View a dalsi editorovou vrstvu, builder musi byt sam o sobe diagnostikovatelny.

Gate pro dalsi milestone:
- builder output realne pomaha debugovat build bez nutnosti zasahovat do kodu.

Aktualne hotovo:
- build output je napojeny na `DocumentCompositionModel`
- po buildu se loguje per-template composition snapshot:
  - `effective/partial/unused`
  - non-effective detail (`successful/relevant`)
  - sumarizace runu + `TargetXPath` debug count

Aktualne hotovo navic:
- builder modes `fast/debug/release` jsou aktivni a napojene v settings + build pipeline

Navazujici tema mimo gate:
- ordering/debug detail nad stejnou composition vrstvou je dalsi rozsireni

### Milestone M6: Tree View MVP
Stav:
- `[HOTOVO]`
Obsah:
- `T6` Tree View nad finalnim modelem

Vystup:
- Tree View pro finalni slozeny model,
- local vs injected puvod,
- statistiky a quick actions.

Test checkpoint:
- manualni UX testy nad nekolika velkymi formulary,
- porovnani Tree View s finalnim build outputem,
- regression testy nad mezimodelem, ze Tree View cte stejna data jako builder.

Smysl testu:
- Tree View ma byt duveryhodny pohled na finalni model, ne jen priblizna pomucka.

Gate pro dalsi milestone:
- z Tree View je mozne bez buildu rucne dohledat hlavni controls/buttons/sharecody a jejich puvod.

Aktualne hotovo:
- feature panel a contribution usage
- bezny XML panel se skupinami local/injected symbolu
- `Using` impact v panelu
- source/usage navigation pres inline tlacitka
- open mody (`newTab/current/side/sidePreview/peek`) pro debug ergonomii
- root-relevant `Using` contribution + `Filtered` podstrom
- placeholder usage list a metadata (`Meta`) u contribution
- `Using` i injected symboly jdou ze sdileneho `DocumentCompositionModel`
- samostatna statisticka sekce + quick actions vrstva (`Copy Summary`, `Log Non-effective Usings`)

### Milestone M7: Using impact analysis
Stav:
- `[HOTOVO]`
Obsah:
- `T7` Using impact analysis

Vystup:
- stavy `provided / applied / consumed / unused`,
- rozliseni `unused / partial / effective using`.

Test checkpoint:
- fixture testy pro:
  - `Using` bez efektu
  - `Using`, ktery jen cast prida
  - `Using`, ktery neco prida, ale nic to nespotrebuje
  - plne efektivni feature
- manualni kontrola v Tree View a builder outputu.

Smysl testu:
- tady uz musime overit i pomer signal/sum, jinak bude tooling zahlcovat.

Gate pro dalsi milestone:
- umi spolehlive rozlisit zbytecny `Using` od legitimni partial feature.

Aktualne hotovo:
- `unused-using`
- `partial-using`
- insert-based status nad indexovanou insert metrikou contribution
- zobrazeni dopadu v `Tree View`
- sjednoceny evaluator impactu pro indexer/diagnostics/Tree View/fixture runner
- detailni contribution-level insert trace je exponovan v builder debug vystupu

### Milestone M8: Ordering model
Stav:
- `[PROBIHA]`
Obsah:
- `T8` Ordering model

Vystup:
- `OrderGroup`,
- `Before / After`,
- validace konfliktu a cyklu.

Test checkpoint:
- fixture testy nad konfliktnim poradi,
- fixture testy nad jednou feature, ktera ma jine poradi ve `Form` a jine ve `WorkFlow`,
- regression testy proti realnym prikladum s tlacitky a akcemi.

Smysl testu:
- ordering ma potencial rozbit build tise, proto musi byt explicitne otestovany hned pri zavedeni.

Gate pro dalsi milestone:
- poradi uz neni zavisle na poradi `Using` a konflikty jsou jasne reportovane.

Aktualne hotovo:
- ordering conflict validator v effective modelu
- `ordering-conflict` diagnostika v feature entrypointu
- Tree View ordering debug vrstva
- composition regression testy pro conflict/cycle/missing anchor

### Milestone M9: Authoring ergonomie
Stav:
- `[HOTOVO]`

Obsah:
- `T9` Authoring ergonomie

Vystup:
- komponenta v komponente,
- `Primitive`,
- inline sugar pro sdilene struktury,
- `Repeat` sugar,
- `If` sugar,
- `Case` sugar,
- canonical rewrite do standardniho finalniho XML.

Test checkpoint:
- male fixture testy pro kazdou ergonomickou sugar vrstvu,
- male fixture testy pro `Repeat`, `If`, `Case`,
- canonical output testy:
  - authoring sugar -> standardni finalni XML,
- regression testy, ze sugar neovlivni existujici feature bez sugar syntaxe,
- realne end-to-end testy nad vybranymi komponentami z `SFPExampleProject`.

Smysl testu:
- ergonomie ma smysl jen pokud nezvysuje riziko neviditelnych odchylek ve finalnim XML.

Gate pro dalsi milestone:
- authoring zapis je kratsi, ale finalni XML zustava 1:1 predvidatelne a testovatelne.

Aktualne hotovo:
- builder sugar pipeline pro `Repeat`, `If`, `Case`
- podpora `Primitive` + `UsePrimitive` vcetne parametru a slotu (`{{Slot:...}}`)
- nacitani primitive knihovny z `XML_Primitives`
- auto-build dependents funguje i pro `XML_Primitives`
- core testy pro primitives/sugar + fixture demo `999_T9PrimitiveDemo`
- diagnostics pro primitive authoring:
  - `unknown-primitive`
  - `primitive-missing-slot`
  - `primitive-missing-param`
  - `primitive-cycle`
- Tree View `Using/Contribution` zobrazuje primitive usage (`Primitives`) vcetne `uses`/`inserts` a source odkazu
- linter fixture scenare pro primitive diagnostics (`chyba-36..39`)
- samostatny template primitive test runner + fixture-level edge scenare (`998_T9PrimitiveEdge`)

### Milestone M10: Final output quality
Obsah:
- `T10` Final output quality

Vystup:
- volitelny post-build format,
- volitelne provenance markery.

Test checkpoint:
- formatter integration testy nad finalnim buildem,
- fixture testy pro specialni bloky:
  - `SQL`
  - `Command`
  - `HTMLTemplate`
  - `CDATA`
- testy pro ruzne provenance modes.

Smysl testu:
- tato vrstva upravuje finalni XML, proto musi byt otestovana az po stabilizaci build logiky, ale pred dalsim rolloutem.

Gate pro dalsi milestone:
- finalni XML je citelnejsi a debug rezim je pouzitelny bez rozbiti specialnich bloku.

### Milestone M11: Programovatelne generovani
Obsah:
- `T11` Programovatelne generovani uvnitr feature

Vystup:
- prvni `JS/TS` build-time generator,
- explicitni lift opakovanych action sekvenci do `ActionShareCode`,
- omezeny side-effect free kontrakt,
- regression testy pro generovane patterny.

Test checkpoint:
- male unit testy nad generatorem,
- fixture testy nad jednou realnou repetitivni feature,
- performance a determinism check:
  - stejny vstup => stejny vystup
  - zadne side effecty

Smysl testu:
- generatorovou vrstvu chceme pustit az tehdy, kdy uz mame stabilni builder, jinak by se spatne debugovala.

Gate pro release:
- generatory resi slozite patterny bez zavedení noveho pseudojazyka a bez destabilizace builderu.

## Prvni pilot
Prvni implementacni vlna by mela byt vedena nad jednou feature s vysokou slozitosti a zaroven dobrou citelnosti zavislosti.

Doporucena feature:
- `Assign`

Duvody:
- zasahuje do `Form`, `WorkFlow` i `View`,
- obsahuje controls, buttons i action/sharecode wiring,
- dobre ukaze hodnotu feature contracts i budoucich builder reportu.
