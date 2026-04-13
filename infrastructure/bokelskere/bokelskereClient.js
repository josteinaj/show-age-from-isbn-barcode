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

function nextElementSibling(node) {
  let cur = node ? node.nextSibling : null;
  while (cur && cur.nodeType !== 1) cur = cur.nextSibling;
  return cur;
}

function collectAnchorHrefs(root) {
  const hrefs = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1) {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'a') {
        const href = (node.getAttribute && node.getAttribute('href')) || '';
        if (href) hrefs.push(href);
      }
      let c = node.firstChild;
      while (c) { walk(c); c = c.nextSibling; }
      return;
    }
    let c = node.firstChild;
    while (c) { walk(c); c = c.nextSibling; }
  }
  walk(root);
  return hrefs;
}

function extractAlternativeEditionUrls(html, baseUrl, { parseHtml, findAll }) {
  const doc = parseHtml(html);
  const heading = findAll(doc, n => (
    (n.tagName || '').toLowerCase() === 'h3'
    && ((n.getAttribute && n.getAttribute('id')) || '').toLowerCase() === 'alternative-utgaver'
  ))[0];
  if (!heading) return [];

  let listNode = nextElementSibling(heading);
  while (listNode && (listNode.tagName || '').toLowerCase() !== 'ul') {
    listNode = nextElementSibling(listNode);
  }
  if (!listNode) return [];

  return [...new Set(
    collectAnchorHrefs(listNode)
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
      pageUrls: [],
      primaryUrl: '',
      primaryHtml: '',
    };
  }

  const primaryUrl = resultUrls[0];
  onFetch(primaryUrl);
  const primaryHtml = await fetchText(primaryUrl);
  const primaryTitle = extractTitle(primaryHtml, domDeps);
  if (primaryTitle) onPrimaryTitle(primaryTitle);

  const editionUrls = extractAlternativeEditionUrls(primaryHtml, primaryUrl, domDeps)
    .filter(url => url !== primaryUrl);

  const allBookUrls = [...new Set([primaryUrl, ...resultUrls.slice(1), ...editionUrls])];

  return {
    searchUrl,
    resultCount: resultUrls.length,
    title: primaryTitle,
    editionCount: editionUrls.length,
    pageUrls: allBookUrls,
    primaryUrl,
    primaryHtml,
  };
}
