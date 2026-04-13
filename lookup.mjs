#!/usr/bin/env node
// lookup.mjs — inngangspunkt for kommandolinja
// Bruk: node lookup.mjs <ISBN>

import { runCliLookup } from './presentation/cli/run.js';

const isbn = process.argv[2];
if (!isbn) {
  console.error('Bruk: node lookup.mjs <ISBN>');
  process.exit(1);
}

await runCliLookup(isbn);
