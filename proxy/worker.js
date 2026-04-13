/**
 * Cloudflare Worker: CORS-proxy for bokoppslag.
 *
 * Oppsett (CLI, gratis):
 *   1. npm install
 *   2. npm run proxy:whoami   (logger inn ved behov)
 *   3. npm run proxy:deploy
 *   4. Kopier workers.dev-URL-en og sett den i config.js
 *
 * Sikkerhet: Worker-en aksepterer kun forespørsler mot tillatte hoster.
 */

const ALLOWED_HOSTS = new Set([
  'sru.aja.bs.no',
  'bokelskere.no',
  'www.bokelskere.no',
]);

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    const incoming = new URL(request.url);
    const targetParam = incoming.searchParams.get('url');

    if (!targetParam) {
      return corsResponse(new Response('Mangler ?url= parameter', { status: 400 }));
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetParam);
    } catch {
      return corsResponse(new Response('Ugyldig URL', { status: 400 }));
    }

    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return corsResponse(new Response('Ikke tillatt host', { status: 403 }));
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'nb-isbn-proxy/1.0',
        'Accept': 'text/html,application/xml,text/xml,*/*',
      },
    });

    const body = await upstream.arrayBuffer();
    const response = new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8' },
    });

    return corsResponse(response);
  },
};

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}
