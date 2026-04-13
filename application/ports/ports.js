/**
 * Port: fetchText
 *
 * Fetches the text content of a URL.
 * Adapters: infrastructure/http/browserFetch.js, infrastructure/http/nodeFetch.js
 *
 * @callback FetchText
 * @param {string} url
 * @returns {Promise<string>}
 */

/**
 * Port: DOM
 *
 * Platform-independent document parsing and traversal.
 * Adapters: infrastructure/html/browserDom.js, infrastructure/html/xmldomDom.js
 *
 * @callback ParseXml
 * @param {string} text
 * @returns {Document | null}
 *
 * @callback ParseHtml
 * @param {string} text
 * @returns {Document}
 *
 * @callback FindAll
 * @param {Document} doc
 * @param {(el: Element) => boolean} predicate
 * @returns {Element[]}
 *
 * @callback GetTextContent
 * @param {Element} el
 * @returns {string}
 */

/**
 * Port: formatEventLink
 *
 * Formats a link for an event log entry.
 * In the browser: returns an HTML anchor string.
 * In the CLI: returns 'text  →  url'.
 *
 * @callback FormatEventLink
 * @param {string} text
 * @param {string} url
 * @returns {string}
 */
