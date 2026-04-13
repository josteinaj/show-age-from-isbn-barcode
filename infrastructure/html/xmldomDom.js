/**
 * Node.js DOM adapter using @xmldom/xmldom.
 * Implements the same interface as infrastructure/html/browserDom.js.
 */

import { DOMParser } from '@xmldom/xmldom';

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) return null;
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
    if (node.nodeType === 1) {
      if (predicate(node)) results.push(node);
      let child = node.firstChild;
      while (child) { walk(child); child = child.nextSibling; }
    } else {
      let child = node.firstChild;
      while (child) { walk(child); child = child.nextSibling; }
    }
  }
  walk(doc.documentElement || doc);
  return results;
}

export function getTextContent(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}
