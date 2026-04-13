import { lookupBook } from '../../application/use_cases/lookupBook.js';
import { makeNodeFetchText } from '../../infrastructure/http/nodeFetch.js';
import { parseXml, parseHtml, findAll, getTextContent } from '../../infrastructure/html/xmldomDom.js';
import { cleanIsbn } from '../../infrastructure/isbn/isbn.js';
import { buildSruUrl } from '../../infrastructure/nb_sru/sruClient.js';
import { summarizeAgeGroups } from '../../application/formatters/ageSummary.js';

function formatEventLink(text, url) {
  return `${text}  →  ${url}`;
}

/**
 * Run a single ISBN lookup and print results to stdout.
 * Progress messages are written to stderr.
 * @param {string} rawIsbn
 */
export async function runCliLookup(rawIsbn) {
  const fetchText = makeNodeFetchText();

  const result = await lookupBook(rawIsbn, {
    fetchText,
    parseXml,
    parseHtml,
    findAll,
    getTextContent,
    formatEventLink,
    onProgress: (msg) => process.stderr.write(`\r\x1b[K${msg}`),
  });

  process.stderr.write('\r\x1b[K');

  const { book, sruUrl, events, source } = result;
  const isbn = cleanIsbn(rawIsbn);

  if (events.length > 0) {
    console.log('Hendelser:');
    for (const ev of events) console.log(`  - ${ev}`);
    console.log('');
  }

  if (book) {
    const age = summarizeAgeGroups(book.ageGroups);
    const status = (source === 'bokelskere-title-fallback' || source === 'nb-title-fallback')
      ? (age.hasAge ? 'Funnet via fallback' : 'Funnet via fallback (ingen alder)')
      : 'Funnet';
    console.log(`ISBN: ${isbn}`);
    console.log(`SRU: ${sruUrl}`);
    console.log(`Status: ${status}`);
    if (book.title)               console.log(`Tittel: ${book.title}`);
    if (book.author)              console.log(`Forfatter: ${book.author}`);
    if (age.hasAge)               console.log(`Anbefalt alder: ${age.averageAge} år (${age.mergedRangeLabel})`);
    if (book.subjects.length > 0)  console.log(`Emner: ${book.subjects.join(', ')}`);
  } else {
    console.log(`ISBN: ${isbn}`);
    console.log(`SRU: ${sruUrl}`);
    console.log('Status: Ikke funnet');
  }
}
