# Musikkapp

**Musikkapp** er en Progressive Web App (PWA) for øving på **melodisk slagverk** (marimba, vibrafon, xylofon, klokkespill, skarptromme/rudimenter) og **B-trompet**, inkludert **duett-samspill** mellom trompet og slagverk. Appen samler fire øveverktøy i et mørkt, kontrastrikt grensesnitt tilpasset notestativet — med felles lydkjerne, global øveplanklokke og sanntids skjerm-synkronisering mellom enheter.

---

## Innhold

- [Instrumentprofiler (`Køller` / `Trompet`)](#instrumentprofiler-køller--trompet)
- [Verktøy](#verktøy)
  - [1. Bladlesing (`/`) — Mallet & Trumpet Sight Reader](#1-bladlesing---mallet--trumpet-sight-reader)
  - [2. Metronom (`/metronom`)](#2-metronom-metronom)
  - [3. Øveplan (`/oveplan`)](#3-øveplan-oveplan)
  - [4. Notekort (`/notekort`)](#4-notekort-notekort)
- [Skjerm-synkronisering (Multi-device Sync)](#skjerm-synkronisering-multi-device-sync)
- [Arkitektur og tekniske detaljer](#arkitektur-og-tekniske-detaljer)
  - [Felles lyd- og metronomkjerne (`MusikkPulse`)](#felles-lyd--og-metronomkjerne-musikkpulse)
  - [Lokal lagring (`localStorage`)](#lokal-lagring-localstorage)
  - [iPadOS 15 / Safari 15.6-kompatibilitet](#ipados-15--safari-156-kompatibilitet)
  - [PWA og offline-støtte](#pwa-og-offline-støtte)
- [Prosjektstruktur](#prosjektstruktur)
- [Utvikling og testing](#utvikling-og-testing)

---

## Instrumentprofiler (`Køller` / `Trompet`)

Appen støtter to instrumentprofiler som velges ved oppstart eller byttes via profilknappen i toppfeltet (`src/lib/profile.ts`):

- **Køller (`mallets`)**: Marimba, xylofon, vibrafon og klokkespill med 2–4 køller, grep, virvler og slagverks-øveplan.
- **Trompet (`trumpet`)**: B-trompet (korps og kulturskole) med ventilgrep (`0`, `1`, `1-2`, …), B-transponert trompetlyd, skjulte køllevalg i bladlesing, egne korps-øveplaner og øvingsinstruksjoner under metronomen.

Hver profil har separat lagring i `localStorage` (`musikkapp.<verktøy>` for køller, `musikkapp.trumpet.<verktøy>` for trompet).

---

## Verktøy

### 1. Bladlesing (`/`) — Mallet & Trumpet Sight Reader

Prosedural generator og avspiller for bladlesingsetyder (`v1.4`) for **2, 3 og 4 køller**, **B-trompet**, og **duett-samspill mellom trompet og slagverk**:

- **Instrumenter**: *Klokkespill*, *Xylofon*, *Vibrafon*, *Marimba 4.3*, *Marimba 5.0* og *Trompet (B)* (med korrekt skrevet vs. klingende transponering og automatisk begrensning til instrumentets faktiske omfang). I trompet-profilen skjules kølle- og flerstemmighetsvalg automatisk.
- **Nivåer (1–10)**: Hurtigvalg i toppbaren eller skuffen som gradvis introduserer mer komplekse rytmer, pauser, sprang, bindebuer, synkoper, løse fortegn og dynamikk.
- **Duett & Samspill (`Trompet i B` + `Slagverk i C`)**:
  - Aktiveres via **Duett**-knappen i toppbaren eller under *Innstillinger → Duett*.
  - Genererer tostemmige etyder med automatisk transponering (trompet i B-stemme, slagverk i konserttoneart C) og tydelig toneartsvisning for begge instrumenter.
  - **Tre duett-stiler**: *Terser & sekster* (`harmony` med konsonant kontrapunkt og akkorder ved kadenser), *Ekkolek* (`call_response` med spill og svar) og *Melodi & komp* (`melody_comp` der trompet leder melodien og slagverk akkompagnerer).
  - **Visning og hurtigvalg**: Duett-verktøylinjen lar deg bytte mellom *Partitur* (begge stemmer, med automatisk nøkkelbytte mellom G- og F-nøkkel på marimba), *Trompet (B)* og *Slagverk (C)*, velge slagverksinstrument og antall køller (`2`, `3`, `4`), slå av/på akkorder (*Tillat akkorder*), justere separate toneomfang for trompet og slagverk, samt dempe hver stemme individuelt (*Makker-lyd*).
- **Skreddersydde innstillinger** (via *Innstillinger*-skuffen):
  - **Instrument**: Antall køller (`2`, `3`, `4`), notebilde (monofonisk linje, akkorder i linjen med valgbar sannsynlighet, dobbeltgrep, treklanger/akkorder), tillatte intervaller og plassering for andre kølle (*Under*, *Over*, *Begge deler*), samt notesystem (*Auto*, *G-nøkkel*, *F-nøkkel*, *Pianosystem*). For 4 køller kan man styre akkordleie (*Tett* eller *Åpen* med kvinter i venstre hånd), toner per akkord (`3`, `4` eller blanding), største intervall i én hånd og største grepsflytt.
  - **Rytme**: Rytme-presets (*Alle*, *Lange*, *Enkle*, *Punkterte*, *Trioler*, *Korte*), individuelle noteverdier (helnote til trettitodel samt fjerdedels-, åttendels- og sekstendelstrioler), pauser, rytmetetthet (`1–5`), synkoper og bindebuer (samt legato-buer for trompet).
  - **Register**: Nedre og øvre grense i skrevet tonehøyde (`C2`–`C8`, eller separate glidere for trompet og slagverk i duett) og største tillatte melodiske sprang (fra sekund til duodesim).
  - **Toneart**: Alle dur- og harmonisk moll-tonearter. Én valgt toneart holdes fast; ved to eller flere roterer generatoren rundt kvintsirkelen (færrest fortegn først). Støtter løse fortegn (kromatiske nabotoner) samt valg for å starte og/eller slutte på grunntonen.
  - **Mer**: Taktart (`4/4`, `3/4`, `2/4`, `2/2`, `6/8`, `3/8`, `5/8`, `7/8`), antall takter (`4`, `8`, `12`, `16`), tempo (`40–160 BPM`), aksenter, staccato, dynamikk, virvler (*Av*, *Lange toner*, *Ofte*), visning av tonenavn og køllenummer/ventilgrep.
- **Avspilling og øving**:
  - Notebildet tegnes med `abcjs` med zoom-kontroller (`−`/`+`).
  - **Spill** spiller av etyden med samplede instrumenter (MP3-samples for marimba, vibrafon, xylofon, klokkespill og trompet, med syntetisert Web Audio-fallback). I duett forhåndslastes både trompet- og slagverk-samples.
  - **Igjen** starter samme etyde på nytt i litt lavere tempo.
  - Integrert med **Øveplan**: Hvis en *Bladlesing*-blokk står klar eller på pause i øveplanen, gjenopptas blokkens nedtelling automatisk når du trykker **Spill**.

### 2. Metronom (`/metronom`)

To moduser som huskes i `musikkapp.metronom` (eller `musikkapp.trumpet.metronom`):

- **Metronom (`PlainMetronome`)**:
  - Tempo fra `40` til `240 BPM`, taktarter (`4/4`, `3/4`, `2/4`, `6/8`) og underdelinger (*Slag*, *2*, *Triol*, *4*).
  - Visuell slagindikator med tydelig markert ener.
  - **Samspill med Øveplan**: Når en øvingsblokk med metronom er aktiv i Øveplan, kobles Metronom-fanen automatisk til blokken og viser farget etikett med blokknavn (`<Blokknavn> · N slag`), slik at tempo, taktart og start/pause styrer selve øveplanblokken.
  - **Øvingsinstruksjoner (Trompet)**: I trompet-profilen vises tilpassede instruksjonskort under metronomen for den aktive øveplanblokken (`TRUMPET_EXERCISES`).
- **Rudiment (`SnareSpeed`)**:
  - Progressiv hastighetstrener for rudimenter: *Singles (RLRL)*, *Doubles (RRLL)*, *Paradiddle (RLRR LRLL)*, *Flam (lR rL)* og *Accented Singles*.
  - Konfigurerbar start-BPM (`40–300`), økning per steg (`1–10 BPM`), antall takter per steg (`1–32`) og underdeling (*Fjerdedel*, *Åttendel*, *Sekstendel*).
  - Viser aktiv sticking (`R`/`L`) i sanntid og lar deg registrere **Merk ren** (lagrer personlig beste-BPM per rudiment) eller **Merk brutt**.

### 3. Øveplan (`/oveplan`)

Strukturert øveøkt med fire fargekodede blokker (navn og standardtid tilpasses valgt instrumentprofil):

| Blokk-ID | Køller-navn (standardtid) | Trompet-navn (standardtid) | Farge | Koblet verktøy |
| :--- | :--- | :--- | :--- | :--- |
| `twomallet` | **2-mallet** (12 min) | **Oppvarming** (3 min) | Turkis (`#7ee0d6`) | Åpner `/metronom` og starter metronomen |
| `fourmallet` | **4-mallet** (8 min) | **Teknikk & skala** (4 min) | Blå (`#8aa4ff`) | Åpner `/metronom` og starter metronomen |
| `srf` | **Bladlesing** (12 min) | **Bladlesing** (4 min) | Gull (`#e0b15a`) | Åpner `/` (Bladlesing) |
| `rep` | **Repertoar** (15 min) | **Korpslekse** (5 min) | Oransje (`#e89b6d`) | Ingen automatisk verktøynavigasjon |

- **Global planklokke (`src/lib/plan-clock.ts`)**:
  - Nedtelling og metronom fortsetter når du navigerer mellom faner. Gjenværende tid beregnes fra tidsstempel (`blockEndsAt`), slik at nedtellingen holder seg nøyaktig selv om fanen har vært i bakgrunnen.
  - **Statuspille i toppfeltet (`PlanHeaderTimer`)**: Viser aktiv blokk og gjenværende tid i alle verktøy, med ett-trykks pause/fortsett.
  - Husker sist brukte tempo per blokk (`bpmMap`), støtter tap-tempo (**Bank**), valg av takter (`2–7`) og underdeling (*Fjerdedel*, *Åttendel*, *Triol*).
- **Presets og øvelogg**:
  - Lagre opptil 8 egendefinerte **presets** (kombinasjoner av aktive blokker og minutter). Trompet-profilen leveres med ferdige presets (*Kjapp 10 min*, *Korpsøkt 16 min*, *Superøkt 25 min*).
  - **Logg** lagrer opptil 60 økter med dato/klokkeslett, total spilletid, fullførte blokker og fritekstnotater.
  - Automatisk dagnulstilling (`rollSession`) ved ny dag, og **Screen Wake Lock API** som holder skjermen våken mens en blokk eller metronomen kjører.

### 4. Notekort (`/notekort`)

Flashcard-trening for notelesing i **G-nøkkel** og **F-nøkkel**:

- **Øv-fane**:
  - Trekker tilfeldige kort fra valgt noteutvalg uten å gjenta samme note to ganger på rad.
  - Svar via knapper på skjermen eller tastaturet (`C`, `D`, `E`, `F`, `G`, `A`, `B`/`H`).
  - Ved riktig svar går neste kort automatisk etter `420 ms` (timeren fullføres selv om du bytter fane, slik at kortet aldri blir hengende låst). Ved feil svar vises riktig note med oktav før du klikker videre.
- **Noter-fane**:
  - **Instrument-presets**: Setter noteutvalget direkte til instrumentets skrevne register (*Klokkespill*, *Xylofon 3,5*, *Xylofon 4*, *Vibrafon 3*, *Marimba 4,3*, *Marimba 4,5*, *Marimba 5*). Noter under G-nøkkelens område legges automatisk i F-nøkkel.
  - **Nøkkel-presets**: Velg *I systemet*, *Under systemet*, *Over systemet*, *Alle*, *Tøm* eller enkeltnoter gruppert per oktav.
  - **Treff per note**: Viser de 14 notene med lavest treffprosent sortert etter feilrate og antall forsøk.
  - **Notenavn**: Bytt mellom **Norsk (`H`)** og **Engelsk (`B`)**, og nullstill statistikk uten å miste noteutvalget. Toast-meldinger forsvinner automatisk etter `2,6 s`.

---

## Skjerm-synkronisering (Multi-device Sync)

Via **Synk**-knappen i toppfeltet kan to eller flere enheter kobles sammen i sanntid ved hjelp av **Supabase Realtime** (Broadcast og Presence):

- **Roller**:
  - **Fjernkontroll (`controller`)**: Typisk en mobiltelefon ved instrumentet. Du styrer øveplan, metronom og bladlesing, og lyden dempes automatisk lokalt (`audioActive: false`) for å unngå dobbeltklikk/ekko.
  - **Skjerm / Følger (`display`)**: Typisk en iPad eller Mac på notestativet. Skjermen bytter automatisk fane til riktig verktøy, følger blokkens nedtelling og spiller av metronom/lyd (`audioActive: true`).
- **Romkoder**: Opprett et nytt rom (f.eks. `NOTE-123` eller `TAKT-456`) eller skriv inn koden på den andre enheten. Rom og rolle lagres i `musikkapp.sync`, og appen kobler seg automatisk til igjen ved oppstart.
- **Synkroniserte hendelser**:
  - **Øveplan**: `PLAN_START`, `PLAN_ARM`, `PLAN_PAUSE`, `PLAN_RESUME`, `PLAN_STOP`, `PLAN_NAVIGATE` (inkludert sanntids oppdatering når blokkvarighet endres med `+`/`−`).
  - **Metronom**: `METRO_SET`, `METRO_START`, `METRO_STOP` (tempo, taktart, underdeling og start/stopp).
  - **Bladlesing & Profil**: `SIGHT_SET`, `SIGHT_ACTION` (`generate`, `togglePlay`, `toggleMetro`, `again`), `PROFILE_SET` og `SYNC_REQUEST` (synkroniserer gjeldende tilstand når en ny skjerm kobler til).
- **Konfigurasjon**: Bruker forhåndskonfigurert Supabase-prosjekt som standard, men kan overstyres med miljøvariabler (`VITE_SUPABASE_URL` og `VITE_SUPABASE_ANON_KEY`) eller direkte under *Supabase-innstillinger* i synk-dialogen.

---

## Arkitektur og tekniske detaljer

### Felles lyd- og metronomkjerne (`MusikkPulse`)

All lyd i appen går gjennom `src/lib/pulse.ts` (også eksponert som `window.MusikkPulse` for Bladlesing):

- **Én `AudioContext` og én aktiv eier**: Kun én lydkilde (`"metronom" | "snare" | "oveplan" | "bladlesing"`) kan eie pulsen om gangen. Når en ny eier starter, stoppes den forrige rent (`reason: "replaced"`) og utgangsbussen kuttes umiddelbart.
- **Lookahead-scheduler**: Planlegger klikk `100 ms` frem i tid med `25 ms` intervall for stabil timing.
- **Håndtering av klokkehopp (`LATE_S = 50 ms`)**: Hvis en bakgrunnsfane eller dvale gjør at lydklokka hopper fremover, hoppes tapte klikk over i stedet for å spilles av i én skarp salve, samtidig som plasseringen i takten (og ener-aksenten) bevares.
- **iOS / iPadOS låseskjerm og stall-deteksjon (`STALL_MS = 600 ms`)**: Hvis operativsystemet suspenderer eller avbryter (`interrupted`) `AudioContext` når skjermen låses, forsøker `pulse.ts` først én automatisk `resume()`. Hvis lydklokka fortsatt står stille, stoppes avspillingen med status `"stalled"`, en eventuell aktiv øveplanblokk settes på pause uten å miste gjenværende tid, og neste trykk på **Start**/**Spill** bytter ut lydkonteksten inne i selve brukergesten (`unlock()` / `renew()`).

### Lokal lagring (`localStorage`)

Appen krever verken brukerkonto eller database for vanlig bruk. All tilstand lagres lokalt i nettleseren under egne navnerom (for trompet-profilen brukes prefikset `musikkapp.trumpet.<verktøy>`):

| Nøkkel | Verktøy / Modul | Innhold |
| :--- | :--- | :--- |
| `musikkapp.profile` | Instrumentprofil | Valgt profil (`mallets` eller `trumpet`). |
| `musikkapp.bladlesing` | Bladlesing | Instrument, køller, nivå, rytmer, tonearter, register, duettvalg og visningsvalg (migrerer også eldre `mallet-sr-settings-v3`). |
| `musikkapp.metronom` | Metronom & Rudiment | Valgt modus (`metro`/`rudiment`), BPM, taktart, underdeling og beste-BPM per rudiment (`bests`). |
| `musikkapp.oveplan` | Øveplan | Blokker (`items`), fullførte blokker for dagen (`done`), øvelogg (`log`), presets (`presets`), `sessionDate`, `bpmMap`, `bpm`, `beats` og `sub`. |
| `musikkapp.notekort` | Notekort | Valgte noter i G- og F-nøkkel (`sel`), språk for notenavn (`lang`: `no`/`en`) og treffstatistikk per note (`stats`). |
| `musikkapp.sync` | Skjerm-synkronisering | Enhets-ID, enhetsnavn, rolle (`controller`/`display`), lydstatus (`audioActive`), romkode og Supabase-nøkler. |

### iPadOS 15 / Safari 15.6-kompatibilitet

Mange musikere bruker eldre iPad-modeller på notestativet. Prosjektet bygger og verifiserer eksplisitt mot **Safari 15.6 (iPadOS 15.8)**:

- `vite.config.ts` kompilerer klient-JS og CSS (via Lightning CSS) mot `["chrome111", "edge111", "firefox114", "safari15.6"]`, slik at bl.a. moderne media-range-syntaks transponeres ned.
- Blokkfarger i `src/styles.css` og `src/lib/oveplan.ts` definerer egne RGB-kanaler (`--color-twomallet-rgb` osv.) og bruker `rgb(var(--block-rgb) / alpha)` fremfor `color-mix()`, slik at fargeetiketter og statuspillen i toppfeltet beholder full lesbarhet og kontrast i Safari 15.
- Automatisert sjekk i `e2e/safari15-css.test.mjs` og `e2e/app.e2e.test.mjs` verifiserer bygget CSS og kontrast.

### PWA og offline-støtte

- `public/manifest.webmanifest` og `public/sw.js` gir støtte for installasjon på Hjem-skjerm (*Legg til på Hjem-skjerm* på iOS/iPadOS eller *Installer*-knappen i støttede nettlesere).
- Service Worker mellomlagrer app-skallet (`/`, manifest, ikoner) og statiske `.js`/`.css`-ressurser med *network-first*-strategi og offline-fallback.

---

## Prosjektstruktur

```text
├── public/
│   ├── malletsight/           # Bladlesing (Mallet & Trumpet Sight Reader v1.4)
│   │   ├── abcjs.js           # Notegjengivelse (SVG)
│   │   ├── theory.js          # Musikkteori, skalaer, instrumenter, transponering og ABC-staving
│   │   ├── generator.js       # Prosedural etyde- og duettgenerator (2–4 køller, trompet, nivå 1–10)
│   │   ├── renderer.js        # Layout, duett-partitur og visuell markering av aktivt slag
│   │   ├── audio.js           # Sample- og syntesebasert avspilling via MusikkPulse
│   │   ├── app.js             # UI-logikk og innstillingsskuff for Bladlesing og Duett
│   │   ├── markup.html        # HTML-mal for Bladlesing og Duett-verktøylinje
│   │   ├── sample-*.mp3       # Instrument-samples (marimba, vibes, xylo, glock, trumpet)
│   │   └── tests/             # Enhetstester (generator, duett, tonehøyde, nøkler, køller)
│   ├── manifest.webmanifest   # PWA-manifest
│   └── sw.js                  # Service Worker for offline-caching
├── src/
│   ├── components/
│   │   ├── shell.tsx          # App-skall med toppfelt, profilvelger, PlanHeaderTimer, Synk og bunnmeny
│   │   ├── malletsight.tsx    # React-innpakning som laster og monterer Bladlesing
│   │   ├── metronom.tsx       # Modusvelger for Metronom og Rudiment
│   │   ├── plain-metronome.tsx# Vanlig metronom koblet mot Øveplan og øvingsinstruksjoner
│   │   ├── snare-speed.tsx    # Progressiv rudiment-trener med rekorder
│   │   ├── oveplan.tsx        # Øveplan-visning med blokker, presets og logg
│   │   ├── note-cards.tsx     # Notekort-drill, registervelger og statistikk
│   │   ├── staff-clefs.tsx    # SVG-komponenter for G- og F-nøkkel
│   │   └── sync-modal.tsx     # Dialog for skjerm-synkronisering (Supabase Realtime)
│   ├── lib/
│   │   ├── profile.ts         # Instrumentprofiler (Køller / Trompet) og profilbytte
│   │   ├── pulse.ts           # Felles Web Audio- og metronomkjerne (MusikkPulse)
│   │   ├── plan-clock.ts      # Global øveplanklokke og verktøykoordinering (MusikkPlan)
│   │   ├── oveplan.ts         # Datamodell, presets, logg og trompet-instruksjoner
│   │   ├── metronome.ts       # Taktarter, underdelinger og rudiment-steglogikk
│   │   ├── notekort.ts        # Noteberegning, hjelpelinjer, statistikk og utvalg
│   │   ├── tools.ts           # Rutedefinisjoner og profilspesifikke localStorage-hjelpere
│   │   └── sync/              # Sanntidssynkronisering (Supabase Realtime, rom, bridge)
│   ├── routes/                # TanStack Router-ruter (/, /metronom, /oveplan, /notekort)
│   └── styles.css             # Tailwind CSS v4-tema og fargetokens
├── e2e/                       # Playwright E2E-tester og Safari 15.6 CSS/kontrast-sjekk
└── vite.config.ts             # Vite + TanStack Start + Nitro-oppsett
```

---

## Utvikling og testing

### Forutsetninger

- **Node.js** 22 eller 24 LTS
- **npm**

### Kom i gang lokalt

```bash
# Installer avhengigheter
npm install

# Start utviklingsserver på http://localhost:8080
npm run dev
```

### Bygg og forhåndsvisning

```bash
# Bygg produksjonspakke
npm run build

# Start lokal forhåndsvisning av bygget
npm run preview
```

### Kvalitetssikring og tester

Prosjektet har enhetstester for all kjernelogikk (lydkjerne, planklokke, øveplan, metronom, notekort, synkronisering og etydegenerator) samt ende-til-ende-tester i Playwright:

```bash
# Kjør alle enhetstester (scripts, src/lib og public/malletsight/tests)
npm test

# Kjør TypeScript-typesjekk
npm run typecheck

# Kjør ESLint
npm run lint

# Bygg appen og kjør full Playwright E2E-suite (Chromium + Safari 15 CSS-sjekk)
npm run test:e2e

# Kjør Safari/WebKit-spesifikke E2E-tester (layout, kontrast og norsk visningstekst)
npm run test:e2e:webkit
```
