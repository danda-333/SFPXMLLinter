# Implementation Plan: VS Code IntelliSense pro SFP XML

## Cil
Vytvorit VS Code rozsireni, ktere poskytne inteligentni napovedu pro SFP XML nad slozkami:
- `SFPDocs` (specifikace a konvence)
- `SFPExampleProject` (realne XML a sablony)

MVP musi umet:
1. Nabizet povolene XML elementy a atributy podle kontextu.
2. Nabizet a validovat `Ident` reference (napr. WorkFlow -> Form Controls/Buttons).
3. Rozumet `Using` a komponentam (`XML_Components`) vcetne sekci.

## Rozsah MVP
- Completion:
  - elementy
  - atributy
  - hodnoty enumu (`xsi:type`, `DataType`, `Insert`...)
  - hodnoty referenci (`Ident`, `FormIdent`, `Component`, `Section`)
- Diagnostics:
  - neznamy element/atribut
  - neexistujici reference (`FormControl Ident`, `Button Ident`, `Using Component/Section`)
- Navigation:
  - `Go to Definition` pro `Ident` reference a komponenty

## Architektura rozsireni
1. `Model` (staticka pravidla)
- Struktura povolenych rootu, child elementu, atributu, enumu.
- Zdroj: `SFPDocs/entities/*.md`, `SFPDocs/common/*.md`, `SFPDocs/xml-conventions.md`.

2. `Indexer` (semantika workspace)
- Sken XML souboru a extrakce symbolu:
  - Forms: Controls, Buttons, Sections
  - WorkFlows: Step/Group reference
  - Components: sekce a metadata pro `Using`
- Inkrementalni refresh pri zmene souboru.

3. `Language features`
- Completion provider (pozice kurzoru + kontext)
- Diagnostics provider (na zmenu dokumentu a indexu)
- Definition provider (skok na deklaraci)

4. `Parser` (tolerantni)
- Musi prezit nevalidni XML v `SQL`, `HTMLTemplate`, `Command`.
- Chovani navazat na pristup pouzity v `SFPExampleProject/Scripts/BuildXmlTemplates.ps1`.

## Implementacni faze
### Faze 1: Foundation
- Scaffold VS Code extension (TypeScript).
- Nastaveni build/lint/test.
- Registrace aktivace pro XML soubory.
- Vystup: bezici extension + prazdne providery.

### Faze 2: Staticke completion
- Implementace pravidel element/atribut/enum completion.
- Kontext podle parent elementu.
- Vystup: fungujici IntelliSense bez referencni semantiky.

### Faze 3: Workspace indexer
- Extrakce symbolu z Form/WorkFlow/Component XML.
- Cache + invalidace pri zmenach.
- Vystup: interni symbol tabulka projektu.

### Faze 4: Referencni completion + diagnostics
- `FormControl Ident` -> nabidka z ciloveho Form.
- `Button Ident` -> nabidka z Form Buttons.
- `Using Component` + sekce -> nabidka a validace.
- Vystup: plna MVP semantika.

### Faze 5: Go to Definition
- Skok z reference na deklaraci:
  - WorkFlow control/button -> Form definice
  - Using component/section -> soubor komponenty
- Vystup: zakladni navigace mezi XML.

### Faze 6: Stabilizace
- Testy na fixture z `SFPExampleProject/XML` a `SFPExampleProject/XML_Templates`.
- Vykon: kontrola velkeho workspace.
- Dokumentace pouziti a omezeni.

## Kvalitativni pravidla
- Vsechen kod pise Codex (zadny rucni zasah mimo schvaleni zmen).
- Kod v anglictine, dokumentace a komentare strucne a vecne.
- Zadne destruktivni operace nad repem.
- Zpetna kompatibilita: extension nesmi menit XML obsah uzivatele.

## Definition of Done (MVP)
- Completion funguje kontextove pro zakladni SFP XML strukturu.
- Reference `Ident` a `Using` maji navrhy + diagnostiku.
- `Go to Definition` funguje pro hlavni reference.
- Otestovano na realnych souborech v `SFPExampleProject`.
- V repu je strucny navod ke spusteni a vyvoji extension.

## Rizika a mitigace
1. Nevalidni XML v sablonach
- Mitigace: tolerantni parser + encode/decode specifickych tagu.

2. Vykon nad velkym projektem
- Mitigace: inkrementalni index, cache, debounce.

3. Nejasna pravidla v docs
- Mitigace: fallback na best-effort completion + prubezne doplneni modelu.

## Nasledujici krok
Zacneme Fazi 1 a pripravime kostru extension (`src/`, `package.json`, zaklad provideru) tak, aby slo hned iterovat na completion.