import { cleanIsbn, extractIsbnCandidatesFromText, isbn10ToIsbn13 } from '../../infrastructure/isbn/isbn.js';
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
  let fetchQueue = Promise.resolve();

  function logGet(url) {
    events.push(`GET ${url}`);
  }

  function fetchTextSerial(url) {
    const next = fetchQueue.then(() => fetchText(url));
    // Keep queue alive after failures so later calls are still serialized.
    fetchQueue = next.catch(() => undefined);
    return next;
  }

  async function trySruLookup(isbnCandidate, logMissEvent = false) {
    if (!isbnCandidate || !(isbnCandidate.length === 10 || isbnCandidate.length === 13)) return null;
    if (triedIsbns.has(isbnCandidate)) return null;
    triedIsbns.add(isbnCandidate);

    const sruUrl = buildSruUrl(isbnCandidate);
    lastSruUrl = sruUrl;
    logGet(sruUrl);
    onProgress(`Søker på NB SRU etter ISBN ${isbnCandidate}…`);

    const xml = await fetchTextSerial(sruUrl);
    const book = parseMarc(xml, { parseXml });

    if (book) return { book, isbn: isbnCandidate, sruUrl, events, source: 'sru' };

    if (logMissEvent) events.push(`Nasjonalbiblioteket: ${isbnCandidate} - Ikke funnet`);
    return null;
  }

  let result = await trySruLookup(isbn, true);
  if (result) return result;

  if (isbn.length === 10) {
    const isbn13 = isbn10ToIsbn13(isbn);
    if (isbn13) {
      result = await trySruLookup(isbn13, true);
      if (result) return result;
    }
  }

  const bokelskereSearchUrl = buildBokelskereSearchUrl(isbn);
  let bokelskereData = null;
  try {
    onProgress('Søker på Bokelskere.no…');
    bokelskereData = await fetchBokelskereData(isbn, {
      ...domDeps,
      fetchText: fetchTextSerial,
      onFetch: logGet,
      onSearchResult: (resultCount) => {
        events.push(`Bokelskere: ${resultCount} treff`);
      },
      onPrimaryTitle: (title) => {
        events.push(`Bokelskere: Fant tittel - ${title}`);
      },
    });
  } catch {
    events.push('Bokelskere: Feil ved oppslag');
  }

  if (bokelskereData && bokelskereData.resultCount > 0) {
    const seenBokelskereIsbns = new Set([isbn]);

    for (const pageUrl of bokelskereData.pageUrls || []) {
      const isPrimaryPage = pageUrl === bokelskereData.primaryUrl;
      let pageHtml = '';
      if (isPrimaryPage && bokelskereData.primaryHtml) {
        pageHtml = bokelskereData.primaryHtml;
      } else {
        logGet(pageUrl);
        pageHtml = await fetchTextSerial(pageUrl);
      }

      if (isPrimaryPage) continue;

      const pageCandidates = extractIsbnCandidatesFromText(pageHtml);
      for (const candidate of pageCandidates) {
        if (seenBokelskereIsbns.has(candidate)) continue;
        seenBokelskereIsbns.add(candidate);
        if (triedIsbns.has(candidate)) continue;
        events.push(`Bokelskere: Fant nytt ISBN - ${candidate}`);
        onProgress('Søker på andre ISBN-utgaver fra Bokelskere…');
        try {
          result = await trySruLookup(candidate, true);
          if (result) return { ...result, source: 'bokelskere-isbn-fallback' };
        } catch {
          events.push(`Nasjonalbiblioteket: ${candidate} - Feil ved oppslag`);
        }
      }
    }

    onProgress('Søker på Deichman…');
    const deichman = await fetchDeichmanSearchData(bokelskereData.title, {
      ...domDeps,
      fetchText: fetchTextSerial,
      onFetch: logGet,
    });
    if (deichman) {
      events.push(`Deichman: ${deichman.resultCount} treff`);
      if (deichman.firstUrl) {
        logGet(deichman.firstUrl);
        events.push('Deichman: Fant tittel, men uthenting av alder er ikke implementert ennå');
      }
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
