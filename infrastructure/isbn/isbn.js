export function cleanIsbn(raw) {
  return raw.replace(/[^0-9Xx]/g, '');
}

export function isValidIsbn10(isbn10) {
  const digits = isbn10.replace(/[^0-9Xx]/gi, '').toUpperCase();
  if (digits.length !== 10) return false;
  if (!/^\d{9}[0-9X]$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * (10 - i);
  }
  const checkChar = digits[9];
  const checkDigit = checkChar === 'X' ? 10 : parseInt(checkChar, 10);
  return (sum + checkDigit) % 11 === 0;
}

export function isbn10ToIsbn13(isbn10) {
  const digits = isbn10.replace(/[^0-9Xx]/gi, '');
  if (digits.length !== 10) return null;
  if (!isValidIsbn10(digits)) return null;

  const base = '978' + digits.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

export function extractIsbnCandidatesFromText(text, { cleanIsbn: clean, isValidIsbn10: valid, isbn10ToIsbn13: to13 } = { cleanIsbn, isValidIsbn10, isbn10ToIsbn13 }) {
  const matches = text.match(/\b(?:97[89][\s-]?)?[0-9][0-9\s-]{8,}[0-9Xx]\b/g) || [];
  const isbns = new Set();

  for (const match of matches) {
    const cleaned = clean(match);
    if (cleaned.length === 13) {
      if (cleaned.startsWith('978') || cleaned.startsWith('979')) {
        isbns.add(cleaned);
      }
    } else if (cleaned.length === 10) {
      if (valid(cleaned)) {
        isbns.add(cleaned);
        const as13 = to13(cleaned);
        if (as13) isbns.add(as13);
      }
    }
  }

  return [...isbns];
}

export function normalizeScannedCode(raw) {
  const cleaned = (raw || '').replace(/[^0-9Xx]/g, '');
  if (cleaned.length > 13 && (cleaned.startsWith('978') || cleaned.startsWith('979'))) {
    return cleaned.slice(0, 13);
  }
  return cleaned;
}
