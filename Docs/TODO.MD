# TODO

Sem budeme prubezne zapisovat vylepseni pro pozdejsi implementaci.

## Backlog
1. [x] Pridat nastavitelny rezim `IncompleteMode` pro reference na tabulky, ktere nejsou v projektu.
2. Rozsirit validaci `ident-incomplete`:
  - vracet detail, jak byl puvodni Ident rozdelen,
  - vracet informaci, zda nebyla nalezena ani primarni tabulka.
3. PÅ™idat snippety pro bezne <Action>
4. Pridat moÅ¾nost copy SQL for testing
  - ZkopÃ­ruje SQL dotaz spoleÄnÄ› s DeclaracÃ­ parametrÅ¯
    - Value se pÅ™ebere z definice
    - Variable dosadi se dummy data
    - TableParamater ??
5. 'text' a #text# zustavaji podbarvene pri zakomentovani v SQL -- i /**/
6. PÅ™idat pro SQL syntax higlhligt pto UPDATE (rouzova jako SSMS)
7. Opravit bug indexace, nekdy se deje ze se nektere soubory nezaindexuji (podezrivam z toho castecny update indexu pri pridani using)
8. Implementovat validace pro zÃ¡stupnÃ© znaky v SQL
9. Paralelizovat validacni worker (batch/worker pool) pro rychlejsi full revalidaci velkych projektu
