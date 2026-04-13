// CORS-proxy URL comes from config.js. Keep empty string for local-only testing.
const CORS_PROXY_BASE = (window.APP_CONFIG && window.APP_CONFIG.corsProxyBase) || '';

// ── Nasjonalbibliotekets SRU-endpoint ──────────────────────────────────────────
const SRU_BASE = 'https://sru.aja.bs.no/mlnb';

// ── ISBN-verktøy ───────────────────────────────────────────────────────────────

function cleanIsbn(raw) {
  return raw.replace(/[^0-9Xx]/g, '');
}

/**
 * Konverter ISBN-10 til ISBN-13.
 * Ta de 9 første sifrene, prepend "978", beregn nytt sjekksiffer.
 */
function isbn10ToIsbn13(isbn10) {
  const digits = isbn10.replace(/[^0-9Xx]/gi, '');
  if (digits.length !== 10) return null;

  const base = '978' + digits.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

// ── API-kall ───────────────────────────────────────────────────────────────────

async function fetchXml(isbn) {
  const sruUrl = `${SRU_BASE}?operation=searchRetrieve&query=dc.identifier=${encodeURIComponent(isbn)}&recordSchema=marc21`;
  const url = CORS_PROXY_BASE ? `${CORS_PROXY_BASE}/?url=${encodeURIComponent(sruUrl)}` : sruUrl;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Slå opp ISBN. Prøver opprinnelig ISBN, og hvis ingen treff og det er
 * ISBN-10, konverterer til ISBN-13 og prøver igjen.
 */
async function lookupBook(rawIsbn) {
  const isbn = cleanIsbn(rawIsbn);

  let xml = await fetchXml(isbn);
  let book = parseMarc(xml);
  if (book) return book;

  if (isbn.length === 10) {
    const isbn13 = isbn10ToIsbn13(isbn);
    if (isbn13) {
      xml = await fetchXml(isbn13);
      book = parseMarc(xml);
      if (book) return book;
    }
  }

  return null;
}

// ── MARC 21 XML-parser ─────────────────────────────────────────────────────────

const MARC_NS = 'info:lc/xmlns/marcxchange-v1';

function parseMarc(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  if (doc.querySelector('parsererror')) return null;

  const countEl = doc.getElementsByTagName('numberOfRecords')[0];
  if (!countEl || parseInt(countEl.textContent.trim(), 10) === 0) return null;

  const datafields = Array.from(doc.getElementsByTagNameNS(MARC_NS, 'datafield'));

  function fields(tag) {
    return datafields.filter(el => el.getAttribute('tag') === tag);
  }

  function sub(df, code) {
    const el = Array.from(df.getElementsByTagNameNS(MARC_NS, 'subfield'))
      .find(s => s.getAttribute('code') === code);
    return el ? el.textContent.trim() : null;
  }

  // Tittel: 245 $a, fjern etterfølgende skilletegn
  const f245 = fields('245')[0];
  let title = f245 ? sub(f245, 'a') : null;
  if (title) title = title.replace(/[\s/:,]+$/, '');

  // Forfatter: 100 $a (primær), fallback 700 $a (biinnfører)
  const f100 = fields('100')[0];
  let author = f100 ? sub(f100, 'a') : null;
  if (!author) {
    const f700 = fields('700')[0];
    author = f700 ? sub(f700, 'a') : null;
  }
  if (author) author = author.replace(/[,.\s]+$/, '');

  // Anbefalt alder: felt 385 $a (primær per nortarget)
  let ageGroups = fields('385').map(df => sub(df, 'a')).filter(Boolean);

  // Fallback til felt 521 $a
  if (ageGroups.length === 0) {
    ageGroups = fields('521').map(df => sub(df, 'a')).filter(Boolean);
  }

  // Emneord: felt 655 der subfield code="9" = "nob" → $a
  const subjects = fields('655')
    .filter(df => sub(df, '9') === 'nob')
    .map(df => sub(df, 'a'))
    .filter(Boolean);

  return { title, author, ageGroups, subjects };
}

// ── UI ─────────────────────────────────────────────────────────────────────────

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const ageBadgeEl = document.getElementById('result-age');
const titleEl = document.getElementById('result-title');
const authorEl = document.getElementById('result-author');
const subjectsEl = document.getElementById('result-subjects');

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
  statusEl.hidden = false;
}

function showResult(book) {
  resultEl.hidden = false;

  if (book.ageGroups.length > 0) {
    ageBadgeEl.textContent = book.ageGroups.join(' · ');
    ageBadgeEl.className = 'age-badge';
  } else {
    ageBadgeEl.textContent = 'Ingen aldersanbefaling';
    ageBadgeEl.className = 'age-badge age-unknown';
  }

  titleEl.textContent = book.title || '(ukjent tittel)';
  authorEl.textContent = book.author || '';

  if (book.subjects.length > 0) {
    subjectsEl.innerHTML = book.subjects
      .map(s => `<span class="subject-tag">${escapeHtml(s)}</span>`)
      .join('');
  } else {
    subjectsEl.innerHTML = '';
  }
}

function hideResult() {
  resultEl.hidden = true;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Strekkodeskanner ───────────────────────────────────────────────────────────

let scanner = null;
let scannerControls = null;
let scannerStarted = false;
let paused = false;
let lastCode = '';
let lastCodeTime = 0;

function normalizeScannedCode(raw) {
  const cleaned = (raw || '').replace(/[^0-9Xx]/g, '');

  // Many book barcodes include add-on digits (EAN-13 + addon);
  // keep the ISBN core if we can detect it.
  if (cleaned.length > 13 && (cleaned.startsWith('978') || cleaned.startsWith('979'))) {
    return cleaned.slice(0, 13);
  }

  return cleaned;
}

async function chooseBackCameraId() {
  const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
  if (!devices || devices.length === 0) return undefined;

  const backDevice = devices.find(d => /back|rear|environment/i.test(d.label));
  return (backDevice || devices[0]).deviceId;
}

async function initScanner() {
  if (scannerStarted) return;

  if (!window.ZXingBrowser) {
    setStatus('Kunne ikke laste skannebiblioteket.', 'error');
    return;
  }

  setStatus('Starter kamera…');

  const hints = new Map();
  hints.set(ZXingBrowser.DecodeHintType.POSSIBLE_FORMATS, [
    ZXingBrowser.BarcodeFormat.EAN_13,
    ZXingBrowser.BarcodeFormat.EAN_8,
    ZXingBrowser.BarcodeFormat.UPC_A,
    ZXingBrowser.BarcodeFormat.UPC_E,
    ZXingBrowser.BarcodeFormat.CODE_128,
  ]);

  scanner = new ZXingBrowser.BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 500,
  });

  try {
    const videoEl = document.getElementById('camera-preview');
    const deviceId = await chooseBackCameraId();

    scannerControls = await scanner.decodeFromVideoDevice(deviceId, videoEl, (result, error) => {
      if (result) {
        onDetected(result.getText());
      }
      if (error && !(error instanceof ZXingBrowser.NotFoundException)) {
        // Ignore normal "not found" while scanning, but keep useful diagnostics.
        console.debug('Scan warning:', error.message || error);
      }
    });

    scannerStarted = true;
    document.getElementById('start-camera-btn').hidden = true;
    setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
  } catch (err) {
    console.error('Kamerafeil:', err);
    setStatus(
      'Kunne ikke starte kamera. Sjekk kameratilgang i Safari-innstillinger og prøv igjen.',
      'error'
    );
  }
}

async function onDetected(code) {
  const normalizedCode = normalizeScannedCode(code);
  if (!(normalizedCode.length === 10 || normalizedCode.length === 13)) {
    return;
  }

  const now = Date.now();
  // Ignorer samme kode i 5 sekunder for å unngå doble oppslag
  if (normalizedCode === lastCode && now - lastCodeTime < 5000) return;
  if (paused) return;

  lastCode = normalizedCode;
  lastCodeTime = now;
  paused = true;
  try { scanner.pause(true); } catch (_) {}

  hideResult();
  setStatus('Slår opp bok…');

  try {
    const book = await lookupBook(normalizedCode);
    if (book) {
      statusEl.hidden = true;
      showResult(book);
    } else {
      setStatus(`Ingen oppføring funnet for ISBN: ${normalizedCode}`, 'error');
      scheduleResume(4000);
    }
  } catch (err) {
    console.error('Oppslagsfeil:', err);
    const msg = CORS_PROXY_BASE
      ? 'Feil ved oppslag. Sjekk internettilkoblingen.'
      : 'CORS-feil: sett opp proxy (se app.js for instruksjoner).';
    setStatus(msg, 'error');
    scheduleResume(5000);
  }
}

function scheduleResume(ms) {
  setTimeout(resume, ms);
}

function resume() {
  hideResult();
  lastCode = '';
  paused = false;
  setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scan-again-btn').addEventListener('click', resume);
  document.getElementById('start-camera-btn').addEventListener('click', initScanner);
});
