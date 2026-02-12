# Implementation Plan: SFP XML Formatter (Tolerant v2)

## Cile
- Vytvorit novy formatter bez puvodniho custom regex parseru.
- Zachovat tolerantni chovani i nad nevalidnim XML nestingem.
- Zachovat vnitrni obsah `SQL`, `SQLCommand` a `HTMLTemplate` (pouze relativni posun bloku).
- Poskytnout stabilni, predvidatelny vystup pro realne SFP XML soubory.

## Schvalena rozhodnuti
1. Podpora pouze `@FormatRule` (bez varianty s typem).
2. Scope pravidla: pouze bezprostredne nad nejblizsim elementem (`nearest element only`).
   - Chce-li se pravidlo aplikovat na XML komentar, musi byt `@FormatRule` v samostatnem komentari bezprostredne nad nim.
   - Komentare `@Ignore` a `@FormatRule` se budou vzdy formatovat dle standardnich pravidel.
3. Pri nevalidnim XML default fallback `inline`.
4. Atribut ordering: `type`/`xsi:type` bude defaultne prvni.
5. `SQL`/`SQLCommand`/`HTMLTemplate`: bez vnitrniho reformatovani, jen uprava leading whitespace na zacatku radku.
   - Toto chovani pujde explicitne potlacit `@FormatRule`.
6. Podporena pravidla:
   - `<!-- @FormatRule:disable -->`
   - `<!-- @FormatRule:preserve-inner -->`
   - `<!-- @FormatRule:format-inner -->`
   - `<!-- @FormatRule:no-type-first -->`
   - `<!-- @FormatRule:no-attr-normalize -->`
   - `<!-- @FormatRule:no-inline-text-normalize -->`
   - `disable` vypina kompletni formatovani ciloveho elementu (vsechny casti).
   - `@FormatRule` umi vice pravidel najednou oddelenych carkou nebo mezerou.
7. Release strategie: nejdriv samostatny command (opt-in), ne default provider.
8. Parser recovery: tolerantni, bez padu, s logovanim recoveries.
9. Test data: zjednodusene fixture XML (A1, B1, B2, C...).
10. Puvodni formatter se nebude dale implementovat ani migrovat.
11. Implementovat rovnou oba prikazy:
   - `Format Document`
   - `Format Selection`

## Architektura
1. Tokenizer
- Rozpoznani tokenu: opening tag, closing tag, self-closing tag, text, comment, CDATA.
- Pozicni metadata (start/end) pro spolehlive mapovani.

2. Tolerantni parser
- Stack-based build stromu.
- Pri mismatch:
  - uzel oznacit jako `invalid/orphan`,
  - pokracovat parserem dal bez hard fail.

3. Formatter engine
- Validni uzly:
  - normalni odsazeni dle hloubky,
  - normalizace whitespace atributu,
  - `type`/`xsi:type` first,
  - force-inline atributu (konfigurovatelne v kodu formatteru).
- Nevalidni uzly:
  - inline fallback render.

4. Specialni bloky
- `SQL`, `SQLCommand` a `HTMLTemplate`:
  - text uvnitr zustane beze zmen,
  - meni se pouze whitespacy na zacatku radku podle cilove urovne.
- `@FormatRule`:
  - `disable`: vypnout kompletni formatter pro nejblizsi element.
  - `preserve-inner`: neformatovat vnitrni obsah nejblizsiho elementu.

## Implementacni faze
### Faze F1: Tokenizer
- Implementace lexeru + unit testy tokenizace.

### Faze F2: Tolerantni strom
- Implementace parseru s recovery.
- Oznaceni invalid/orphan stavu.

### Faze F3: Serializer
- Render validnich uzlu + inline fallback invalidnich.
- Atributova normalizace a `xsi:type` first.

### Faze F4: SQL/SQLCommand/HTMLTemplate + FormatRule
- Preserve-inner logika.
- `@FormatRule:disable` a `@FormatRule:preserve-inner`.

### Faze F5: VS Code command integrace
- Novy command: `SFP XML Linter: Format Document (Tolerant)`.
- Novy command: `SFP XML Linter: Format Selection (Tolerant)`.
- Output log:
  - pocet recoveries,
  - pocet fallback renderu,
  - cas behu formatteru.

### Faze F6: Golden testy
- Zavest fixture sadu na zjednodusenych XML.
- Snapshot testy pred/po.

## Testovaci sada (zjednodusene fixture)
1. `01-valid-basic.xml`
- Jednoducha validni struktura A1/B1/C1.

2. `02-invalid-nesting.xml`
- Mismatch nesting:
  - `<A1><B1><A1><B2></B2></A1></A1>`

3. `03-orphan-closing.xml`
- Samostatny navic closing tag.

4. `04-self-closing-mixed.xml`
- Kombinace self-closing a normal elementu.

5. `05-attributes-order.xml`
- Mix atributu, overeni `xsi:type` first.

6. `06-whitespace-normalization.xml`
- Nadbytecne mezery, vice radku atributu.

7. `07-sql-preserve-inner.xml`
- SQL blok s vlastnim odsazenim a placeholdery.

8. `08-sqlcommand-preserve-inner.xml`
- SQLCommand blok s vlastnim odsazenim a placeholdery.

9. `09-htmltemplate-preserve-inner.xml`
- HTMLTemplate blok s vice radky a nested HTML.

10. `10-formatrule-disable.xml`
- `@FormatRule:disable` na elementu.

11. `11-formatrule-preserve-inner.xml`
- `@FormatRule:preserve-inner` na elementu.

12. `12-comments-and-cdata.xml`
- Komentare, CDATA, kombinovane scenare.

13. `13-large-mixed.xml`
- Delsi soubor s validnimi i nevalidnimi castmi.

## Definition of Done
- Formatter nepadne na nevalidnim XML a vrati stabilni vystup.
- `SQL`/`SQLCommand`/`HTMLTemplate` vnitrni obsah zustane beze zmen.
- `@FormatRule` funguje na nejblizsi element.
- Golden testy prochazeji stabilne.
- `Format Document` i `Format Selection` command funguje ve VS Code a loguje metriky.
