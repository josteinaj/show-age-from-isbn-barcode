# Anbefalt alder for bok

> Merknad: Løsningen og dokumentasjonen i dette repoet er generert og videreutviklet med KI gjennom instruksjoner gitt til en agent.

Webapp som skanner ISBN-strekkoder fra mobilkamera, gjør oppslag mot Nasjonalbibliotekets SRU, og viser anbefalt alder der dette finnes i MARC-data.

Dokumentet er skrevet for både utviklere og automatiserte agenter som skal videreutvikle løsningen.

## Formål

- Skann vanlige bokstrekkoder (EAN/ISBN) fra mobilkamera.
- Slå opp bokmetadata i NB SRU.
- Vise anbefalt alder når tilgjengelig (primært MARC 385$a, fallback 521$a).
- Logge skannede ISBN i en sesjonsliste for feilsøking.

## Arkitektur

- Frontend: statiske filer i roten (`index.html`, `app.js`, `style.css`, `config.js`).
- Proxy: Cloudflare Worker i `proxy/worker.js` for CORS og host-kontroll.
- Barcode: kamera + `BarcodeDetector` hvis tilgjengelig, ZXing fallback hvis ikke.

## Kjøring lokalt

1. Installer avhengigheter:
   - `npm install`
2. Start statisk server:
   - `npm run start`
3. Åpne:
   - `http://localhost:8000`

Merk: kamera krever normalt HTTPS eller localhost, og mobiltesting bør gjøres mot publisert side.

## Proxy (Cloudflare Worker)

### Deploy

- `npm run proxy:deploy`

### Hensikt

Proxyen håndterer CORS og begrenser hvilke domener frontend kan hente HTML/XML fra.

### Tillatte hoster (nå)

- `sru.aja.bs.no`
- `bokelskere.no`
- `www.bokelskere.no`

Hvis du trenger nye fallback-kilder må både:
- hosten legges til i `proxy/worker.js`
- worker deployes på nytt

## Oppslagsflyt

Kjernen ligger i `lookupBook()` i `app.js`.

1. Prøv NB SRU med skannet ISBN.
2. Hvis ISBN-10: konverter til ISBN-13 og prøv SRU igjen.
3. Hvis fortsatt uten treff:
   - søk i Bokelskere (`https://bokelskere.no/finn/?finn=<isbn>`)
   - finn bokside og «andre utgaver»
   - hent ISBN-kandidater fra disse sidene
   - prøv SRU med nye ISBN-kandidater
4. Hvis fortsatt uten SRU-treff men Bokelskere ga bok:
   - bruk tittelen fra Bokelskere som fallback
   - søk i NB SRU med tittel (`query=dc.title=\"<tittel>\"`)
   - hvis fortsatt uten treff: vis Bokelskere-tittel som fallback-resultat

## Datafelt og mapping

Fra SRU/MARC brukes:

- Tittel: felt `245$a`
- Forfatter: `100$a`, fallback `700$a`
- Alder: `385$a`, fallback `521$a`
- Emner: `655` med `subfield 9 == "nob"`, vis `655$a`

Hvis alder ikke finnes vises «Ingen aldersanbefaling».

## Kamera og skanning

- Startes eksplisitt med knapp (`Start kamera`) for mobilkompatibilitet.
- Native `BarcodeDetector` brukes der støtte finnes.
- ZXing brukes som fallback på nettlesere uten native detector.
- Debounce på skannede koder for å unngå duplikatoppslag.

## Skannelogg (session-only)

Nederst på siden vises en liste med skannede ISBN.

- Lagring er kun i minne (tømmes ved refresh).
- Hver rad inneholder ISBN + status.
- Klikk på ISBN åpner SRU-URL som ble brukt (for feilsøking).

## Build-info og cache-busting

Under tittelen vises:

- commit hash
- norsk tidsstempel
- klikkbar lenke til commit på GitHub

Dette oppdateres automatisk av pre-commit hook.

## Pre-commit hook

Fil: `.githooks/pre-commit`

Hooken oppdaterer:

- `BUILD_COMMIT` i `app.js`
- `BUILD_TIME` i `app.js` (norsk måned)
- cache-buster query params i `index.html` (`?v=...`)

Den stager automatisk oppdaterte filer.

### Viktig oppsett på ny maskin

Kjør én gang i repoet:

- `git config core.hooksPath .githooks`
- `chmod +x .githooks/pre-commit`

## Konfigurasjon

`config.js` inneholder:

- `corsProxyBase`: URL til deployet worker

Eksempel:

- `https://nb-isbn-proxy.<your-subdomain>.workers.dev`

## Feilsøking

### Kamera fungerer, men ingen treff

1. Klikk ISBN i skannelisten og verifiser SRU-svar.
2. Sjekk om fallback-data kom fra Bokelskere eller NB-tittelsøk.
3. Sjekk worker-allowlist og at siste worker er deployet.

### CORS/403-feil

- Host mangler i `ALLOWED_HOSTS` i `proxy/worker.js`.
- Deploy worker på nytt.

### Endringer synes ikke i GitHub Pages

- Sjekk build-linjen under tittelen (commit + tid).
- Verifiser at cache-buster i `index.html` er oppdatert.

## Veikart (anbefalt)

- Legg til en tydelig «kilde»-etikett i UI (`NB`, `Bokelskere`, `NB-tittelsøk fallback`).
- Legg til enkel end-to-end test av `lookupBook()` med mockede HTML/XML-svar.
- Innfør robust parsing per kilde med dedikerte parser-funksjoner og testfixtures.
- Vurder server-side fallback-aggregator for mer stabil scraping over tid.
