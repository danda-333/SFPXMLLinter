# Implementation Plan: SFP Feature Templating v2

## Cil
Posunout soucasny XML template builder od prostych `Using` insertu k feature-oriented systemu, ktery:

- zachova XML jako hlavni authoring format,
- zjednodusi skladani business feature napric `Form`, `WorkFlow`, `DataView` a `View`,
- snizi riziko nekompletnich nebo rozbitych feature,
- zpruhledni finalni dopad builderu v editoru,
- vytvori zaklad pro dalsi ergonomicka rozsireni a programovatelne generovani.

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
      Assign.feature.component.xml
      Assign.Form.component.xml
      Assign.WorkFlow.component.xml
      Assign.View.component.xml
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
- co ocekava (`expects`),
- na cem zavisi (`requires`, `recommends`),
- z jakych casti se sklada (`parts`).

### 4. Form-owned feature model
`Form` je vlastnik aktivnich feature. `WorkFlow` a `DataView` mohou:
- feature zdedit z formulare,
- lokalne je rozsirit,
- lokalne nektere prebit.

## Implementacni faze
### Faze T1: Stabilizace domenoveho modelu
Cil:
- z notes udelat explicitni datovy model, nad kterym pujde builder i editor.

Vystupy:
- navrh feature manifestu,
- navrh `provides / expects / requires / recommends / parts`,
- navrh capability reportu,
- navrh ordering modelu,
- navrh builder modes.

Poznamky:
- v teto fazi jeste bez integrace do buildu,
- cilem je mit stabilni kontrakty.

Definition of Done:
- je popsany format feature manifestu,
- je popsany format capability reportu,
- je rozhodnuto, jaka metadata pocitame automaticky a jaka se deklaruji rucne.

### Faze T2: Feature manifest + dependency validator
Cil:
- zavadet feature contracts a zacit hlidat nekompletni nebo rozbite feature.

Implementace:
- nacitani feature manifestu,
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
- pilot feature ma funkcni manifest a regression testy.

Doporuceny pilot:
- `Assign`

### Faze T3: Form-owned feature inheritance
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

### Faze T4: Effective composition model
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

### Faze T5: Builder observability
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

### Faze T6: Tree View nad finalnim modelem
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

### Faze T7: Using impact analysis
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

### Faze T9: Authoring ergonomie
Cil:
- zkratit opakujici se XML patterny a zjednodusit zapis bez rozbiti finalniho SFP XML modelu.

Implementace:
- komponenta v komponente,
- lehke `Primitive` bez tezkeho `Using`,
- inline sugar pro sdilene struktury:
  - napr. inline `ConfirmFormDialog` pod `Button`,
- explicitni lift opakovanych action sekvenci do `ActionShareCode`,
- zachovani standardniho finalniho XML po buildu.

Definition of Done:
- autoring je kratsi a citelnejsi,
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
- bez side effectu,
- s jasnym vstupem a vystupem,
- cilene hlavne pro feature typu `FolderGroupSegment`.

Definition of Done:
- slozite opakujici se bloky lze generovat programove,
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
3. `T3` Form-owned feature inheritance
4. `T4` Effective composition model
5. `T5` Builder observability
6. `T6` Tree View
7. `T7` Using impact analysis
8. `T8` Ordering model
9. `T9` Authoring ergonomie
10. `T10` Final output quality
11. `T11` Programovatelne generovani

## Milestones
### Milestone M1: Feature contracts foundation
Obsah:
- `T1` Stabilizace domenoveho modelu

Vystup:
- finalni navrh feature manifestu,
- finalni navrh capability reportu,
- finalni navrh builder modes,
- rozhodnuti co se pocita automaticky a co rucne.

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
Obsah:
- `T2` Feature manifest + dependency validator

Vystup:
- prvni implementace feature manifests,
- nove diagnostiky pro nekompletni nebo rozbite feature,
- regression fixture testy pro pilot feature.

Test checkpoint:
- male fixture testy nad zamerne rozbitou a kompletni feature,
- regression testy nad `Assign`,
- manualni overeni v editoru:
  - feature kompletni
  - chybi workflow cast
  - chybi pozadovany dependency
  - existuje duplicate provider

Smysl testu:
- overit, ze validace hlida skutecne problemy feature a negeneruje sum.

Gate pro dalsi milestone:
- pilot feature ma stabilni manifest a validace umi zachytit hlavni tridY nekompletnosti.

### Milestone M3: Form-owned inheritance
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

### Milestone M4: Effective composition model
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

### Milestone M5: Builder observability
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

### Milestone M6: Tree View MVP
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

### Milestone M7: Using impact analysis
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

### Milestone M8: Ordering model
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

### Milestone M9: Authoring ergonomie
Obsah:
- `T9` Authoring ergonomie

Vystup:
- komponenta v komponente,
- `Primitive`,
- inline sugar pro sdilene struktury,
- explicitni lift opakovanych action sekvenci do `ActionShareCode`.

Test checkpoint:
- male fixture testy pro kazdou ergonomic sugar vrstvu,
- canonical output testy:
  - authoring sugar -> standardni finalni XML
- realne end-to-end testy nad vybranymi komponentami z `SFPExampleProject`.

Smysl testu:
- ergonomie ma smysl jen pokud nezvysuje riziko neviditelnych odchylek ve finalnim XML.

Gate pro dalsi milestone:
- authoring zapis je kratsi, ale finalni XML zustava 1:1 predvidatelne a testovatelne.

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
