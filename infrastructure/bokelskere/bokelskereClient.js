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
      .map(href => { try { return new URL(href, baseUrl); } catch { return null; } })
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

/**
 * Fetch book data from Bokelskere.no for a given ISBN.
 * @param {string} isbn
 * @param {{ fetchText, parseHtml, findAll, getTextContent }} deps
 */
export async function fetchBokelskereData(isbn, { fetchText, parseHtml, findAll, getTextContent }) {
  const domDeps = { parseHtml, findAll, getTextContent };
  const searchUrl = buildBokelskereSearchUrl(isbn);
  const searchHtml = await fetchText(searchUrl);
  const resultUrls = extractBookPageUrls(searchHtml, searchUrl, domDeps);

  if (resultUrls.length === 0) {
    return { searchUrl, resultCount: 0, title: '', editionCount: 0, isbnCandidates: [isbn], newIsbnCount: 0 };
  }

  const primaryUrl = resultUrls[0];
  const primaryHtml = await fetchText(primaryUrl);
  const primaryTitle = extractTitle(primaryHtml, domDeps);

  const slugMatch = primaryUrl.match(/\/bok\/([^/]+)\//);
  const slug = slugMatch ? slugMatch[1] : '';

  const editionUrls = extractBookPageUrls(primaryHtml, primaryUrl, domDeps)
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
