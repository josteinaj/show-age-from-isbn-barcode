function parseAgeRange(label) {
  if (!label) return null;
  const m = String(label).match(/(\d{1,2})\s*-\s*(\d{1,2})\s*år/i);
  if (!m) return null;

  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) return null;
  return { min, max };
}

export function summarizeAgeGroups(ageGroups) {
  const labels = Array.isArray(ageGroups) ? ageGroups : [];
  const ranges = labels
    .map(parseAgeRange)
    .filter(Boolean)
    .sort((a, b) => a.min - b.min || a.max - b.max);

  if (ranges.length === 0) {
    return {
      hasAge: false,
      averageAge: null,
      mergedRangeLabel: '',
      mergedLabels: [...new Set(labels.filter(Boolean))],
    };
  }

  const merged = [];
  for (const r of ranges) {
    if (merged.length === 0) {
      merged.push({ ...r });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (r.min <= prev.max + 1) {
      if (r.max > prev.max) prev.max = r.max;
    } else {
      merged.push({ ...r });
    }
  }

  const fullMin = merged[0].min;
  const fullMax = merged[merged.length - 1].max;

  return {
    hasAge: true,
    averageAge: Math.floor((fullMin + fullMax) / 2),
    mergedRangeLabel: `${fullMin}-${fullMax} år`,
    mergedLabels: merged.map(r => `${r.min}-${r.max} år`),
  };
}
