/**
 * Node.js HTTP adapter using built-in fetch (Node >= 18).
 * @returns {(url: string) => Promise<string>}
 */
export function makeNodeFetchText() {
  return async function fetchText(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'isbn-lookup-cli/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  };
}
