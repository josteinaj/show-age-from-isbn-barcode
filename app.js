// CORS-proxy URL comes from config.js. Keep empty string for local-only testing.
const CORS_PROXY_BASE = (window.APP_CONFIG && window.APP_CONFIG.corsProxyBase) || '';
const CAMERA_TEST_MODE = false;
const BUILD_COMMIT = 'b936bd5';
const BUILD_TIME = '13. april. 2026 21:59';
const GITHUB_REPO = 'josteinaj/show-age-from-isbn-barcode';

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

let lastSruUrl = '';
let scanHistory = [];

async function fetchXml(isbn) {
  const sruUrl = `${SRU_BASE}?operation=searchRetrieve&query=dc.identifier=${encodeURIComponent(isbn)}&recordSchema=marc21`;
  const url = CORS_PROXY_BASE ? `${CORS_PROXY_BASE}/?url=${encodeURIComponent(sruUrl)}` : sruUrl;
  lastSruUrl = sruUrl;

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
  if (book) return { book, isbn, sruUrl: lastSruUrl };

  if (isbn.length === 10) {
    const isbn13 = isbn10ToIsbn13(isbn);
    if (isbn13) {
      xml = await fetchXml(isbn13);
      book = parseMarc(xml);
      if (book) return { book, isbn: isbn13, sruUrl: lastSruUrl };
    }
  }

  return { book: null, isbn, sruUrl: lastSruUrl };
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
const buildInfoEl = document.getElementById('build-info');
const resultEl = document.getElementById('result');
const ageBadgeEl = document.getElementById('result-age');
const titleEl = document.getElementById('result-title');
const authorEl = document.getElementById('result-author');
const subjectsEl = document.getElementById('result-subjects');
const readerEl = document.getElementById('reader');
const startContainerEl = document.getElementById('start-container');
const startBtnEl = document.getElementById('start-btn');
const scanHistorySectionEl = document.getElementById('scan-history-section');
const scanHistoryListEl = document.getElementById('scan-history-list');

function renderScanHistory() {
  scanHistoryListEl.innerHTML = '';
  scanHistory.forEach(scan => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="scan-history-isbn">
        <a href="#" data-sru-url="${escapeHtml(scan.sruUrl)}" target="_blank">${escapeHtml(scan.isbn)}</a>
      </div>
      <div class="scan-history-status">${escapeHtml(scan.status)}</div>
    `;
    scanHistoryListEl.appendChild(li);
  });

  scanHistorySectionEl.hidden = scanHistory.length === 0;

  // Legg til click-handler for alle linkene
  document.querySelectorAll('#scan-history-list a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('data-sru-url');
      if (url) window.open(url, '_blank');
    });
  });
}

function addToScanHistory(isbn, sruUrl, status) {
  scanHistory.unshift({ isbn, sruUrl, status, time: new Date().toLocaleTimeString('nb-NO') });
  // Behold maksimalt 20 oppføringer i historikken
  if (scanHistory.length > 20) scanHistory.pop();
  renderScanHistory();
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
  statusEl.hidden = false;
}

function renderBuildInfo() {
  const commitUrl = `https://github.com/${GITHUB_REPO}/commit/${BUILD_COMMIT}`;
  buildInfoEl.innerHTML = `<a href="${commitUrl}" target="_blank" class="build-link">${BUILD_COMMIT} · ${BUILD_TIME}</a>`;
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

let paused = false;
let lastCode = '';
let lastCodeTime = 0;
let isStarting = false;
let cameraStream = null;
let cameraVideoEl = null;
let detector = null;
let detectorTimer = null;
let zxingReader = null;
let zxingControls = null;

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
  if (String(err && err.message || '') === 'ZXING_NOT_AVAILABLE') {
    return 'Kamera startet, men kunne ikke laste fallback-strekkodeleser.';
  }
  if (isFirefoxOniPhone()) {
    return 'Firefox på iPhone kan ha problemer med kameratilgang. Prøv å åpne siden i Safari.';
  }
  return 'Kunne ikke starte kamera. Gi appen kameratilgang og prøv igjen.';
}

function stopBarcodeDetectionLoop() {
  if (detectorTimer) {
    clearTimeout(detectorTimer);
    detectorTimer = null;
  }
}

function stopCameraStream() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
}

function ensureCameraPreviewElement() {
  let videoEl = document.getElementById('camera-preview');
  if (!videoEl) {
    readerEl.innerHTML = '';
    videoEl = document.createElement('video');
    videoEl.id = 'camera-preview';
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    readerEl.appendChild(videoEl);
  }
  cameraVideoEl = videoEl;
  return videoEl;
}

function stopZxingReader() {
  if (zxingControls && typeof zxingControls.stop === 'function') {
    try { zxingControls.stop(); } catch (_) {}
  }
  zxingControls = null;

  if (zxingReader && typeof zxingReader.reset === 'function') {
    try { zxingReader.reset(); } catch (_) {}
  }
}

async function startBarcodeDetection() {
  if (CAMERA_TEST_MODE) return;
  if (!cameraVideoEl) return;

  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
  detector = new window.BarcodeDetector({ formats });

  const loop = async () => {
    if (paused || !cameraVideoEl || cameraVideoEl.readyState < 2) {
      detectorTimer = setTimeout(loop, 200);
      return;
    }

    try {
      const results = await detector.detect(cameraVideoEl);
      if (results && results.length > 0) {
        const rawValue = results[0].rawValue || '';
        if (rawValue) {
          await onDetected(rawValue);
        }
      }
    } catch (err) {
      console.warn('Strekkodedeteksjon feilet for en frame:', err);
    }

    detectorTimer = setTimeout(loop, 180);
  };

  loop();
}

async function startZxingFallbackDetection() {
  if (!window.ZXingBrowser || !window.ZXing) {
    throw new Error('ZXING_NOT_AVAILABLE');
  }

  const videoEl = ensureCameraPreviewElement();
  stopCameraStream();
  stopZxingReader();

  const hints = new Map();
  hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    window.ZXing.BarcodeFormat.EAN_13,
    window.ZXing.BarcodeFormat.EAN_8,
    window.ZXing.BarcodeFormat.UPC_A,
    window.ZXing.BarcodeFormat.UPC_E,
    window.ZXing.BarcodeFormat.CODE_128,
  ]);

  zxingReader = new window.ZXingBrowser.BrowserMultiFormatReader(hints, 200);

  zxingControls = await zxingReader.decodeFromVideoDevice(undefined, videoEl, async (result) => {
    if (!result) return;
    const text = typeof result.getText === 'function' ? result.getText() : (result.text || '');
    if (text) {
      await onDetected(text);
    }
  });
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
  stopBarcodeDetectionLoop();

  setStatus('Starter kamera…');

  try {
    const hasNativeBarcodeDetector = 'BarcodeDetector' in window;

    if (CAMERA_TEST_MODE || hasNativeBarcodeDetector) {
      await startCameraPreview();
    } else {
      await startZxingFallbackDetection();
    }

    startContainerEl.hidden = true;

    if (CAMERA_TEST_MODE) {
      setStatus('Kamera aktivt (testmodus uten strekkodeleser)', 'scanning');
    } else {
      setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
      if (hasNativeBarcodeDetector) {
        await startBarcodeDetection();
      }
    }
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

async function startCameraPreview() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('UNSUPPORTED_MEDIA_DEVICES');
  }

  stopCameraStream();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  cameraStream = stream;

  const videoEl = ensureCameraPreviewElement();
  videoEl.srcObject = stream;
  await videoEl.play();
  cameraVideoEl = videoEl;
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

  hideResult();
  setStatus('Slår opp bok…');

  try {
    const result = await lookupBook(normalizedCode);
    const { book, sruUrl } = result;
    
    if (book) {
      addToScanHistory(normalizedCode, sruUrl, 'Funnet');
      statusEl.hidden = true;
      showResult(book);
    } else {
      addToScanHistory(normalizedCode, sruUrl, 'Ikke funnet');
      setStatus(`Ingen oppføring funnet for ISBN: ${normalizedCode}`, 'error');
      scheduleResume(4000);
    }
  } catch (err) {
    addToScanHistory(normalizedCode, lastSruUrl, 'Feil ved oppslag');
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
  if (CAMERA_TEST_MODE) {
    setStatus('Kamera aktivt (testmodus uten strekkodeleser)', 'scanning');
    return;
  }

  hideResult();
  lastCode = '';
  paused = false;
  setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderBuildInfo();

  const scanAgainBtn = document.getElementById('scan-again-btn');
  scanAgainBtn.addEventListener('click', resume);
  if (CAMERA_TEST_MODE) {
    scanAgainBtn.hidden = true;
  }

  startBtnEl.addEventListener('click', () => {
    initScanner();
  });
});
