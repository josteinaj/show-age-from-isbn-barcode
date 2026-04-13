import { extractIsbnCandidatesFromText } from '../isbn/isbn.js';

const BOKELSKERE_SEARCH_BASE = 'https://bokelskere.no/finn/';

export function buildBokelskereSearchUrl(isbn) {
  return `${BOKELSKERE_SEARCH_BASE}?finn=${encodeURIComponent(isbn)}`;
}

function extractBookPageUrls(html, baseUrl, { parseHtml, findAll }) {
  const doc = parseHtml(html);
  return [...new Set(
    findAll(doc, n => (n.tagName || '').toLowerCase() === 'a' && (n.getAttribute('href') || '').includes('/bok/'))
      .map(a => a.getAttribute('href'))
      .filter(Boolean)
      .map(href => {
        try {
          const u = new URL(href, baseUrl);
          u.hash = '';
          u.search = '';
          return u;
        } catch {
          return null;
        }
      })
      .filter(u => u && /\/bok\/[^/]+\/\d+\/?$/.test(u.pathname))
      .map(u => u.toString())
  )];
}

function extractTitle(html, { parseHtml, findAll, getTextContent }) {
  const doc = parseHtml(html);
  const titleEls = findAll(doc, n => (n.tagName || '').toLowerCase() === 'title');
  if (titleEls.length > 0) {
    const text = getTextContent(titleEls[0]);
    return text.replace(/\s+av\s+.+$/i, '').trim() || text;
  }
  const h1s = findAll(doc, n => (n.tagName || '').toLowerCase() === 'h1');
  const bookH1 = h1s.find(n => !getTextContent(n).includes('Bokelskere'));
  return bookH1 ? getTextContent(bookH1) : '';
}

function extractAlternativeEditionUrls(html, baseUrl) {
  const sectionMatch = html.match(/<h3[^>]*id=["']alternative-utgaver["'][^>]*>[\s\S]*?<\/ul>/i);
  if (!sectionMatch) return [];

  const hrefMatches = [...sectionMatch[0].matchAll(/href=["']([^"']+)["']/gi)];
  return [...new Set(
    hrefMatches
      .map(m => m[1])
      .filter(Boolean)
      .map(href => {
        try {
          const u = new URL(href, baseUrl);
          u.hash = '';
          u.search = '';
          return u;
        } catch {
          return null;
        }
      })
      .filter(u => u && /\/bok\/[^/]+\/\d+\/?$/.test(u.pathname))
      .map(u => u.toString())
  )];
}

/**
 * Fetch book data from Bokelskere.no for a given ISBN.
 * @param {string} isbn
 * @param {{ fetchText, parseHtml, findAll, getTextContent, onFetch?: (url: string) => void, onSearchResult?: (resultCount: number, searchUrl: string) => void, onPrimaryTitle?: (title: string) => void }} deps
 */
export async function fetchBokelskereData(isbn, {
  fetchText,
  parseHtml,
  findAll,
  getTextContent,
  onFetch = () => {},
  onSearchResult = () => {},
  onPrimaryTitle = () => {},
}) {
  const domDeps = { parseHtml, findAll, getTextContent };
  const searchUrl = buildBokelskereSearchUrl(isbn);
  onFetch(searchUrl);
  const searchHtml = await fetchText(searchUrl);
  const resultUrls = extractBookPageUrls(searchHtml, searchUrl, domDeps);
  onSearchResult(resultUrls.length, searchUrl);

  if (resultUrls.length === 0) {
    return {
      searchUrl,
      resultCount: 0,
      title: '',
      editionCount: 0,
      isbnCandidates: [isbn],
      newIsbnCount: 0,
      pageSteps: [],
    };
  }

  const primaryUrl = resultUrls[0];
  onFetch(primaryUrl);
  const primaryHtml = await fetchText(primaryUrl);
  const primaryTitle = extractTitle(primaryHtml, domDeps);
  if (primaryTitle) onPrimaryTitle(primaryTitle);

  const editionUrls = extractAlternativeEditionUrls(primaryHtml, primaryUrl)
    .filter(url => url !== primaryUrl);

  const allBookUrls = [...new Set([primaryUrl, ...resultUrls.slice(1), ...editionUrls])];
  const isbnCandidates = new Set([isbn]);
  const pageSteps = [];

  for (const bookUrl of allBookUrls) {
    if (bookUrl !== primaryUrl) onFetch(bookUrl);
    const html = bookUrl === primaryUrl ? primaryHtml : await fetchText(bookUrl);
    const newIsbns = [];
    for (const candidate of extractIsbnCandidatesFromText(html)) {
      if (!isbnCandidates.has(candidate)) {
        isbnCandidates.add(candidate);
        newIsbns.push(candidate);
      }
    }
    pageSteps.push({ url: bookUrl, newIsbns });
  }

  return {
    searchUrl,
    resultCount: resultUrls.length,
    title: primaryTitle,
    editionCount: editionUrls.length,
    isbnCandidates: [...isbnCandidates],
    newIsbnCount: Math.max(0, isbnCandidates.size - 1),
    pageSteps,
  };
}
