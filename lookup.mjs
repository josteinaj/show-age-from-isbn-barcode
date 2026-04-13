#!/usr/bin/env node
// lookup.mjs — kommandolinjeverktøy for ISBN-oppslag
// Bruk: node lookup.mjs <ISBN>

import { DOMParser } from '@xmldom/xmldom';

const isbn = process.argv[2];
if (!isbn) {
  console.error('Bruk: node lookup.mjs <ISBN>');
  process.exit(1);
}

// ── Konstanter ─────────────────────────────────────────────────────────────────

const SRU_BASE = 'https://sru.aja.bs.no/mlnb';
const BOKELSKERE_SEARCH_BASE = 'https://bokelskere.no/finn/';
const DEICHMAN_SEARCH_BASE = 'https://deichman.no/sok/';
const MARC_NS = 'info:lc/xmlns/marcxchange-v1';

// ── ISBN-verktøy ───────────────────────────────────────────────────────────────

function cleanIsbn(raw) {
  return raw.replace(/[^0-9Xx]/g, '');
}

function isValidIsbn10(isbn10) {
  const digits = isbn10.replace(/[^0-9Xx]/gi, '').toUpperCase();
  if (digits.length !== 10) return false;
  if (!/^\d{9}[0-9X]$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * (10 - i);
  }
  const checkChar = digits[9];
  const checkDigit = checkChar === 'X' ? 10 : parseInt(checkChar, 10);
  return (sum + checkDigit) % 11 === 0;
}

function isbn10ToIsbn13(isbn10) {
  const digits = isbn10.replace(/[^0-9Xx]/gi, '');
  if (digits.length !== 10) return null;
  if (!isValidIsbn10(digits)) return null;
  const base = '978' + digits.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'isbn-lookup-cli/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── SRU ────────────────────────────────────────────────────────────────────────

function buildSruUrl(isbn) {
  return `${SRU_BASE}?operation=searchRetrieve&query=dc.identifier=${encodeURIComponent(isbn)}&recordSchema=marc21`;
}

// ── MARC 21 XML-parser ─────────────────────────────────────────────────────────

function parseMarc(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) return null;

  const countEl = doc.getElementsByTagName('numberOfRecords')[0];
  if (!countEl || parseInt(countEl.textContent.trim(), 10) === 0) return null;

  const datafields = Array.from(doc.getElementsByTagNameNS(MARC_NS, 'datafield'));

  function fields(tag) {
    return datafields.filter(el => el.getAttribute('tag') === tag);
  }

  function sub(df, code) {
    const subfields = Array.from(df.getElementsByTagNameNS(MARC_NS, 'subfield'));
    const el = subfields.find(s => s.getAttribute('code') === code);
    return el ? el.textContent.trim() : null;
  }

  const f245 = fields('245')[0];
  let title = f245 ? sub(f245, 'a') : null;
  if (title) title = title.replace(/[\s/:,]+$/, '');

  const f100 = fields('100')[0];
  let author = f100 ? sub(f100, 'a') : null;
  if (!author) {
    const f700 = fields('700')[0];
    author = f700 ? sub(f700, 'a') : null;
  }
  if (author) author = author.replace(/[,.\s]+$/, '');

  let ageGroups = fields('385').map(df => sub(df, 'a')).filter(Boolean);
  if (ageGroups.length === 0) {
    ageGroups = fields('521').map(df => sub(df, 'a')).filter(Boolean);
  }

  const subjects = fields('655')
    .filter(df => sub(df, '9') === 'nob')
    .map(df => sub(df, 'a'))
    .filter(Boolean);

  return { title, author, ageGroups, subjects };
}

// ── HTML-hjelper (xmldom) ──────────────────────────────────────────────────────

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Walk all element nodes in doc and return those matching predicate */
function findAll(doc, predicate) {
  const results = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1) {
      if (predicate(node)) results.push(node);
      let child = node.firstChild;
      while (child) { walk(child); child = child.nextSibling; }
    } else {
      let child = node.firstChild;
      while (child) { walk(child); child = child.nextSibling; }
    }
  }
  walk(doc.documentElement || doc);
  return results;
}

function getTextContent(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

// ── Bokelskere ─────────────────────────────────────────────────────────────────

function extractBookPageUrlsFromHtml(html, baseUrl) {
  const doc = parseHtml(html);
  const links = findAll(doc, n =>
    (n.tagName || '').toLowerCase() === 'a' && (n.getAttribute('href') || '').includes('/bok/')
  );
  const urls = links
    .map(a => a.getAttribute('href'))
    .filter(Boolean)
    .map(href => {
      try { return new URL(href, baseUrl); } catch { return null; }
    })
    .filter(u => u && /\/bok\/[^/]+\/\d+\/?$/.test(u.pathname))
    .map(u => u.toString());
  return [...new Set(urls)];
}

function extractTitleFromBokelskereHtml(html) {
  const doc = parseHtml(html);
  // Use <title> tag: format is "Book Title av Author"
  const titles = findAll(doc, n => (n.tagName || '').toLowerCase() === 'title');
  if (titles.length > 0) {
    const text = getTextContent(titles[0]);
    // Strip " av Author" suffix if present
    return text.replace(/\s+av\s+.+$/i, '').trim() || text;
  }
  // Fallback: second h1 (first is site logo "Bokelskere.no")
  const h1s = findAll(doc, n => (n.tagName || '').toLowerCase() === 'h1');
  const bookH1 = h1s.find(n => !getTextContent(n).includes('Bokelskere'));
  return bookH1 ? getTextContent(bookH1) : '';
}

function extractIsbnCandidatesFromText(text) {
  const matches = text.match(/\b(?:97[89][\s-]?)?[0-9][0-9\s-]{8,}[0-9Xx]\b/g) || [];
  const isbns = new Set();
  for (const match of matches) {
    const cleaned = cleanIsbn(match);
    if (cleaned.length === 13) {
      if (cleaned.startsWith('978') || cleaned.startsWith('979')) {
        isbns.add(cleaned);
      }
    } else if (cleaned.length === 10) {
      if (isValidIsbn10(cleaned)) {
        isbns.add(cleaned);
        const as13 = isbn10ToIsbn13(cleaned);
        if (as13) isbns.add(as13);
      }
    }
  }
  return [...isbns];
}

async function fetchBokelskereData(isbn) {
  const searchUrl = `${BOKELSKERE_SEARCH_BASE}?finn=${encodeURIComponent(isbn)}`;
  const searchHtml = await fetchText(searchUrl);
  const resultUrls = extractBookPageUrlsFromHtml(searchHtml, searchUrl);

  if (resultUrls.length === 0) {
    return { searchUrl, resultCount: 0, title: '', editionCount: 0, isbnCandidates: [isbn], newIsbnCount: 0 };
  }

  const primaryUrl = resultUrls[0];
  const primaryHtml = await fetchText(primaryUrl);
  const primaryTitle = extractTitleFromBokelskereHtml(primaryHtml);

  const slugMatch = primaryUrl.match(/\/bok\/([^/]+)\//);
  const slug = slugMatch ? slugMatch[1] : '';

  const editionUrls = extractBookPageUrlsFromHtml(primaryHtml, primaryUrl)
    .filter(url => url !== primaryUrl && (!slug || url.includes(`/bok/${slug}/`)));

  const allBookUrls = [...new Set([primaryUrl, ...editionUrls])];
  const isbnCandidates = new Set([isbn]);

  for (const candidate of extractIsbnCandidatesFromText(searchHtml)) {
    if (candidate !== isbn) isbnCandidates.add(candidate);
  }

  for (const bookUrl of allBookUrls) {
    const html = bookUrl === primaryUrl ? primaryHtml : await fetchText(bookUrl);
    for (const candidate of extractIsbnCandidatesFromText(html)) {
      isbnCandidates.add(candidate);
    }
  }

  return {
    searchUrl,
    resultCount: resultUrls.length,
    title: primaryTitle,
    editionCount: editionUrls.length,
    isbnCandidates: [...isbnCandidates],
    newIsbnCount: Math.max(0, isbnCandidates.size - 1),
  };
}

// ── Deichman ───────────────────────────────────────────────────────────────────

async function fetchDeichmanSearchData(searchTitle) {
  if (!searchTitle) return null;
  const searchUrl = `${DEICHMAN_SEARCH_BASE}${encodeURIComponent(searchTitle)}`;
  try {
    const html = await fetchText(searchUrl);
    const doc = parseHtml(html);
    const deichmanHrefs = ['/utgivelse/', '/verk/', '/title/'];
    const links = findAll(doc, n => {
      const href = (n.getAttribute && n.getAttribute('href')) || '';
      return (n.tagName || '').toLowerCase() === 'a' && deichmanHrefs.some(p => href.includes(p));
    });
    const uniqueHrefs = new Set(links.map(a => a.getAttribute('href')).filter(Boolean));
    const firstTitle = links[0] ? getTextContent(links[0]) : '';
    return { searchUrl, resultCount: uniqueHrefs.size, firstTitle };
  } catch {
    return { searchUrl, resultCount: 0, firstTitle: '' };
  }
}

// ── Oppslag ────────────────────────────────────────────────────────────────────

async function lookupBook(rawIsbn, onProgress = () => {}) {
  const isbn = cleanIsbn(rawIsbn);
  const triedIsbns = new Set();
  const events = [];

  let lastSruUrl = '';

  async function trySruLookup(isbnCandidate, logMissEvent = false) {
    if (!isbnCandidate || !(isbnCandidate.length === 10 || isbnCandidate.length === 13)) return null;
    if (triedIsbns.has(isbnCandidate)) return null;
    triedIsbns.add(isbnCandidate);

    const sruUrl = buildSruUrl(isbnCandidate);
    lastSruUrl = sruUrl;
    onProgress(`Søker på NB SRU etter ISBN ${isbnCandidate}…`);
    const xml = await fetchText(sruUrl);
    const book = parseMarc(xml);

    if (book) return { book, isbn: isbnCandidate, sruUrl, events, source: 'sru' };

    if (logMissEvent) {
      events.push(`${isbnCandidate} - Ikke funnet  →  ${sruUrl}`);
    }
    return null;
  }

  let result = await trySruLookup(isbn, false);
  if (result) return result;

  if (isbn.length === 10) {
    const isbn13 = isbn10ToIsbn13(isbn);
    if (isbn13) {
      result = await trySruLookup(isbn13, false);
      if (result) return result;
    }
  }

  const bokelskereSearchUrl = `${BOKELSKERE_SEARCH_BASE}?finn=${encodeURIComponent(isbn)}`;
  let bokelskereData = null;
  try {
    onProgress('Søker på Bokelskere.no…');
    bokelskereData = await fetchBokelskereData(isbn);
    events.push(`Søker på bokelskere.no: ${bokelskereData.resultCount} treff  →  ${bokelskereData.searchUrl}`);
  } catch (err) {
    events.push(`Søker på bokelskere.no: feil  →  ${bokelskereSearchUrl}`);
  }

  if (bokelskereData && bokelskereData.resultCount > 0) {
    if (bokelskereData.newIsbnCount > 0) {
      events.push(`Fant ${bokelskereData.newIsbnCount} andre utgaver med andre ISBN`);
      onProgress('Søker på andre ISBN-utgaver fra Bokelskere…');
    }

    const candidateIsbns = bokelskereData.isbnCandidates.filter(c => !triedIsbns.has(c));
    for (const candidate of candidateIsbns) {
      try {
        result = await trySruLookup(candidate, true);
        if (result) return { ...result, source: 'bokelskere-isbn-fallback' };
      } catch {
        const sruUrl = buildSruUrl(candidate);
        events.push(`${candidate} - Feil ved oppslag  →  ${sruUrl}`);
      }
    }

    onProgress('Søker på Deichman…');
    const deichman = await fetchDeichmanSearchData(bokelskereData.title);
    if (deichman) {
      events.push(`Søker på deichman.no: ${deichman.resultCount} treff  →  ${deichman.searchUrl}`);
    }

    return {
      book: {
        title: bokelskereData.title || '(tittel funnet i Bokelskere.no)',
        author: '',
        ageGroups: [],
        subjects: [],
      },
      isbn,
      sruUrl: lastSruUrl || buildSruUrl(isbn),
      events,
      source: 'bokelskere-title-fallback',
    };
  }

  return { book: null, isbn, sruUrl: lastSruUrl || buildSruUrl(isbn), events, source: 'none' };
}

// ── Hovedprogram ───────────────────────────────────────────────────────────────

const result = await lookupBook(isbn, msg => {
  process.stderr.write(`\r\x1b[K${msg}`);
});
process.stderr.write('\r\x1b[K'); // fjern siste statuslinje

const { book, sruUrl, events, source } = result;

console.log(`ISBN: ${cleanIsbn(isbn)}`);
console.log(`SRU: ${sruUrl}`);

if (book) {
  const status = source === 'bokelskere-title-fallback'
    ? (book.ageGroups.length > 0 ? 'Funnet via fallback' : 'Funnet via fallback (ingen alder)')
    : 'Funnet';
  console.log(`Status: ${status}`);
  if (book.title)  console.log(`Tittel: ${book.title}`);
  if (book.author) console.log(`Forfatter: ${book.author}`);
  if (book.ageGroups.length > 0) console.log(`Anbefalt alder: ${book.ageGroups.join(' · ')}`);
  if (book.subjects.length > 0)  console.log(`Emner: ${book.subjects.join(', ')}`);
} else {
  console.log('Status: Ikke funnet');
}

if (events.length > 0) {
  console.log('\nHendelser:');
  for (const ev of events) {
    console.log(`  - ${ev}`);
  }
}
