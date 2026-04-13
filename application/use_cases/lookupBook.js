import { cleanIsbn, isbn10ToIsbn13 } from '../../infrastructure/isbn/isbn.js';
import { buildSruUrl, parseMarc } from '../../infrastructure/nb_sru/sruClient.js';
import { fetchBokelskereData, buildBokelskereSearchUrl } from '../../infrastructure/bokelskere/bokelskereClient.js';
import { fetchDeichmanSearchData } from '../../infrastructure/deichman/deichmanClient.js';

/**
 * Look up a book by ISBN, with Bokelskere and Deichman fallbacks.
 *
 * @param {string} rawIsbn
 * @param {{
 *   fetchText: (url: string) => Promise<string>,
 *   parseXml: (text: string) => Document | null,
 *   parseHtml: (text: string) => Document,
 *   findAll: (doc: Document, predicate: (el: Element) => boolean) => Element[],
 *   getTextContent: (el: Element) => string,
 *   formatEventLink: (text: string, url: string) => string,
 *   onProgress?: (msg: string) => void,
 * }} deps
 *
 * @returns {Promise<{
 *   book: { title, author, ageGroups, subjects } | null,
 *   isbn: string,
 *   sruUrl: string,
 *   events: string[],
 *   source: 'sru' | 'bokelskere-isbn-fallback' | 'bokelskere-title-fallback' | 'none',
 * }>}
 */
export async function lookupBook(rawIsbn, deps) {
  const {
    fetchText,
    parseXml,
    parseHtml,
    findAll,
    getTextContent,
    formatEventLink,
    onProgress = () => {},
  } = deps;

  const domDeps = { fetchText, parseHtml, findAll, getTextContent };

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
    const book = parseMarc(xml, { parseXml });

    if (book) return { book, isbn: isbnCandidate, sruUrl, events, source: 'sru' };

    if (logMissEvent) {
      events.push(`${formatEventLink(isbnCandidate, sruUrl)} - Ikke funnet`);
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

  const bokelskereSearchUrl = buildBokelskereSearchUrl(isbn);
  let bokelskereData = null;
  try {
    onProgress('Søker på Bokelskere.no…');
    bokelskereData = await fetchBokelskereData(isbn, domDeps);
    events.push(`${formatEventLink('Søker på bokelskere.no', bokelskereData.searchUrl)}: ${bokelskereData.resultCount} treff`);
  } catch {
    events.push(`${formatEventLink('Søker på bokelskere.no', bokelskereSearchUrl)}: feil`);
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
        events.push(`${formatEventLink(candidate, buildSruUrl(candidate))} - Feil ved oppslag`);
      }
    }

    onProgress('Søker på Deichman…');
    const deichman = await fetchDeichmanSearchData(bokelskereData.title, domDeps);
    if (deichman) {
      events.push(`${formatEventLink('Søker på deichman.no', deichman.searchUrl)}: ${deichman.resultCount} treff`);
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
