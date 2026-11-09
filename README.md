# Musikkapp

PWA-shell for bladlesing, metronom, øveplan og notekort.

Fire plassholdere, mørkt tema og bunnmeny. Hvert verktøy har eget `localStorage`-navn (`musikkapp.<verktøy>`).

## Verktøy
- **Notekort**: Øv notelesing på G- og F-nøkkel. Velg noter, drill med umiddelbar tilbakemelding og statistikk. Svar-timer (420 ms) fortsetter ved fanebytte så kortet ikke henger. Toast forsvinner etter 2,6 s.
- **Øveplan**: Melodisk øveplan med blokker (2-mallet, 4-mallet, Bladlesing, Repertoar), presets, nedtelling og logg. Timer og metronom stoppes når man forlater siden. Lagres i `musikkapp.oveplan`.

