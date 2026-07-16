import { normalizeFood } from '../utils/foodNormalization.js';

const PURINE_KEYWORDS = {
  high: [
    'organ meat',
    'liver',
    'kidney',
    'beef heart',
    'pork heart',
    'chicken heart',
    'lamb heart',
    'duck heart',
    'sweetbread',
    'anchovy',
    'sardine',
    'herring',
    'mackerel',
    'sprat',
    'mussel',
    'scallop',
    'game meat',
    'venison',
    'goose',
    'yeast extract',
    'marmite',
    "brewer's yeast",
  ],
  medium: [
    'beef',
    'pork',
    'lamb',
    'veal',
    'chicken',
    'turkey',
    'duck',
    'crab',
    'lobster',
    'oyster',
    'prawn',
    'shrimp',
    'spinach',
    'asparagus',
    'cauliflower',
    'lentil',
    'kidney bean',
    'chickpea',
    'pea',
    'oatmeal',
    'wheat germ',
  ],
};

// Word-boundary match for purine keywords.
// Prevents "pear" matching "pea" and "sweetbreads" matching unexpected substrings.
// Verified: "pear".includes("pea") === true (false positive without this fix).
function matchesPurineKeyword(name, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(name);
}

// Global keyword list sorted by length descending.
// This ensures compound forms (e.g. "beef heart" 9 chars, HIGH) always take precedence
// over their shorter base words (e.g. "beef" 4 chars, MEDIUM) regardless of level order.
// It also handles "kidney bean" (11 chars, MEDIUM) beating "kidney" (6 chars, HIGH).
const ALL_KEYWORDS = [
  ...PURINE_KEYWORDS.high.map((k) => ({ keyword: k, level: 'high' })),
  ...PURINE_KEYWORDS.medium.map((k) => ({ keyword: k, level: 'medium' })),
].sort((a, b) => b.keyword.length - a.keyword.length);

export function getPurineLevel(itemName, category) {
  const name = normalizeFood(itemName);
  // normalizeFood maps "heart of palm" → "palm vegetable" before this check,
  // preventing the 'heart' keyword from matching the low-purine vegetable.
  for (const { keyword, level } of ALL_KEYWORDS) {
    if (matchesPurineKeyword(name, keyword)) return level;
  }
  if (category === 'Meat' || category === 'Seafood') return 'medium';
  return 'low';
}
