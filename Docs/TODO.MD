# TODO

Sem budeme prubezne zapisovat vylepseni pro pozdejsi implementaci.

## Backlog
1. [x] Pridat nastavitelny rezim `IncompleteMode` pro reference na tabulky, ktere nejsou v projektu.
2. [x] Rozsirit validaci `ident-incomplete`:
  - vracet detail, jak byl puvodni Ident rozdelen,
  - vracet informaci, zda nebyla nalezena ani primarni tabulka.
3. [x] Pridat snippety pro bezne `<Action>`.
4. Pridat moznost copy SQL for testing
  - Zkopiruje SQL dotaz spolecne s deklaraci parametru
    - Value se prebere z definice
    - Variable dosadi se dummy data
    - TableParameter ??
5. [x] `'text'` a `#text#` zustavaji podbarvene pri zakomentovani v SQL (`--` i `/* */`).
6. [x] Pridat pro SQL syntax highlight pro `UPDATE` (ruzova jako SSMS).
7. Opravit bug indexace, nekdy se deje ze se nektere soubory nezaindexuji (podezreni na castecny update indexu pri pridani using)
8. Implementovat validace pro zastupne znaky v SQL
9. Paralelizovat validacni worker (batch/worker pool) pro rychlejsi full revalidaci velkych projektu
