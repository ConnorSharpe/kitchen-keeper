import { RRF_RANK_CONSTANT } from './constants.js';

export { RRF_RANK_CONSTANT };

/**
 * Reciprocal rank fusion. Pure and deterministic.
 *
 * @param {string[][]} lists  ranked lists of document keys, best first
 * @param {{ rankConstant: number }} options
 * @returns {Array<{ id: string, score: number }>} fused entries, best first. Equal scores keep
 *   first-seen order (lists in order, then ranks within each list).
 */
export function reciprocalRankFusion(lists, { rankConstant }) {
  const entries = new Map();
  for (const list of lists) {
    list.forEach((id, index) => {
      const contribution = 1 / (rankConstant + index + 1);
      const entry = entries.get(id);
      if (entry) entry.score += contribution;
      else entries.set(id, { id, score: contribution, firstSeen: entries.size });
    });
  }
  return [...entries.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map(({ id, score }) => ({ id, score }));
}
