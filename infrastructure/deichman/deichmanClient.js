const DEICHMAN_SEARCH_BASE = 'https://deichman.no/sok/';

export function buildDeichmanSearchUrl(searchTitle) {
  return `${DEICHMAN_SEARCH_BASE}${encodeURIComponent(searchTitle)}`;
}

/**
 * Search Deichman for a given title and return result count + first title found.
 * @param {string} searchTitle
 * @param {{ fetchText, parseHtml, findAll, getTextContent }} deps
 */
export async function fetchDeichmanSearchData(searchTitle, { fetchText, parseHtml, findAll, getTextContent }) {
  if (!searchTitle) return null;
  const searchUrl = buildDeichmanSearchUrl(searchTitle);
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
