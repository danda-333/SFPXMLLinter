# Component Architecture Notes

Pracovni soubor pro navrhy dalsiho smerovani SFP templating komponent.

## Abstrakt

- Zachovat XML komponenty jako hlavni templating mechanismus.
- Zachovat business / feature orientaci komponent misto ciste technicke kategorizace.
- Rozdelovat velke komponenty uvnitr jedne feature na mensi casti typu `Form`, `WorkFlow`, `View`, `Filter`.
- Zavest hlavni feature entrypoint, ktery sklada vnitrni casti feature dohromady.
- Zlepsit kategorizaci komponent podle feature hranic, ne jen podle technickeho typu.
- Navrhnout a zavest feature metadata / manifest.
- Automaticky dopoctat `provides` a cast `requires` z XML struktury.
- Rucne deklarovat business / semanticke zavislosti, ktere z XML nejdou spolehlive poznat.
- Zavest validace pro nekompletni nebo rozbite feature dependency.
- Casem napojit dependency model i na builder, completion a hover.
- Pozdeji zvazit programove definovane komponenty jako dalsi vrstvu nad XML templatingem.

## Kontext

Aktualni komponenty nejsou jen technicke XML fragmenty. Ve vetsine pripadu predstavuji jednu business feature v ITSM domene, ktera typicky zasahuje do vice oblasti naraz:

- `Form`
- `WorkFlow`
- `View`
- `Filter`
- sdilene `ShareCode`
- navazane `DataSource` / SQL casti

Z tohoto duvodu vznikaji velke "mega komponenty". To samo o sobe neni chyba. Je to dusledek toho, ze jedna feature casto pridava:

- nova pole do formulare
- nova tlacitka
- navazanou workflow logiku
- rozsireni pohledu a filtru
- wiring mezi controls, buttons a sharecody

## Shrnutí dosavadního závěru

Rozpad komponent ma smysl, ale ne podle ciste technickych kategorii napric celym projektem.

Nedoporuceny smer:

- globalni `Controls/`
- globalni `Buttons/`
- globalni `WorkFlow/`
- globalni `Views/`

Duvod:

- rozbila by se vazba mezi castmi, ktere patri ke stejne business feature
- zhorsila by se dohledatelnost souvisejicich casti
- vysledkem by byla technicka fragmentace bez zachovani domenove logiky

Doporuceny smer:

- drzet komponenty feature-oriented
- jedna business feature = jeden jasne pojmenovany root
- uvnitr feature pripadne rozdelit casti na mensi subkomponenty

## Navrhovany model

Priklad:

```text
Common/
  Features/
    Assign/
      Assign.feature.xml
      Assign.Form.feature.xml
      Assign.WorkFlow.feature.xml
      Assign.View.feature.xml
```

Vyklad:

- `Assign.feature.xml`
  - hlavni vstupni bod
  - sklada feature jako celek
- `Assign.Form.feature.xml`
  - controls / sections / pripadne button deklarace vazane na form
- `Assign.WorkFlow.feature.xml`
  - sharecody / akce / wiring
- `Assign.View.feature.xml`
  - sloupce / filter / datasourcy pro view vrstvu

## Proc to vypada jako dobra cesta

- zachova se business soudrznost
- velke komponenty pujde delit na mensi casti bez ztraty kontextu
- bude jednodussi hledat "vse co patri k Assign"
- zmensi se riziko, ze se pri uprave feature zapomene na souvisejici cast workflow nebo view

## Dalsi mozna rozsireni

### 1. Feature metadata

Ke kazde feature by slo doplnit jednoduchy popis toho, co feature rozsiri.

Priklady informaci:

- jake controls feature pridava
- jaka buttons feature pridava
- jake sharecody feature vytvari
- ktere view / filter casti rozsiri
- na cem zavisi

To muze byt:

- jen dokumentacni komentar
- samostatny manifest
- casem i strojove validovatelny popis

## Navrh dependency systemu

Cil:

- po rozpadu mega komponent na mensi feature casti nechceme, aby se feature rozpadla jen proto, ze nekdo prida pouze `Form` cast a zapomene na navazujici `WorkFlow` nebo `View`
- chceme vcas upozornit na nekompletni feature
- idealne to chceme zapojit do validace

### Zakladni princip

Nejvhodnejsi se jevi hybridni model:

- co jde, dopocteme automaticky z XML
- co z XML spolehlive nepozname, dodeklarujeme rucne

To znamena:

- `provides` budeme ve vetsine pripadu umet ziskat automaticky
- `requires` budeme umet ziskat castecne automaticky
- `semantic dependencies` budeme deklarovat rucne

### Navrhovana jednotka

Kazda feature bude mit vlastni manifest.

Priklad:

```text
Common/
  Features/
    Assign/
      Assign.feature.json
      Assign.Form.feature.xml
      Assign.WorkFlow.feature.xml
      Assign.View.feature.xml
```

Manifest nemusi byt velky. Jeho smyslem neni duplikovat XML, ale popsat feature jako celek.

### Co muze validace poznat automaticky

Z XML umi validator pomerne dobre zjistit:

- jaka `Control Ident` cast pridava
- jaka `Button Ident` cast pridava
- jaka `Section Ident` cast pridava
- jake `ControlShareCode` cast pridava
- jake `ButtonShareCode` cast pridava
- jake `ActionShareCode` cast pridava
- jake `Column Ident` cast pridava do `DataView`
- jake reference cast pouziva

Priklad automatickeho `requires`:

- `Button xsi:type="ShareCodeButton" Ident="AssignButtonShare"` -> vyzaduje `ButtonShareCode/AssignButtonShare`
- `Action xsi:type="ActionValue" ControlIdent="AssignedGroupID"` -> vyzaduje `Control/AssignedGroupID`
- `ControlLabel ControlID="ReporterAccountID"` -> vyzaduje `Control/ReporterAccountID`

### Co z XML spolehlive nepozname

Nektere dependency jsou businessove, ne syntakticke.

Typicke priklady:

- feature `Assign` musi mit zaroven controls pro resitele / tym
- feature pridava buttony, ale bez odpovidajicich sharecodu je funkcne nekompletni
- feature pocita s tim, ze view vrstva obsahuje urcite sloupce
- cast je pouzitelna jen v kombinaci s jinou feature

Toto je vhodne deklarovat rucne v manifestu.

### Navrhovana struktura manifestu

Priklad:

```json
{
  "feature": "Assign",
  "parts": [
    "Assign.Form.feature.xml",
    "Assign.WorkFlow.feature.xml",
    "Assign.View.feature.xml"
  ],
  "requires": [
    "feature:FolderGroupSegment"
  ]
}
```

Poznamka:

- `requires`
  - bez teto zavislosti feature nedava smysl nebo nebude fungovat
- `expects`
  - pouzivat primarne na urovni konkretni `Contribution`, kdy cast potrebuje neco, co sama primo nedodava
- `expectsXPath`
  - nejspodnejsi technicka vrstva kontraktu; explicitne rika, jaka XPath musi ve slozenem modelu existovat

### Proc `expects` a `expectsXPath` vedle `requires`

`requires` popisuje zavislost na jine feature nebo vedome reuse jednotce.

`expects` popisuje symbolickou zavislost konkretni contribution.

`expectsXPath` popisuje nejpresnejsi technicky kontrakt: jaka struktura musi po slozeni existovat.

To je dulezite, protoze nekdy neni podstatne, ktera feature neco dodala, ale pouze to, ze po slozeni existuje:

- control
- sharecode
- column
- section

Tento model je pro validator vyrazne praktictejsi, protoze:

- `requires` hlida explicitni reuse zavislosti
- `expects` hlida citelne symbolicke vazby
- `expectsXPath` hlida presny finalni cil ve slozenem XML

### Co by validator mohl hlasit

#### 1. `missing-feature-dependency`

Feature cast nebo feature manifest pozaduje jinou feature, ktera neni pritomna.

Priklad:

- `Assign` vyzaduje `FolderGroupSegment`
- formular pouziva `Assign`, ale neobsahuje `FolderGroupSegment`

#### 2. `missing-feature-expectation`

Po slozeni feature chybi ocekavany vysledek.

Priklad:

- feature ocekava `control:AssignedGroupID`
- po slozeni formulare tento control neexistuje

#### 3. `incomplete-feature`

Feature je pritomna jen castecne.

Priklad:

- je pouzita `Assign.Form.feature.xml`
- chybi `Assign.WorkFlow.feature.xml`
- feature manifest pritom rika, ze obe casti patri k sobe

#### 4. `duplicate-feature-provider`

Dve feature poskytly stejny logical symbol, kde to neni zadouci.

Priklad:

- dve feature poskytnou stejny `ButtonShareCode`

#### 5. `orphan-feature-part`

Existuje cast feature, ktera neni referencovana z hlavniho feature entrypointu.

To pomuze udrzet strukturu cistou po refaktoru.

## Doporuceny implementacni smer

### Faze 1

Pouze navrh a manifesty, bez tvrde validace.

- navrhnout schema manifestu
- zkusit 1 pilotni feature
- vyzkouset, zda metadata sedi s realitou

### Faze 2

Pridat read-only validator warningy.

- `missing-feature-dependency`
- `missing-feature-expectation`
- `incomplete-feature`

Zatim jen jako warning, aby se model odladil.

### Faze 3

Napojit dependency system na builder a tooling.

Moznosti:

- build log upozorni na nekompletni feature
- completion umi nabidnout doporucene souvisejici feature
- hover umi ukazat, co feature poskytuje a co vyzaduje

## Aktualni doporuceni

Nejrozumnejsi prvni krok neni hned implementace do validatoru, ale:

- vybrat 1 pilotni feature
- navrhnout jeji `feature manifest`
- overit, ze umi popsat realne vazby mezi `Form`, `WorkFlow` a `View`

Jako vhodni kandidati stale vychazeji:

- `Assign`
- `ReporterControls`
- `FolderGroupSegment`

Nejlepsi kandidat na dependency pilot je pravdepodobne `Assign`, protoze ma silne vazby na:

- controls
- buttony
- sharecody
- workflow wiring
- view dopady

## Zjednoduseni XML zapisu

Vedle architektury feature se objevuje jeste jedna samostatna potreba:

- samotny XML zapis je na mnoha mistech zbytecne ukecany
- casti vznikaji podle .NET objektoveho modelu
- ale pri psani XML se casto opakuje stejny vzor, ktery se lisi jen v jedne nebo nekolika hodnotach

Typicke priklady:

- `Columns`
- `Parameters`
- opakujici se `DataBind` / `SelectedDataBind` skeletony
- kratke `View` a `Filter` fragmenty

Tohle uz neni primarne problem business feature, ale ergonomie samotneho authoringu.

### Navrhovane rozliseni

Je vhodne odlisit dve vrstvy znovupouzitelnosti:

- `Feature components`
  - business feature
  - zasah do `Form`, `WorkFlow`, `View`, `Filter`
  - muze mit dependency kontrakty
- `Primitives`
  - male sdilene stavebni bloky XML
  - bez tezke business logiky
  - cilem je zkratit opakujici se zapis

### Co by mely byt primitives

Primitive by mel byt maly a lokalne skladatelny blok.

Priklady:

- jeden `Column` pattern
- sada `Column` definic
- jeden `Parameter`
- mala sada `Parameters`
- drobny `DataSource` nebo `DataBind` fragment
- kratky `Section` / `HTMLTemplate` blok

Primitive by mel resit:

- zkraceni opakovaneho XML
- citelnost
- mensi copy-paste uvnitr jednoho souboru i mezi soubory

Primitive by naopak nemel:

- sam o sobe predstavovat velkou feature
- zavadet slozity dependency graph

### Dulezita vlastnost

Primitive by idealne nemel potrebovat plny `Using`.

Doporuceny cil:

- primitive lze vlozit velmi lehce
- primitive lze pouzit i uvnitr jine komponenty
- primitive lze pouzit i uvnitr komponentove feature bez dalsi "obalovaci" vrstvy

To by odstranilo cast dnesni zbytecne rezie.

### Komponenta v komponente

Soucasne se jako prirozene rozsireni jevi umoznit:

- komponentu pouzit uvnitr jine komponenty

To je uzitecne hlavne v kombinaci s feature-oriented rozpadem:

- feature bude slozena z mensich casti
- casti mohou samy vyuzivat primitives nebo male subkomponenty

Tedy:

- `feature component` muze skladat jine komponenty
- `primitive` muze byt pouzit jak v beznem XML, tak uvnitr komponenty

### Doporuceny model znovupouzitelnosti

Pravdepodobne budou stacit tri urovne:

- `Primitive`
  - maly opakovany XML fragment
- `Subcomponent`
  - mensi cast feature, stale bez plne samostatne business identity
- `Feature component`
  - hlavni business jednotka

To znamena:

- ne vsechno musi byt hned "feature"
- ne vsechno musi byt reseno pres `Using`
- cast opakovani muzeme resit levnejsi a lehci vrstvou

### Co by to mohlo prinaset v praxi

Priklad pro `Columns`:

- misto opakovani stejneho `Column` patternu na vice mistech
- bude mozne pouzit primitive, ktery vyrobi odpovidajici XML blok podle kratkeho vstupu

Priklad pro komponenty:

- `BaseView` feature muze skladat male `Column primitives`
- `FolderGroupSegment` feature muze skladat opakovane `Category level` subkomponenty

### Doporuceny smer

Nejrozumnejsi dalsi uvaha je:

- zavest lehkou vrstvu `primitives`
- umoznit pouziti komponenty uvnitr komponenty
- nechat `Using` jako tezsi mechanismus pro business feature a cross-cutting rozsirovani

To by melo zlepsit:

- citelnost XML
- rychlost authoringu
- znovupouzitelnost uvnitr komponent
- snizeni copy-paste bez zbytecneho nafukovani dependency modelu

## Form-owned feature model

Dalsi silny problem aktualniho pristupu:

- pokud feature pridava funkcionalitu napric `Form`, `WorkFlow` a `DataView`
- je dnes treba pridavat `Using` do vice XML souboru rucne
- tim vznikaji caste stavy:
  - nekde `Using` chybi
  - nekde `Using` prebyva
  - nekde se feature rozsiri jen napul

To je z dlouhodobeho hlediska tezke na udrzbu.

### Doporuceny princip

Feature by mela byt vlastnena primarne formularem.

Tedy:

- `Form` je hlavni misto, kde se feature aktivuje
- `WorkFlow` a `DataView` by nemely feature znovu rucne zavadet
- `WorkFlow` a `DataView` by mely umet rict:
  - "pouzij stejny feature set jako formular"

To znamena, ze `Form` se stane hlavnim zdrojem pravdy pro feature composition.

### Mentalni model

- `Form` definuje, ktere feature jsou aktivni
- `WorkFlow` dedi feature set z formulare
- `DataView` dedi feature set z formulare
- lokalni `WorkFlow` / `DataView` rozsirení jsou stale mozna, ale uz jen jako doplnek

#### Doporucena semantika

- `Form`
  - explicitne aktivuje feature
- `WorkFlow`
  - muze zvolit `UseFormFeatures="true"` nebo ekvivalentni mechanismus
- `DataView`
  - muze zvolit stejny model

Tedy:

- formular urcuje jadro
- workflow a view vrstva dedi vychozi feature composition

### Co tim ziskame

- vyrazne mene rucni synchronizace mezi XML soubory
- mensi riziko, ze feature bude pritomna jen ve `Form`, ale ne ve `WorkFlow`
- mensi riziko, ze ve `WorkFlow` zustane stary `Using`, ktery uz formular davno nepouziva
- jednodussi maintenance pri pridani nebo odebrani feature

### Co by melo zustat mozne

I pri tomto modelu je vhodne zachovat:

- moznost lokalnich `WorkFlow` extension feature
- moznost lokalnich `DataView` extension feature
- moznost explicitniho override, pokud nekde opravdu nechceme dedit vse

Tedy ne tvrde svazani, ale:

- dedicnost jako default
- manualni override jako vedoma vyjimka

### Mozne validace

Tento model by sel velmi dobre napojit na validator.

Priklady:

- `workflow-missing-form-feature`
  - workflow nepouziva feature set formulare a chybi mu feature, kterou formular aktivuje
- `workflow-redundant-feature-using`
  - workflow rucne pridava feature, kterou stejne dedi z formulare
- `dataview-redundant-feature-using`
  - dataview rucne duplikuje feature, ktera uz je zdedena
- `feature-inheritance-override`
  - informacni nebo warning diagnostika, ze soubor vedome prepisuje dedicny feature set

### Doporuceny smer

Nejrozumnejsi se jevi tento postup:

- feature composition ukotvit primarne na `Form`
- `WorkFlow` a `DataView` nechat dedit feature set z formulare
- lokalni `Using` v `WorkFlow` / `DataView` ponechat jen pro specialni pripady

To by melo zasadne zjednodusit cross-XML feature maintenance.

## Final output quality

Aktualni pozorovani:

- buildnuta XML jsou funkcni
- ale casto nejsou dostatecne cista z hlediska finalni citelnosti
- vysledny XML vystup by mel byt co nejvice "production readable"

### Doporuceny smer

Finalni XML by po slozeni melo byt prohnano internim formatterem.

Tedy:

- templating builder slozi vysledek
- nasledne se nad finalnim XML pusti interní formatter
- do runtime `XML` se ulozi uz formatovany vystup

### Proc je to uzitecne

- buildnute XML bude citelnejsi
- snizi se vizualni chaos po insert / include / placeholder expandu
- lepe se budou porovnavat diffy
- snadneji se bude ladit finalni runtime vystup

### Opatrnost

Tento krok musi respektovat:

- stejne formatter rules jako pri manualnim formatovani
- specialni elementy (`SQL`, `HTMLTemplate`, `Command`, komentare, `CDATA`)
- zachovani zamyslene struktury po buildu

Jinymi slovy:

- nejde o "prepis vystupu za kazdou cenu"
- ale o bezpecne finalni znormalizovani buildnuteho XML

## Provenance markers in final build

Dalsi uzitecna schopnost builderu:

- ve finalnim buildu by melo byt videt, odkud konkretni vlozene casti pochazeji

Prakticky cil:

- vse, co builder vklada do finalniho XML, muze byt ohraniceno XML komentari

Priklad:

```xml
<!-- Template builder: 0.0.12 - Common/Shared/Assign -->
... vlozeny obsah ...
<!-- /Template builder: 0.0.12 - Common/Shared/Assign -->
```

### Proc je to uzitecne

- velmi rychla orientace ve finalnim XML
- snadnejsi ladeni, odkud se dana cast vzala
- snadnejsi kontrola dopadu `Using`
- lepsi navazani na editor tooling a budouci tree view

### Co by marker mel obsahovat

Minimalne:

- builder verzi
- cestu ke zdrojove komponente / feature

Volitelne do budoucna:

- nazev sekce
- typ vlozeni (`Using`, `Include`, placeholder, primitive)
- pripadne source file, pokud to dava smysl

### Opatrnost

Tato funkce je velmi uzitecna pro debug a orientaci, ale muze mit i nevyhody:

- finalni XML bude ukecanejsi
- diffy budou delsi
- nekde muze byt nezadouci mit build metadata primo ve vystupu

Je take nutne respektovat kontext, kam se obsah vklada.

Priklad problematickych mist:

- `SQL`
- `Command`
- `HTMLTemplate`
- `CDATA`
- dalsi textove nebo specialni bloky

Do techto mist nelze bezpecne vkladat bezne XML komentare stejnym zpusobem jako mezi standardni XML elementy.

### Doporucena omezeni

Je vhodne mit pro provenance markery pravidla nebo settings, ktere urci:

- kde se markery smi vkladat
- kde se nesmi vkladat vubec
- zda se v techto pripadech marker vlozi na vyssi urovni obaloveho elementu

Prakticky model:

- standardni XML elementy
  - marker povolen
- specialni textove bloky
  - marker zakazan nebo presunut mimo obsah bloku

To znamena, ze provenance system musi byt kontext-aware, ne jen "obal vse komentarem".

## Builder debug output

S rostouci komplexitou templatingu uz nestaci jen finalni XML vystup.

Je potreba, aby samotny builder mel jednoduse dohledatelny debug output, ktery pomuze odhalit chyby driv, nez se dostanou do validatoru nebo do runtime XML.

### Doporuceny smer

Builder by mel mit vlastni snadno dostupny vystup.

Mozne formy:

- samostatny `Output Channel` ve VS Code
- pripadne navazany build report / debug log

Aktualni preference:

- vlastni builder output channel je dostacujici a prakticky prvni krok

### Co by mel output ukazovat

Minimalni uzitecne informace:

- ktery soubor se buildi
- jake `Using` / `Include` / placeholder casti byly aplikovany
- ktere casti nemely zadny dopad
- ktere `TargetXPath` se nepodarilo vyhodnotit nebo nic nenasly
- vice-match situace a jak byly vyreseny
- ktere feature / komponenty byly aplikovany jen castecne
- zkratene shrnuti build warningu

### Dulezity cil

Builder output nema byt jen technicky log.

Mel by odpovidat na otazky typu:

- proc se tato cast do finalniho XML dostala
- proc se tato cast nedostala do finalniho XML
- ktery `Using` nema efekt
- kde se rozhodlo o poradi nebo o dedeni feature

### Vztah k validatoru

Toto neni nahrada validatoru.

Smysl je:

- mit mezivrstvu debug informaci uz pri buildu
- umet odchytit cast chyb a nejasnosti drive
- usnadnit ladeni templatingu v dobe, kdy validator jeste neumi vsechno

Tedy:

- builder output = build-time debug vrstva
- validator = semanticka a editorova kontrola

### Doporuceny postup

Rozumne poradi implementace:

- nejdriv zavest builder output channel
- doplnit do nej strukturovane a filtrovane informace
- teprve pak navazovat slozitejsi editor tooling

To pomuze udrzet templating debugovatelny i pri dalsim rustu systemu.

## Test fixtures for features and primitives

Vedle velkych fixture testu nad produkcnimi XML bude potreba drzet i male cilene testy pro jednotlive stavebni bloky.

Smysl:

- overovat jednotlive feature
- overovat primitives
- overovat budouci `JS/TS` generatory
- odchytavat regresi po malych krocich pri vyvoji

Doporuceny pristup:

- pri vyvoji kazde nove casti pridat male fixture testy
- netestovat jen finalni velky build parity scenar
- drzet testy co nejmensi a snadno citelne

To je dulezite hlavne proto, ze s rostoucim poctem transformaci bude tezsi hledat, kde se presne chyba rozbila.

## Naming strategy

Aktualni preference:

- naming negenerovat automaticky
- naming ridit manualne pres parametry a conventions

Duvod:

- jmena casto nesou domenovy vyznam
- casto budou prirozene soucasti primarnich parametru feature nebo primitive
- manualni naming pomuze i pri zamerne nededuplikovanych nebo sdilenych sekcich

To znamena:

- builder nema naming "vymyslet"
- builder ma s nim umet pracovat
- naming ma byt explicitni vstup, ne implicitni magie

## Feature capability report

Vedle tree view by bylo vhodne mit i schopnost sestavit report toho, co feature realne dela.

Smysl:

- feature by mela jit popsat jako:
  - co poskytuje
  - co ocekava
  - co bylo aplikovano
  - co bylo consumed

Tento report muze byt uzitecny:

- v editoru
- v tree view
- v builder output channelu
- pri ladeni dependency problemu

Jinymi slovy:

- tree view = interaktivni pohled
- capability report = strukturovane shrnuti

## Conflict reporting policy

S dalsim rustem systemu budou vznikat kolize:

- stejny `Ident`
- stejny sharecode
- stejny ordering anchor
- vice feature se snazi vlozit neco na stejne misto

Aktualni preference:

- builder se muze pokusit kolizi vyridit prvnim moznym deterministickym zpusobem
- ale kolize musi byt viditelne reportovana

Primarni mista reportingu:

- `Tree View`
- builder output channel

To znamena:

- kolize nemaji byt tiche
- ale ani neni nutne hned vse tvrde zastavit
- nejdriv musi byt dobre videt, ze ke kolizi doslo a jak byla vyrizena

## Builder modes

Builder by mel mit jasne oddelene rezimy behu.

Duvod:

- postupne pribyva vice chovani:
  - debug output
  - provenance markery
  - formatter po buildu
  - pozdeji mozna dalsi diagnosticke kroky

Bez jasnych rezimu se bude michat:

- produkcni build
- debug build
- rychly build

Doporucene zakladni rezimy:

- `fast`
  - minimalni rezije
  - bez tezsich debug informaci
- `debug`
  - bohatsi output
  - provenance / detailni logy podle nastaveni
- `release`
  - stabilni finalni vystup
  - formatter a konzistentni finalni serializace

Smysl:

- uz ted navrhnout builder tak, aby rezimy sly pridavat
- nevrstvit vsechny behavior flags nahodne bez spolecneho modelu

### Doporuceny model

Jako nejrozumnejsi se jevi:

- mit tuto funkci jako konfigurovatelny build rezim

Napriklad:

- `off`
- `compact`
- `full`

Mozny vyklad:

- `off`
  - bez markeru
- `compact`
  - markery jen kolem vetsich feature insertu
- `full`
  - markery kolem vsech builderem vkladaných casti

### Doporuceny smer

Toto se jevi jako silny kandidat hlavne pro:

- debug build
- vyvoj feature
- analyzu dopadu templatingu

Nemusi to byt nutne vzdy zapnute v produkcnim buildu, ale jako volitelny rezim to ma vysokou hodnotu.

## Lift repeated actions to ActionShareCode

DalSi kostrbaty use-case:

- `Include` nebo jina skladaci cast muze v konkretnim miste vyustit do vice standardnich `<Action>`
- to sice funguje
- ale ve finalnim `WorkFlow` XML to zhorsuje citelnost
- a opakovane action bloky se pak mohou mnozit na vice mistech

Priklad use-case:

- `SFPExampleProject/XML_Templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml`
- misto jako `:165`, kde se skladaji standardni `Action` bloky

### Doporuceny smer

Pokud nejaky feature snippet nebo include generuje opakovane nebo standardni action bloky, bylo by vhodne umet:

- nejdriv vygenerovat odpovidajici `<ActionShareCode>`
- v puvodnim miste pak pouzit jen referenci na tento sharecode

Tedy:

- finalni workflow bude citelnejsi
- opakovane action bloky se nebudou rozsypavat po vice mistech
- jedna akce / sekvence akci bude mit jedno pojmenovane misto

### Mozny prinos

- lepsi citelnost finalniho XML
- mensi duplikace ve workflow
- snadnejsi upravy standardnich akcnich sekvenci
- prirozenejsi navazani na feature / button contract model

### Dalsi moznost

Silnejsi varianta do budoucna:

- builder by umel stejne action sekvence sjednocovat
- pokud by stejny action blok vznikl vicekrat, vytvoril by jedno `ActionShareCode`
- na mistech pouziti by vznikly pouze reference

To ale uz vyzaduje vyresit:

- jak definovat rovnost action bloku
- jak pojmenovavat vznikle sharecody
- jak se chovat pri malych odchylkach

### Doporuceny postup

Rozumnejsi je postupovat po fazich:

- nejdriv umoznit vedome "liftovani" standardnich action snippetů do `ActionShareCode`
- az pak pripadne resit automaticke sjednocovani identickych action sekvenci

To je bezpecnejsi a citelnejsi nez hned zavadet agresivni automatickou deduplikaci.

## Inline ergonomic sugar for shared SFP structures

Dalsi ergonomicky problem:

- nektere SFP struktury jsou technicky navrzene jako globalne sdilene
- ale v praxi jsou casto pouzite pouze jednou
- autor musi i tak psat "rozpojenou" podobu

Typicky priklad:

- `ConfirmFormDialog`

Aktualni stav:

- `Button` odkazuje na `ConfirmFormDialogSectionIdent`
- skutecny `ConfirmFormDialog` je definovan jako samostatna `<Section>`

To je flexibilni, ale pri beznem pouziti zbytecne kostrbate.

### Doporuceny smer

Pokud `ConfirmFormDialog` neni skutecne sdileny mezi vice buttony, mel by jit zapsat ergonomicky primo u `Button`.

Mentalni model:

- autor napise dialog "inline" pod `Button`
- builder z toho pri finalnim buildu vytvori standardni SFP strukturu
- ve vyslednem XML zustane:
  - samostatna `<Section>`
  - a odkaz z `Button` na `ConfirmFormDialogSectionIdent`

Tedy:

- authoring bude jednoduchy
- finalni XML zustane kompatibilni se standardnim SFP modelem

### Proc je to vhodne

- odpovida to realnemu pouziti
- ve vetsine pripadu jde o 1:1 vazbu `Button -> ConfirmFormDialog`
- zlepsuje to citelnost pri authoringu
- snizuje to pocet rucnich kroku

### Charakter teto funkce

Tohle je spis "ergonomic sugar" nad existujicim XML modelem.

Neni to nova business feature.

Spada to spise do vrstvy:

- `primitives`
- build-time transforms
- authoring helpers

### Obecnejsi princip

Tento pattern muze byt zobecnen:

- autor zapisuje lokalni / inline formu
- builder ji rozpoji do standardni sdilene SFP struktury

To muze byt uzitecne i pro dalsi konstrukce, ktere jsou:

- technicky globalni
- ale prakticky casto lokalni

### Opatrnost

Je potreba jasne urcit:

- kdy jde o inline-lokalni variantu
- jak se bude generovat `Ident`
- jak se zabraní kolizim jmen
- jak se chovat, pokud uz autor chce skutecne sdileny dialog pro vice buttonu

Tedy:

- inline forma ma byt ergonomicka default varianta
- explicitni sdilena forma musi zustat stale mozna

## Using impact analysis in editor

Toto uz neni primarne problem builderu, ale editoru a validace.

Aktualni problem:

- v XML neni dobre videt, ktere `Using` maji skutecny dopad
- neni dobre videt, ktere `Using` jsou zbytecne
- neni dobre videt, zda je vyuzita cela komponenta nebo jen cast

Typicky problem:

- komponenta prida jen `ActionShareCode`
- ale nic ho dale nepouzije
- `Using` je tedy pritomne, ale nema realny finalni efekt

Jiny problem:

- `Using` prida vice veci
- ale ve vysledku je vyuzita jen cast
- to dnes neni nijak zrejme

### Dulezite rozliseni

Editor by mel rozlisovat minimálně tyto stavy:

- `provided`
  - komponenta neco poskytla do vysledneho modelu
- `applied`
  - komponenta se skutecne propsala do konkretniho XML
- `consumed`
  - to, co komponenta dodala, je nekde skutecne pouzito
- `unused`
  - komponenta je pritomna, ale nic uzitecneho finalne nedela

To je dulezite, protoze:

- neco muze byt `provided`
- ale nemusi to byt `consumed`

Priklad:

- `ActionShareCode` existuje
- ale neni navazan na zadny button / binding

### Navrhovane stavy pro `Using`

#### 1. `Unused Using`

`Using` nema realny dopad.

Priklady:

- nic se nevlozilo
- root nesedi
- sekce se nikam netrefila
- pridany sharecode neni nikde pouzit

#### 2. `Partial Using`

`Using` ma pouze castecny dopad.

Priklady:

- neco se propsalo, ale jen cast je skutecne vyuzita
- komponenta pridala vice prvku, ale jen nektere jsou consumed

#### 3. `Effective Using`

`Using` ma jasny a plny dopad.

Priklady:

- pridal controls / buttons / sections / sharecodes
- a ty jsou skutecne soucasti finalni logiky

### Co by mel editor zobrazit

Toto neni vhodne resit jen jako error/warning.

Nejlepsi se jevi kombinace:

- hover nad `Using`
- code lens nad `Using`
- diagnostiky jen pro silne signaly

#### Hover

Hover by mohl ukazovat:

- ktere sekce se aplikovaly
- ktere symboly komponenta pridala
- ktere symboly jsou consumed
- co zustalo nevyuzite

Priklad:

- `Applied sections: Controls, ActionShareCodes`
- `Provided: AssignedGroupID, AssignActionShareCode`
- `Consumed: AssignedGroupID`
- `Unconsumed: AssignActionShareCode`

#### Code lens

Nad `Using` by slo zobrazit kratke shrnuti:

- `using active`
- `using partially used`
- `using has no effect`

To by vyrazne zlepsilo orientaci pri authoringu.

#### Diagnostiky

Diagnostiky by mely vznikat jen tam, kde uz je signal dost silny.

Mozne typy:

- `unused-using`
- `using-provides-unconsumed-sharecode`
- `using-has-no-matching-target`

`partial using` je pravdepodobne vhodnejsi spis jako info v hoveru nebo reportu nez jako tvrdy warning.

### Vztah k feature binding

Feature binding tento problem casticne zmirni, ale nevyresi ho plne.

Duvod:

- feature binding pomaha s tim, aby byla feature kompletni
- ale nerika automaticky, zda ma konkretni `Using` v danem dokumentu skutecny finalni dopad

Tedy:

- feature binding = kontrola kompletni feature logiky
- using impact analysis = kontrola realneho efektu konkretniho `Using`

Obe vrstvy se doplnuji, ale nenahrazuji se.

### Doporuceny smer

Do budoucna je vhodne doplnit do editoru:

- analyzu dopadu `Using`
- prehled `provided / consumed / unused`
- lehkou diagnostiku pro zjevne zbytecne `Using`

To by vyrazne pomohlo pri udrzbe vetsiho templating projektu.

## Editor visibility of final composed model

Dalsi editorovy problem:

- pri otevreni definice formulare neni dobre videt, jake controls / buttons / sections finalne existuji
- cast z nich muze byt schovana ve feature nebo komponentach
- autor tedy nevidi finalni slozeny model primo z definice formulare

### Mozna reseni

Uvazovane varianty:

- inline preview / hover preview primo v editoru
- samostatny VS Code panel / tree view s finalnim slozenym modelem

### Aktualni preference

Prozatim preferovane reseni:

- samostatny `Tree View`

Inline preview zatim neni potreba.

### Co by mel Tree View ukazovat

Idealni obsah:

- finalni slozeny model formulare po buildu
- `Controls`
- `Buttons`
- `Sections`
- pripadne `ActionShareCodes`, `ButtonShareCodes`, `ControlShareCodes`
- puvod prvku:
  - lokalni
  - injected from feature / component

### Dalsi hodnoty vlastni zalozky

Vlastni zalozka nemusi byt jen pasivni strom.

Muze fungovat i jako lehky pracovni panel nad finalnim slozenym modelem.

Mozne doplnky:

- zakladni statistiky
  - pocet local prvku
  - pocet injected prvku
  - pocet aktivnich feature
  - pocet nepouzitych nebo partial `Using`
- rychle akce
  - otevrit zdrojovou feature / komponentu
  - prejit na deklaraci prvku
  - zobrazit impact konkretniho `Using`
  - spustit rebuild / revalidate
  - filtrovat `local / injected / unused`

Tato vrstva by z tree view udelala prakticky navigacni a diagnosticky panel, ne jen vizualizaci stromu.

### Proc je Tree View vhodny jako prvni krok

- lepe ukaze cely vysledny model
- je prehlednejsi pro vetsi formulare
- lze na nem pozdeji stavet dalsi funkce

Budouci mozna rozsireni:

- kliknuti na deklaraci
- grupovani podle feature
- filtrovani `local / injected`
- zobrazeni impact analysis

### Doporuceny smer

Pokud se bude tato cast resit v editoru, prvni implementacni cil ma byt:

- `Tree View` pro finalni slozeny model formulare

Teprve az kdyby se ukazalo, ze chybi rychly kontext primo v kodu, ma smysl doplnit i inline preview.

## Ordering model for inserted elements

Aktualni stav:

- poradi vkladanych elementu je dnes do znacne miry rizene poradi `Using`
- to je jednoduche, ale jen do okamziku, kdy jedna feature zasahuje vice ruznych cilovych oblasti

Typicky problem:

- `feat1` prida `tlacitko1` a `akce1`
- `feat2` prida `tlacitko2` a `akce2`
- ve `Form` potrebujeme poradi:
  - `tlacitko1`
  - `tlacitko2`
- ale ve `WorkFlow` potrebujeme poradi:
  - `akce2`
  - `akce1`

Tedy:

- jedna feature ma vice vystupu
- kazdy vystup muze mit jine pozadovane poradi
- globalni poradi `Using` toto nedokaze ciste vyjadrit

### Doporuceny princip

Poradi by nemelo byt odvozeno jen z poradi `Using`.

Melo by existovat explicitni ordering metadata na urovni vkladane casti.

Jinymi slovy:

- `Using` urcuje, co je aktivni
- ordering metadata urcuji, kam v poradi dany fragment patri

### Mozne varianty

#### 1. Jednoduche numericke poradi

Kazda sekce nebo insertovany fragment muze mit:

- `Order`

Priklad:

- `Button` cast feature: `Order="100"`
- `ActionShareCode` cast feature: `Order="200"`

Vyhoda:

- jednoduche

Nevyhoda:

- hure se s tim pracuje pri vetsim poctu feature
- cisla casem degeneruji do "100, 110, 115, 117..."

#### 2. Target-specific order

Kazda cast feature muze mit poradi samostatne pro svuj cil.

Priklad:

- `FormButtonsOrder`
- `WorkFlowActionsOrder`
- `ViewColumnsOrder`

Vyhoda:

- odpovida realnemu problemu

Nevyhoda:

- hrozi prilisna specializace atributu

#### 3. Anchor-based ordering

Misto absolutniho cisla se definuje relativni pozice:

- `Before="SaveButton"`
- `After="AssignButton"`
- `BeforeActionShareCode="ChangeStateAction"`

Vyhoda:

- prirozenejsi pri authoringu
- lepe vyjadruje zamer

Nevyhoda:

- slozitejsi resolution
- nutnost resit kolize a chybejici anchor

#### 4. Hybrid model

Jako nejrozumnejsi se jevi kombinace:

- hrube poradi pres `OrderGroup`
- jemne poradi pres `Before` / `After`

Priklad:

- feature patri do skupiny `AssignmentButtons`
- uvnitr skupiny chce byt `After="AssignToGroupButton"`

To umozni:

- drzet stabilni globalni poradi po skupinach
- a lokalne dodefinovat jemne poradi jen tam, kde je to potreba

### Doporuceny model

Nejlepsi kompromis se jevi:

- ordering metadata drzet na urovni jednotlivych insertovanych casti
- ne na urovni celeho `Using`
- ordering resit per target area

To znamena:

- poradi `Buttons` casti feature muze byt jine nez poradi `ActionShareCode` casti te same feature
- jedna feature tedy muze mit vice ordering pravidel podle toho, kam vklada obsah

### Co by mel builder umet

Builder by mel:

- sesbirat vsechny insertovane fragmenty
- vyhodnotit jejich ordering metadata pro konkretni cil
- teprve potom vyskladat finalni poradi

Tedy:

- ne "prvni `Using` vyhrava"
- ale "poradi je vysledkem ordering resolution"

### Opatrnost

Je potreba se vyhnout tomu, aby ordering model byl prilis komplikovany.

Doporuceni:

- zacit jednoduchym modelem
- nejspis `OrderGroup` + volitelne `Before` / `After`
- nepokouset se hned modelovat plny topological sorting se slozitymi pravidly

### Mozne validace

Validator by nad tim mohl casem hlasit:

- chybejici anchor
- kolidujici ordering pravidla
- cyklicke `Before` / `After` vazby
- neresitelne poradi

### Shrnuti

Poradi je treba oddelit od poradi `Using`.

`Using` ma rikat:

- co je aktivni

Ordering metadata maji rikat:

- jak ma byt vysledny obsah serazen v konkretnim cilovem kontextu

### 2. Button family / interaction family

Nektere feature opakuji jeden a tentyz vzor:

- controls
- buttony
- action sharecody
- button sharecody
- wiring mezi nimi

Zde muze davat smysl drzet uvnitr jedne feature jeste jemnejsi podslozky typu:

- `Fields`
- `Buttons`
- `Actions`
- `Wiring`

Ne jako globalni architekturu projektu, ale pouze jako interni organizaci uvnitr jedne feature.

### 3. Button binding contract

Aktualni problem:

- feature cast typicky prida `Button`
- feature cast prida i `ActionShareCode`, ktery by tlacitko melo technicky spoustet
- ve `WorkFlow` se ale rucne doplnuje `ShareCodeButton`
- prave do nej se musi vlozit pozadovana akce

To je rizikove, protoze:

- nekdo muze pridat tlacitko
- nekdo muze pridat `ActionShareCode`
- ale zapomene propojit `ShareCodeButton`

Vysledek:

- feature vypada jako pritomna
- ale funkcne neni kompletni

Soucasne ale nelze vse svazat natvrdo, protoze:

- konkretni `WorkFlow` muze chtit pridat dalsi akce navic
- typicky `ChangeState`
- stavy se mezi workflow lisi
- cast workflow logiky neni univerzalni

Proto se jako vhodny model jevi zavest "button binding contract".

Princip:

- feature nedodava jen tlacitko, ale i kontrakt toho, co musi byt navazane
- `WorkFlow` muze kontrakt doplnit o dalsi akce
- validator hlida, ze minimalni kontrakt byl splnen

#### Navrhovany model

Feature muze deklarovat:

- jake tlacitko pridava
- jaky `ActionShareCode` je minimalne pozadovany
- zda je mozne pridavat dalsi workflow akce

Priklad logiky:

- `AssignButton`
- musi byt navazan na binding `Assign`
- binding musi obsahovat alespon `AssignActionShareCode`
- workflow muze pridat dalsi akce navic, napr. `ChangeState`

Tedy:

- feature dodava minimalni funkcni jadro
- konkretni workflow dodava lokalni rozsireni

#### Co by mel validator overovat

Mozne validace:

- tlacitko ma odpovidajici binding
- binding obsahuje required `ActionShareCode`
- feature neni pritomna jen napul
- workflow akce navic jsou povolene, ale nesmi chybet minimalni feature akce

To by umoznilo hlasit napr.:

- `missing-button-binding`
- `missing-required-button-action`
- `incomplete-button-feature`

#### Proc negenerovat kompletni workflow automaticky

Nedoporuceny smer:

- komponenta by automaticky generovala kompletni `ShareCodeButton` vcetne `ChangeState`

Duvod:

- `ChangeState` byva workflow-specific
- kazdy formular ma jine stavy
- rychle by vznikla preparametrizovana a tezko citelna komponenta

LepSi kompromis:

- feature definuje minimalni button/action kontrakt
- workflow doplnuje lokalni akce navic
- validator hlida, ze povinne feature akce jsou opravdu pripojene

#### Mozne budouci rozsireni

Silnejsi varianta do budoucna:

- feature by mohla dodat i defaultni skeleton `ShareCodeButton`
- workflow by jej uz jen rozsiroval

To by snizilo pocet rucnich kroku, ale je to uz vetsi zasah do builderu i conventions.

### 3. Programove definovane komponenty

Pokud feature zavisi na tom, zda existuje urcity sloupec / control / vazba, muze do budoucna davat smysl pridat programove skladani komponent.

Priklad:

- pokud existuje sloupec `xy`, vloz cast `yz`

To je ale az dalsi vrstva nad stavajicim XML templatingem, ne nutne prvni krok refaktoru.

### 4. Reseni opakovani kodu uvnitr jedne feature

Vedle sdileni mezi feature se objevuje i druhy problem:

- casty jednoho XML souboru jsou prakticky stejne
- lisi se jen v nekolika parametrech
- typicky jde o sekvence `Level2 -> Level3 -> Level4 -> Level5`

Priklad:

- `FolderGroupSegment.component.xml`
- `ITSMCategoryLevel2Ident` az `ITSMCategoryLevel5Ident`

Zde se neopakuje jen jeden control, ale cely vzor:

- `Ident`
- `TitleResourceKey`
- `Dependencies`
- `SQL`
- `Parameters`
- navazne `View` sloupce
- navazne `FormControl` / visibility wiring

Tohle uz neni dobry kandidat na dalsi "rucni rozpad", ale na lokalni generativni mechanismus.

#### Doporuceny smer

Pridat do templatingu moznost definovat lokalni opakovatelny pattern uvnitr jedne feature.

Jinymi slovy:

- ne dalsi samostatne komponenty pro `CategoryLevel2`, `CategoryLevel3`, ...
- ale jedna sablona patternu + seznam variant

#### Co by mel takovy system umet

Minimalni potreba:

- opakovat blok pro vice variant
- dosazovat jednoduche promenne
- umet odkaz na "predchozi level"
- umet special-case pro prvni nebo posledni prvek

Priklad mentalniho modelu:

- `CurrentLevel = 2,3,4,5`
- `ParentLevel = Company,2,3,4`
- `LevelValue = 2,3,4,5`
- `CurrentIdent = ITSMCategoryLevel{CurrentLevel}Ident`
- `ParentIdent = ITSMCompanyIdent / ITSMCategoryLevel{ParentLevel}Ident`

#### Co tim ziskame

- dramaticke snizeni copy-paste uvnitr velkych feature
- mensi riziko, ze se jedna varianta upravi a ostatni zustanou stare
- lepsi citelnost business zameru
- snadnejsi refaktor SQL, parameters i view wiringu

#### Co bych nedoporucil

Nedoporuceny smer:

- rozbit kazdy level do samostatne komponenty

Duvod:

- jeste vic by se rozpadla feature soudrznost
- pocet souboru by rychle narostl
- vazby mezi levely by byly hure citelne

#### Preferovany smer

Pro tento typ use-case se jako preferovany smer jevi:

- `JS/TS evaluation` pro slozitejsi patterny uvnitr feature

Duvod:

- nejde jen o opakovani, ale o parametrizovanou konstrukci
- rozdily mezi variantami jsou male, ale ne nulove
- objevuje se special-case logika pro prvni / posledni / mezilehle prvky
- pseudojazyk by se pravdepodobne rychle rozrostl o `if`, `for`, promenne a helpery
- je vyhodnejsi pouzit skutecny jazyk nez budovat horsi kopii programovaciho modelu

#### Doporuceny model

- XML komponenty zustanou pro bezne staticke skladani feature
- `JS/TS` vrstva bude urcena pro generovani slozitejsich opakujicich se struktur
- builder by mel umet sjednotit oba vstupy do stejneho vysledneho modelu

Mentalni rozdeleni:

- "vloz hotovy feature fragment" -> XML templating
- "vygeneruj serii podobnych bloku podle dat / pravidel" -> `JS/TS` evaluation

#### Opatrnost pri navrhu

Pokud se pujde cestou `JS/TS`, je vhodne drzet tuto vrstvu jako:

- build-time only
- bez side effectu
- s jasnym vstupem a vystupem
- idealne jako generator XML fragmentu nebo strukturovaneho modelu

Nedoporuceny smer:

- poustet libovolne skripty bez omezeni a bez jasneho kontraktu

To by zbytecne zhorsilo citelnost a predvidatelnost builderu.

#### Aktualni doporuceni

Toto je vhodne resit jako samostatnou vrstvu refaktoru:

- nejdriv stabilizovat feature / dependency model
- nasledne navrhnout lokalni pattern repetition system pro intra-feature opakovani

Prvni pilotni kandidat:

- `FolderGroupSegment`

Je to dobry kandidat, protoze:

- opakovani je zde velmi silne
- vzor je dobre citelny
- feature je casto pouzivana
- zisk ze zjednoduseni by byl okamzity

## Otevrene smerovani

Aktualni pracovni preference:

- zachovat XML komponenty
- zachovat business / feature orientaci
- rozdelovat jen uvnitr feature
- neprenest projekt do ciste technicke kategorizace

## Feature manifest authoring model

Pro feature manifests se jako vhodny smer jevi hybridni model:

- `*.feature.json` zustane podporovany jako explicitni, rucne ladena varianta
- pokud `*.feature.json` neexistuje, provede se automaticka stavba zakladniho manifestu primo z templating XML

Prakticky to znamena:

- system nebude vyzadovat JSON manifest pro kazdou feature hned od zacatku
- jednodussi feature budou moci fungovat pouze ze sve XML definice
- JSON manifest bude slouzit hlavne jako:
  - override
  - doplneni semantickych zavislosti
  - zpresneni summary / contribution-level popisu
  - misto pro rucni metadata, ktera z XML nejdou dobre dopoctit

### Doporuceny precedence model

1. Pokud existuje `*.feature.json`, je to primarni zdroj manifestu.
2. Pokud neexistuje, vytvori se auto-manifest z templating XML.
3. Casem muze existovat i kombinovany model:
   - XML -> auto-extract zakladu
   - JSON -> override / doplneni

### Co ma auto-manifest umet

Minimalni pozadavky:

- najit root feature definici
- najit vsechny `Contribution` / legacy `Section`
- zkusit dopoctit:
  - `parts`
  - zakladni `provides`
  - contribution-level summary
  - contribution target
  - contribution kind (`provide`, `extend-existing`, `placeholder`, `asset`, ...)

### Proc je to dulezite

- snizi se bariery pro zavedeni feature manifests
- nebude nutne rucne psat velke mnozstvi boilerplate JSON
- ergonomie zustane blizko samotnemu authoring XML
- detailni JSON pujde dopsat az tam, kde to bude opravdu potreba

### Aktualni preference

Preferovany smer:

- JSON podporovat dal
- ale nevyzadovat ho povinne
- vychozi chovani postavit jako "manifest by convention from XML"

## Templating naming rozhodnuti

Pro authoring templating vrstvy je preferovany novy naming:

- root `Feature`
- child `Contribution`
- soubory `*.feature.xml`

Legacy podpora zustane docasne zachovana pro:

- root `Component`
- child `Section`
- soubory `*.component.xml`

Prakticke pravidlo:

- nove soubory, dokumentace, priklady a generatory maji pouzivat pouze novy naming
- legacy naming zustava jen kvuli postupne migraci stavajicich sablon

## Kandidati na pilotni refaktor

Na pilotni navrh rozpadu dava smysl vzit jednu z techto feature:

- `Assign`
- `ReporterControls`
- `FolderGroupSegment`
- `Resolve`

Vyber by mel padnout na feature, ktera:

- je casto pouzivana
- je velka
- ma zretelny presah do `Form`, `WorkFlow` i `View`
