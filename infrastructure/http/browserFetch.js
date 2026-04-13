/**
 * Browser HTTP adapter.
 * Routes requests through the CORS proxy if configured.
 *
 * @param {string} corsProxyBase - e.g. 'https://my-proxy.workers.dev' or ''
 * @returns {(url: string) => Promise<string>}
 */
export function makeBrowserFetchText(corsProxyBase) {
  return async function fetchText(targetUrl) {
    const url = corsProxyBase
      ? `${corsProxyBase}/?url=${encodeURIComponent(targetUrl)}`
      : targetUrl;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
}
