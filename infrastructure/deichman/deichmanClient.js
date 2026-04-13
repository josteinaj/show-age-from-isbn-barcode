const DEICHMAN_SEARCH_BASE = 'https://deichman.no/sok/';

export function buildDeichmanSearchUrl(searchTitle) {
  return `${DEICHMAN_SEARCH_BASE}${encodeURIComponent(searchTitle).replace(/%20/g, '+')}`;
}

/**
 * Search Deichman for a given title and return result count + first title found.
 * @param {string} searchTitle
 * @param {{ fetchText, parseHtml, findAll, getTextContent, onFetch?: (url: string) => void }} deps
 */
export async function fetchDeichmanSearchData(searchTitle, { fetchText, parseHtml, findAll, getTextContent, onFetch = () => {} }) {
  if (!searchTitle) return null;
  const searchUrl = buildDeichmanSearchUrl(searchTitle);
  try {
    onFetch(searchUrl);
    const html = await fetchText(searchUrl);
    const doc = parseHtml(html);
    const deichmanHrefs = ['/utgivelse/', '/verk/', '/title/'];
    const links = findAll(doc, n => {
      const href = (n.getAttribute && n.getAttribute('href')) || '';
      return (n.tagName || '').toLowerCase() === 'a' && deichmanHrefs.some(p => href.includes(p));
    });
    const uniqueHrefs = new Set(links.map(a => a.getAttribute('href')).filter(Boolean));

    let hrefs = [...uniqueHrefs];
    if (hrefs.length === 0) {
      const rxMatches = [...html.matchAll(/\/(?:utgivelse|verk|title)\/[a-zA-Z0-9-]+/g)]
        .map(m => m[0]);
      hrefs = [...new Set(rxMatches)];
    }

    const firstHref = hrefs[0] || '';
    const firstUrl = firstHref ? new URL(firstHref, searchUrl).toString() : '';
    const firstTitle = links[0] ? getTextContent(links[0]) : '';
    return { searchUrl, resultCount: hrefs.length, firstTitle, firstUrl };
  } catch {
    return { searchUrl, resultCount: 0, firstTitle: '', firstUrl: '' };
  }
}
