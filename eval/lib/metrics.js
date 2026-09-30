// TASK-069 §2.8: pure eval metrics (retrieval + agent answer matching).

const nonNull = (values) => values.filter((v) => v !== null && v !== undefined);

/** Fraction of expected keys found in the first k results; null if none expected. */
export function recallAtK(resultKeys, expectedKeys, k) {
  const expected = new Set(expectedKeys);
  if (expected.size === 0) return null;
  const top = new Set(resultKeys.slice(0, k));
  let hits = 0;
  for (const key of expected) if (top.has(key)) hits++;
  return hits / expected.size;
}

/** 1/rank of the first expected result within the first k; 0 if none; null if none expected. */
export function reciprocalRankAtK(resultKeys, expectedKeys, k) {
  const expected = new Set(expectedKeys);
  if (expected.size === 0) return null;
  const idx = resultKeys.slice(0, k).findIndex((key) => expected.has(key));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/** Mean of non-null values; null if none. */
export function mean(values) {
  const v = nonNull(values);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}

/** Fraction of non-null counts greater than zero; null if no non-null counts. */
export function nonemptyRate(counts) {
  const v = nonNull(counts);
  return v.length === 0 ? null : v.filter((c) => c > 0).length / v.length;
}

/** Linear-interpolation percentile (numpy type 7), p in 0..100; null for empty. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const h = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Summary distribution of values. */
export function distribution(values) {
  return {
    n: values.length,
    min: percentile(values, 0),
    p10: percentile(values, 10),
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    max: percentile(values, 100),
  };
}

/** Contiguous [lo,hi) buckets from min to max, including empty ones. */
export function histogram(values, width = 0.05) {
  if (values.length === 0) return [];
  const round = (x) => Math.round(x * 1e6) / 1e6;
  const index = (v) => Math.floor(v / width + 1e-9);
  const first = index(Math.min(...values));
  const last = index(Math.max(...values));
  const buckets = [];
  for (let i = first; i <= last; i++) {
    buckets.push({ lo: round(i * width), hi: round((i + 1) * width), count: 0 });
  }
  for (const v of values) buckets[index(v) - first].count++;
  return buckets;
}

/** Lowercase, strip accents and apostrophes, collapse non-alphanumerics to single spaces. */
export function normalizeForMatch(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True if any non-empty candidate appears in the reply as whole words. */
export function answerMatches(reply, candidates) {
  const hay = ` ${normalizeForMatch(reply)} `;
  return candidates.some((c) => {
    const n = normalizeForMatch(c);
    return n !== '' && hay.includes(` ${n} `);
  });
}
