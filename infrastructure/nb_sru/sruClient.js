const SRU_BASE = 'https://sru.aja.bs.no/mlnb';
const MARC_NS = 'info:lc/xmlns/marcxchange-v1';

export function buildSruUrl(isbn) {
  return `${SRU_BASE}?operation=searchRetrieve&query=dc.identifier=${encodeURIComponent(isbn)}&recordSchema=marc21`;
}

export function buildSruTitleUrl(title) {
  const cql = `dc.title="${String(title || '').trim()}"`;
  return `${SRU_BASE}?operation=searchRetrieve&recordSchema=marc21&query=${encodeURIComponent(cql)}`;
}

/**
 * Parse a MARC 21 XML response into a book object.
 * @param {string} xmlText
 * @param {{ parseXml: (text: string) => Document }} dom
 * @returns {{ title, author, ageGroups, subjects } | null}
 */
export function parseMarc(xmlText, { parseXml }) {
  const doc = parseXml(xmlText);

  if (!doc) return null;

  const countEl = doc.getElementsByTagName('numberOfRecords')[0];
  if (!countEl || parseInt(countEl.textContent.trim(), 10) === 0) return null;

  const datafields = Array.from(doc.getElementsByTagNameNS(MARC_NS, 'datafield'));

  function fields(tag) {
    return datafields.filter(el => el.getAttribute('tag') === tag);
  }

  function sub(df, code) {
    const subfields = Array.from(df.getElementsByTagNameNS(MARC_NS, 'subfield'));
    const el = subfields.find(s => s.getAttribute('code') === code);
    return el ? el.textContent.trim() : null;
  }

  const f245 = fields('245')[0];
  let title = f245 ? sub(f245, 'a') : null;
  if (title) title = title.replace(/[\s/:,]+$/, '');

  const f100 = fields('100')[0];
  let author = f100 ? sub(f100, 'a') : null;
  if (!author) {
    const f700 = fields('700')[0];
    author = f700 ? sub(f700, 'a') : null;
  }
  if (author) author = author.replace(/[,.\s]+$/, '');

  let ageGroups = fields('385').map(df => sub(df, 'a')).filter(Boolean);
  if (ageGroups.length === 0) {
    ageGroups = fields('521').map(df => sub(df, 'a')).filter(Boolean);
  }

  const subjectCandidates = fields('655')
    .filter(df => sub(df, '9') === 'nob')
    .map(df => sub(df, 'a'))
    .filter(Boolean);

  const seenSubjects = new Set();
  const subjects = [];
  for (const s of subjectCandidates) {
    const key = s.toLowerCase();
    if (seenSubjects.has(key)) continue;
    seenSubjects.add(key);
    subjects.push(s);
  }

  return { title, author, ageGroups, subjects };
}
