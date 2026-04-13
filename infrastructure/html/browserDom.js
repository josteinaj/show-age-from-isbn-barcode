/**
 * Browser DOM adapter.
 * Implements the dom port using the native browser DOMParser.
 */

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  return doc;
}

export function parseHtml(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}

/**
 * Find all elements matching a predicate by walking the entire tree.
 * @param {Document} doc
 * @param {(el: Element) => boolean} predicate
 * @returns {Element[]}
 */
export function findAll(doc, predicate) {
  const results = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1 && predicate(node)) results.push(node);
    let child = node.firstChild;
    while (child) { walk(child); child = child.nextSibling; }
  }
  walk(doc.documentElement || doc);
  return results;
}

export function getTextContent(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}
