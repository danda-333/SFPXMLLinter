# TODO

Sem budeme prubezne zapisovat vylepseni pro pozdejsi implementaci.

## Backlog
1. Pridat nastavitelny rezim `IncompleteMode` pro reference na tabulky, ktere nejsou v projektu.
2. Rozsirit validaci `ident-incomplete`:
  - vracet detail, jak byl puvodni Ident rozdelen,
  - vracet informaci, zda nebyla nalezena ani primarni tabulka.
3. Přidat snippety pro bezne <Action>
4. Pridat možnost copy SQL for testing
  - Zkopíruje SQL dotaz společně s Declarací parametrů
    - Value se přebere z definice
    - Variable dosadi se dummy data
    - TableParamater ??
5. 'text' a #text# zustavaji podbarvene pri zakomentovani v SQL -- i /**/
