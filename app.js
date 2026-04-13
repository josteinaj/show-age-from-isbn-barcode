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
const readerEl = document.getElementById('reader');
const startContainerEl = document.getElementById('start-container');
const startBtnEl = document.getElementById('start-btn');

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
let paused = false;
let lastCode = '';
let lastCodeTime = 0;
let isStarting = false;

function isFirefoxOniPhone() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) && /FxiOS/i.test(ua);
}

function formatCameraError(err) {
  const name = err && err.name ? err.name : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Kameratilgang ble blokkert. Tillat kamera i nettleserinnstillinger og prøv igjen.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Fant ikke noe kamera på enheten.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kameraet er opptatt av en annen app. Lukk andre apper som bruker kamera og prøv igjen.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Kunne ikke velge ønsket kamera. Prøver alternativ kamera.';
  }
  if (isFirefoxOniPhone()) {
    return 'Firefox på iPhone kan ha problemer med kameratilgang. Prøv å åpne siden i Safari.';
  }
  return 'Kunne ikke starte kamera. Gi appen kameratilgang og prøv igjen.';
}

async function warmupCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('UNSUPPORTED_MEDIA_DEVICES');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  stream.getTracks().forEach(track => track.stop());
}

async function startScannerWithFallback(scannerConfig) {
  try {
    await scanner.start(
      { facingMode: { ideal: 'environment' } },
      scannerConfig,
      onDetected,
      () => { /* ignorerer kontinuerlige scannerrors */ }
    );
    return;
  } catch (firstErr) {
    console.warn('Primær kamerastart feilet, prøver fallback:', firstErr);
  }

  const cameras = await Html5Qrcode.getCameras();
  if (!cameras || cameras.length === 0) {
    throw new Error('NO_CAMERAS_FOUND');
  }

  const backCamera = cameras.find(c => /back|rear|environment|traseira|arriere|hinten/i.test(c.label))
    || cameras[cameras.length - 1];

  await scanner.start(
    backCamera.id,
    scannerConfig,
    onDetected,
    () => { /* ignorerer kontinuerlige scannerrors */ }
  );
}

function normalizeScannedCode(raw) {
  const cleaned = (raw || '').replace(/[^0-9Xx]/g, '');

  // Many book barcodes include add-on digits (EAN-13 + addon);
  // keep the ISBN core if we can detect it.
  if (cleaned.length > 13 && (cleaned.startsWith('978') || cleaned.startsWith('979'))) {
    return cleaned.slice(0, 13);
  }

  return cleaned;
}

async function initScanner() {
  if (isStarting) return;
  isStarting = true;

  readerEl.hidden = false;
  startBtnEl.disabled = true;
  scanner = new Html5Qrcode('reader');

  const formats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
  ];

  const scannerConfig = {
    fps: 10,
    aspectRatio: 4 / 3,
    disableFlip: true,
    // Keep a centered scanning area for faster and more stable barcode detection.
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const side = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.8);
      return { width: side, height: side };
    },
    formatsToSupport: formats,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true,
    },
  };

  setStatus('Starter kamera…');

  try {
    await warmupCameraPermission();
    await startScannerWithFallback(scannerConfig);
    startContainerEl.hidden = true;
    setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
  } catch (err) {
    console.error('Kamerafeil:', err);
    readerEl.hidden = true;
    startContainerEl.hidden = false;
    setStatus(formatCameraError(err), 'error');
  } finally {
    isStarting = false;
    startBtnEl.disabled = false;
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
  try { scanner.resume(); } catch (_) {}
  setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scan-again-btn').addEventListener('click', resume);
  startBtnEl.addEventListener('click', () => {
    initScanner();
  });
});
