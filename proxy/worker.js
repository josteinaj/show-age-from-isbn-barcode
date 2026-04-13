/**
 * Cloudflare Worker: CORS-proxy for Nasjonalbibliotekets SRU-API
 *
 * Oppsett (CLI, gratis):
 *   1. npm install
 *   2. npm run proxy:whoami   (logger inn ved behov)
 *   3. npm run proxy:deploy
 *   4. Kopier workers.dev-URL-en og sett den i config.js
 *
 * Sikkerhet: Worker-en aksepterer kun forespørsler mot sru.aja.bs.no.
 */

const ALLOWED_HOST = 'sru.aja.bs.no';

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

    if (targetUrl.hostname !== ALLOWED_HOST) {
      return corsResponse(new Response('Ikke tillatt host', { status: 403 }));
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': 'nb-isbn-proxy/1.0' },
    });

    const body = await upstream.arrayBuffer();
    const response = new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'text/xml' },
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
