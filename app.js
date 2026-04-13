// app.js — ikke lenger i bruk som inngangspunkt.
// Logikken er refaktorert til Clean Architecture:
//
//   presentation/web/app.js   — UI-kontroller (lastes fra index.html)
//   application/use_cases/    — felles use cases
//   infrastructure/           — adapters (HTTP, HTML, ISBN, SRU, Bokelskere)
