import { lookupBook } from '../../application/use_cases/lookupBook.js';
import { makeBrowserFetchText } from '../../infrastructure/http/browserFetch.js';
import { parseXml, parseHtml, findAll, getTextContent } from '../../infrastructure/html/browserDom.js';
import { cleanIsbn, normalizeScannedCode } from '../../infrastructure/isbn/isbn.js';
import { buildSruUrl } from '../../infrastructure/nb_sru/sruClient.js';
import { summarizeAgeGroups } from '../../application/formatters/ageSummary.js';

// ── Konfigurasjon ──────────────────────────────────────────────────────────────

const CORS_PROXY_BASE = (window.APP_CONFIG && window.APP_CONFIG.corsProxyBase) || '';
const CAMERA_TEST_MODE = false;
const BUILD_COMMIT = '21e9d36';
const BUILD_TIME = '13. april 2026 23:27';
const GITHUB_REPO = 'josteinaj/show-age-from-isbn-barcode';

// ── Adapters ───────────────────────────────────────────────────────────────────

const fetchText = makeBrowserFetchText(CORS_PROXY_BASE);

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatEventLink(text, url) {
  return `<a href="${escapeHtmlAttr(url)}" target="_blank">${escapeHtml(text)}</a>`;
}

function linkifyEventText(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => (
    `<a href="${escapeHtmlAttr(url)}" target="_blank">${escapeHtml(url)}</a>`
  ));
}

// ── UI-elementer ───────────────────────────────────────────────────────────────

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
const manualLookupFormEl = document.getElementById('manual-lookup-form');
const manualIsbnInputEl = document.getElementById('manual-isbn-input');
const scanHistorySectionEl = document.getElementById('scan-history-section');
const scanHistoryListEl = document.getElementById('scan-history-list');

// ── Tilstand ───────────────────────────────────────────────────────────────────

let scanHistory = [];
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
let lookupInProgress = false;

// ── Skannerhistorikk ───────────────────────────────────────────────────────────

function renderScanHistory() {
  scanHistoryListEl.innerHTML = '';
  scanHistory.forEach(scan => {
    const li = document.createElement('li');
    const eventsHtml = (scan.events && scan.events.length > 0)
      ? `<ul class="scan-history-events">${scan.events.map(ev => `<li>${linkifyEventText(ev)}</li>`).join('')}</ul>`
      : '';

    li.innerHTML = `
      <div class="scan-history-isbn">
        <a href="#" data-sru-url="${escapeHtml(scan.sruUrl)}" target="_blank">${escapeHtml(scan.isbn)}</a>
      </div>
      <div class="scan-history-status">${escapeHtml(scan.status)}</div>
      ${eventsHtml}
    `;
    scanHistoryListEl.appendChild(li);
  });

  scanHistorySectionEl.hidden = scanHistory.length === 0;

  document.querySelectorAll('#scan-history-list a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('data-sru-url');
      if (url) window.open(url, '_blank');
    });
  });
}

function addToScanHistory(isbn, sruUrl, status, events = []) {
  scanHistory.unshift({ isbn, sruUrl, status, events, time: new Date().toLocaleTimeString('nb-NO') });
  if (scanHistory.length > 20) scanHistory.pop();
  renderScanHistory();
}

// ── UI-visning ─────────────────────────────────────────────────────────────────

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
  const age = summarizeAgeGroups(book.ageGroups);

  if (age.hasAge) {
    ageBadgeEl.innerHTML = `<span class="age-badge-average">${age.averageAge} år</span><span class="age-badge-range">${age.mergedRangeLabel}</span>`;
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

// ── Kamera ─────────────────────────────────────────────────────────────────────

function isFirefoxOniPhone() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) && /FxiOS/i.test(ua);
}

function formatCameraError(err) {
  const name = err && err.name ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return 'Kameratilgang ble blokkert. Tillat kamera i nettleserinnstillinger og prøv igjen.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'Fant ikke noe kamera på enheten.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'Kameraet er opptatt av en annen app. Lukk andre apper som bruker kamera og prøv igjen.';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError')
    return 'Kunne ikke velge ønsket kamera. Prøver alternativ kamera.';
  if (String(err && err.message || '') === 'ZXING_NOT_AVAILABLE')
    return 'Kamera startet, men kunne ikke laste fallback-strekkodeleser.';
  if (isFirefoxOniPhone())
    return 'Firefox på iPhone kan ha problemer med kameratilgang. Prøv å åpne siden i Safari.';
  return 'Kunne ikke starte kamera. Gi appen kameratilgang og prøv igjen.';
}

function stopBarcodeDetectionLoop() {
  if (detectorTimer) { clearTimeout(detectorTimer); detectorTimer = null; }
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
        if (rawValue) await onDetected(rawValue);
      }
    } catch (err) {
      console.warn('Strekkodedeteksjon feilet for en frame:', err);
    }
    detectorTimer = setTimeout(loop, 180);
  };
  loop();
}

async function startZxingFallbackDetection() {
  if (!window.ZXingBrowser || !window.ZXing) throw new Error('ZXING_NOT_AVAILABLE');

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
    if (text) await onDetected(text);
  });
}

async function startCameraPreview() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw new Error('UNSUPPORTED_MEDIA_DEVICES');

  stopCameraStream();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  cameraStream = stream;
  const videoEl = ensureCameraPreviewElement();
  videoEl.srcObject = stream;
  await videoEl.play();
  cameraVideoEl = videoEl;
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
      if (hasNativeBarcodeDetector) await startBarcodeDetection();
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

// ── Skanning ───────────────────────────────────────────────────────────────────

async function onDetected(code) {
  const normalizedCode = normalizeScannedCode(code);
  if (!(normalizedCode.length === 10 || normalizedCode.length === 13)) return;

  const now = Date.now();
  if (normalizedCode === lastCode && now - lastCodeTime < 5000) return;
  if (paused) return;

  lastCode = normalizedCode;
  lastCodeTime = now;
  paused = true;
  lookupInProgress = true;

  hideResult();
  setStatus('Slår opp bok…');

  try {
    const result = await lookupBook(normalizedCode, {
      fetchText,
      parseXml,
      parseHtml,
      findAll,
      getTextContent,
      formatEventLink,
      onProgress: (msg) => setStatus(msg),
    });
    const { book, sruUrl, events, source } = result;

    if (book) {
      let status = 'Funnet';
      if (source === 'bokelskere-title-fallback' || source === 'nb-title-fallback') {
        status = book.ageGroups && book.ageGroups.length > 0
          ? 'Funnet via fallback'
          : 'Funnet via fallback (ingen alder)';
      }
      addToScanHistory(normalizedCode, sruUrl, status, events || []);
      statusEl.hidden = true;
      showResult(book);
    } else {
      addToScanHistory(normalizedCode, sruUrl, 'Ikke funnet', events || []);
      setStatus(`Ingen oppføring funnet for ISBN: ${normalizedCode}`, 'error');
      scheduleResume(4000);
    }
  } catch (err) {
    addToScanHistory(normalizedCode, buildSruUrl(normalizedCode), 'Feil ved oppslag');
    console.error('Oppslagsfeil:', err);
    const msg = CORS_PROXY_BASE
      ? 'Feil ved oppslag. Sjekk internettilkoblingen.'
      : 'CORS-feil: sett opp proxy.';
    setStatus(msg, 'error');
    scheduleResume(5000);
  } finally {
    lookupInProgress = false;
  }
}

function scheduleResume(ms) {
  setTimeout(resume, ms);
}

function isCameraActive() {
  return Boolean(cameraStream || zxingControls);
}

function resume() {
  if (CAMERA_TEST_MODE) {
    setStatus('Kamera aktivt (testmodus uten strekkodeleser)', 'scanning');
    return;
  }
  hideResult();
  lastCode = '';
  paused = false;
  if (isCameraActive()) {
    setStatus('Pek kamera mot ISBN-strekkoden', 'scanning');
  } else {
    setStatus('Skriv ISBN i feltet eller start kamera.');
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderBuildInfo();

  const scanAgainBtn = document.getElementById('scan-again-btn');
  scanAgainBtn.addEventListener('click', resume);
  if (CAMERA_TEST_MODE) scanAgainBtn.hidden = true;

  startBtnEl.addEventListener('click', () => { initScanner(); });
  manualLookupFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    if (lookupInProgress) return;
    if (paused) resume();

    const normalizedCode = normalizeScannedCode(manualIsbnInputEl.value.trim());
    if (!(normalizedCode.length === 10 || normalizedCode.length === 13)) {
      setStatus('Skriv inn et gyldig ISBN-10 eller ISBN-13.', 'error');
      return;
    }

    manualIsbnInputEl.value = normalizedCode;
    onDetected(normalizedCode);
  });
});
