# XMLValidator - Průvodce pro AI

## Přehled

XMLValidator je konzolová aplikace pro validaci XML souborů Smart Form Platform (SFP). Provádí komplexní validaci včetně XSD schémat, struktury, atributů a business pravidel.

## Co validátor dělá

### 1. XSD Validace
- Validuje XML proti XSD schématům generovaným z C# modelů
- Kontroluje strukturu elementů
- Ověřuje názvy a typy atributů (včetně case-sensitivity)
- Podporuje polymorfní elementy s `xsi:type`

### 2. Rekurzivní Validace
- Automaticky validuje všechny vnořené elementy
- Podporuje kolizní názvy (např. `DataSource.Columns.Column` vs `Form.Indexes.Column`)
- Validuje polymorfní elementy (např. `<Control xsi:type="TextBoxControl">`)

### 3. Automatické CDATA Wrapping
- Před validací automaticky zabalí obsah těchto elementů do `<![CDATA[]]>`:
  - `<HTMLTemplate>` - Razor šablony v Report souborech
  - `<SQL>` - SQL dotazy s operátory `<`, `>`
  - `<Command>` - Příkazy
  - `<RawValue>` - Surové hodnoty
- **Důležité**: Originální soubor zůstává nezměněn, wrapping je pouze v paměti

### 4. Business Pravidla
- Validuje business logiku definovanou v `validation-rules.json`
- Kontroluje odkazy na jiné XML definice
- Ověřuje konzistenci dat

## Jak spustit validátor

### Build aplikace
```bash
cd /workspace/SFP.XMLValidator
dotnet build
```

### Spuštění validace
```bash
# Validace jednoho souboru
cd /workspace/SFP.XMLValidator/bin/Debug/net8.0
dotnet SFP.XMLValidator.dll <cesta-k-xml-souboru>

# Validace více souborů
dotnet SFP.XMLValidator.dll soubor1.xml soubor2.xml soubor3.xml

# Validace všech XML v adresáři
dotnet SFP.XMLValidator.dll /path/to/directory/*.xml
```

## Podporované typy XML

Validátor podporuje tyto typy SFP XML dokumentů:
- **Form** - Formuláře
- **DataView** - Datové pohledy
- **Filter** - Filtry
- **WorkFlow** - Workflow definice
- **Dashboard** - Dashboardy
- **Configuration** - Konfigurace
- **Library** - Knihovny
- **Report** - Reporty (s podporou Razor šablon)

## Výstup validace

### Úspěšná validace
```
=== SmartFormPlatform XML Validator ===

Validating: MyForm.xml
  ✓ No issues found

=== Summary ===
Files validated: 1
Errors: 0
Warnings: 0
```

### S chybami
```
Validating: MyForm.xml
  ERROR: The 'TitleResourcekey' attribute is not declared.
         at /Form/Controls/Control

  ERROR: The element 'TextBoxControl' has invalid child element 'DataSource'.
         List of possible elements expected: 'DataBind, SessionDataBind, Settings, Validations, DefaultDataSource, FilterConditions'.
         at /Form/Controls/Control

=== Summary ===
Files validated: 1
Errors: 2
Warnings: 0
```

## Časté chyby a jejich řešení

### 1. Chyba v názvu atributu (case-sensitivity)
```
ERROR: The 'TitleResourcekey' attribute is not declared.
```
**Řešení**: Oprav velikost písmen - správně je `TitleResourceKey` (velké 'K')

### 2. Neplatný potomek elementu
```
ERROR: The element 'TextBoxControl' has invalid child element 'DataSource'.
```
**Řešení**: `DataSource` musí být uvnitř `<FilterConditions>`, ne přímo pod kontrolou

### 3. XML parsing chyba
```
ERROR: The ',' character, hexadecimal value 0x2C, cannot be included in a name.
```
**Příčina**: C# kód v Razor šabloně není správně zabalen
**Řešení**:
- Zabal C# kód do `@{ }` bloku, např.:
  ```csharp
  @{
      IDictionary<string, object> itemDic = (IDictionary<string, object>)item;
  }
  ```
- Nebo použij CDATA (validátor to dělá automaticky pro HTMLTemplate, SQL, Command, RawValue)

### 4. Chybějící schéma
```
WARNING: XSD schema 'CustomElement' not found, skipping validation
```
**Příčina**: Pro daný element neexistuje XSD schéma
**Řešení**: Vygeneruj schémata pomocí XsdSchemaGenerator nebo element není standardní SFP element

## Příklady validace

### Příklad 1: Validace Filter souboru
```xml
<?xml version="1.0" encoding="utf-8"?>
<Filter xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Ident="MovieFilter">
    <Controls>
        <Control xsi:type="TextBoxControl"
                 Ident="Title"
                 DataType="String"
                 TitleResourceKey="Title_Movie">
            <FilterConditions>
                <DataSource>
                    <SQL><![CDATA[m.Title LIKE '%' + @Title + '%']]></SQL>
                </DataSource>
            </FilterConditions>
        </Control>
    </Controls>
</Filter>
```

**Validace**:
```bash
dotnet SFP.XMLValidator.dll MovieFilter.xml
```

### Příklad 2: Validace s chybami
```xml
<!-- CHYBNÝ XML -->
<Filter xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Ident="TestFilter">
    <Controls>
        <Control xsi:type="TextBoxControl"
                 Ident="TestControl"
                 IsNumberformat="true"           <!-- CHYBA: mělo by být IsNumberFormat -->
                 DataType="String"
                 TitleResourcekey="Test">        <!-- CHYBA: mělo by být TitleResourceKey -->
            <DataSource>                          <!-- CHYBA: mělo být ve FilterConditions -->
                <SQL>SELECT * FROM Table</SQL>
            </DataSource>
        </Control>
    </Controls>
</Filter>
```

**Výstup**:
```
ERROR: The 'IsNumberformat' attribute is not declared.
       at /Filter/Controls/Control
ERROR: The 'TitleResourcekey' attribute is not declared.
       at /Filter/Controls/Control
ERROR: The element 'TextBoxControl' has invalid child element 'DataSource'.
       at /Filter/Controls/Control
```

### Příklad 3: Report s Razor šablonou
```xml
<?xml version="1.0" encoding="utf-8"?>
<Report xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        Ident="TestReport"
        IsRazorEngine="true">
    <Sections>
        <Section xsi:type="TableSection">
            <HTMLTemplate>
                @{
                    List<dynamic> data = (List<dynamic>)Model.Data;
                }
                <table>
                    @foreach(var item in data)
                    {
                        @{
                            // SPRÁVNĚ: C# kód zabalen v @{ }
                            IDictionary<string, object> itemDic = (IDictionary<string, object>)item;
                        }
                        <tr>
                            <td>@itemDic["Name"]</td>
                        </tr>
                    }
                </table>
            </HTMLTemplate>
        </Section>
    </Sections>
</Report>
```

## Kdy použít validátor

### ✅ Použij validátor když:
1. **Vytváříš nový XML soubor** - ověř, že má správnou strukturu
2. **Upravuješ existující XML** - zkontroluj, že jsi nic nerozbil
3. **Kopíruješ/upravuješ elementy** - ujisti se, že názvy atributů jsou správně
4. **Vidíš runtime chyby** - validátor odhalí mnoho problémů před nasazením
5. **Migráceš XML na novou verzi** - zkontroluj kompatibilitu

### Workflow pro vytváření XML:
1. Vytvoř XML soubor
2. Spusť validátor: `dotnet SFP.XMLValidator.dll my-file.xml`
3. Oprav všechny ERROR
4. (Volitelně) Oprav WARNING
5. Znovu validuj dokud není čisté
6. Nasaď XML

## Důležité poznámky

### XSD Schémata
- Schémata jsou generována z C# modelů pomocí `XsdSchemaGenerator`
- Nachází se v `Schemas/` adresáři
- Pro každý model existuje odpovídající `.xsd` soubor
- Polymorfní elementy mají vlastní schémata (např. `TextBoxControl.xsd`, `ListBoxControl.xsd`)

### Polymorfní elementy
Elementy s `xsi:type` se validují podle jejich konkrétního typu:
```xml
<!-- Validuje se jako TextBoxControl, ne jako obecný Control -->
<Control xsi:type="TextBoxControl" Ident="MyControl" />
```

### Naming collisions
Pro elementy se stejným názvem v různých kontextech existují kvalifikovaná schémata:
- `DataSource.Columns.Column.xsd` - Column v DataSource
- `Form.Indexes.Column.xsd` - Column ve Form Indexes

### Case-sensitivity
XML je case-sensitive! Tyto atributy jsou různé:
- `TitleResourceKey` ✅ (správně)
- `TitleResourcekey` ❌ (chyba)
- `titleResourceKey` ❌ (chyba)

## Technické detaily

### Validační proces
1. **Load XML** - Načte soubor jako text
2. **CDATA wrapping** - Automaticky zabalí HTMLTemplate, SQL, Command, RawValue do CDATA (pouze v paměti)
3. **Parse XML** - Parsuje upravený XML do XDocument
4. **Detect type** - Zjistí typ XML z root elementu
5. **XSD validation** - Validuje root element proti hlavnímu schématu
6. **Recursive validation** - Rekurzivně validuje všechny vnořené elementy
7. **Deserialization** - Deserializuje do C# objektu
8. **Business rules** - Aplikuje business pravidla z validation-rules.json
9. **Report results** - Vypíše všechny chyby a varování

### Exit kódy
- `0` - Validace úspěšná (žádné chyby)
- `1` - Validace selhala (obsahuje chyby)

### Soubory
- **Vstup**: XML soubor(y) k validaci
- **Schémata**: `Schemas/*.xsd` (XSD schémata)
- **Pravidla**: `validation-rules.json` (business pravidla)
- **Log**: Výstup do konzole (lze přesměrovat: `> output.txt`)

## Příklad použití v konverzaci s AI

**Uživatel**: "Vytvořil jsem nový Filter XML soubor, můžeš zkontrolovat, jestli je v pořádku?"

**AI odpověď**:
```
Použiji XMLValidator k validaci tvého Filter souboru.

[spustí validátor]

Validátor našel tyto problémy:
1. Atribut 'TitleResourcekey' není deklarován - správně by měl být 'TitleResourceKey' (velké K)
2. Element 'DataSource' není povolen přímo pod 'TextBoxControl' - musí být uvnitř 'FilterConditions'

Chceš, abych ti ukázal opravu?
```

## Řešení problémů

### Validátor nenajde schéma
```bash
# Zkontroluj, že jsi ve správném adresáři
cd /workspace/SFP.XMLValidator/bin/Debug/net8.0

# Zkontroluj, že Schemas/ adresář existuje
ls -la Schemas/

# Zkopíruj schémata, pokud chybí
cp -r /workspace/SFP.XMLValidator/Schemas ./
```

### Validátor hlásí parsing chybu u Report souboru
- Report s Razor kódem MUSÍ mít `IsRazorEngine="true"`
- C# kód v Razor šablonách musí být správně zabalen v `@{ }`
- Validátor automaticky zabalí HTMLTemplate do CDATA, ale syntaxe uvnitř musí být správná

### Database connection chyby při business rules validaci
```
WARNING: Rule execution failed: Při vytváření připojení k systému SQL Server došlo k chybě...
```
Toto je WARNING, ne ERROR - validátor nemůže spustit business pravidla bez DB připojení, ale XSD validace proběhla v pořádku.

## Shrnutí pro AI

Když uživatel vytvoří nebo upraví XML soubor:
1. Vždy doporuč spustit validátor
2. Zkontroluj cestu k souboru
3. Spusť: `dotnet SFP.XMLValidator.dll <cesta-k-souboru>`
4. Vyhodnoť výsledky a pomoz opravit chyby
5. Zvláště kontroluj case-sensitivity a strukturu elementů
6. Pro Report soubory upozorni na správnou Razor syntaxi
