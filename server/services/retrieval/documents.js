import { createHash } from 'node:crypto';

// TASK-069 §2.3: pure, deterministic document builders for the retrieval index.
// Input is the raw stored row: ingredients / steps / tags are JSON text, and scalar columns
// may be snake_case or camelCase.

/**
 * The recipe columns the builder reads. Must equal the fingerprint's column set in indexer.js
 * (a unit test enforces it), so the builder can't read a column the fingerprint ignores.
 * is_favorite and updated_at are deliberately absent.
 */
export const RECIPE_BUILDER_FIELDS = Object.freeze([
  'name',
  'description',
  'tags',
  'ingredients',
  'steps',
  'saved_at',
]);

const MAX_CONTENT = 8000;
const MAX_NAME = 200;
const MAX_TAGS = 500;
const MAX_DESCRIPTION = 1000;
const ELLIPSIS = '…';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

/** Cuts `text` to at most `max` chars (ellipsis included), at the last whitespace when possible. */
function capText(text, max) {
  if (text.length <= max) return text;
  const room = text.slice(0, max - ELLIPSIS.length);
  const lastSpace = room.search(/\s\S*$/);
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return cut.trimEnd() + ELLIPSIS;
}

function capTags(tags) {
  let body = '';
  for (const tag of tags) {
    const next = body ? `${body}, ${tag}` : String(tag);
    if (next.length > MAX_TAGS) break;
    body = next;
  }
  return body;
}

function ingredientLine(ing) {
  const name = String(ing?.name ?? '').trim();
  const amount = [ing?.quantity, ing?.unit]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .join(' ');
  return amount ? `${name} — ${amount}` : name;
}

const join = (lines) => lines.join('\n');

/**
 * @returns {{ content: string, contentHash: string, occurredAt: string }}
 *   content.length <= 8000 always; occurredAt is saved_at (never updated_at).
 */
export function buildRecipeDocument(row) {
  const name = capText(String(row.name ?? '').trim(), MAX_NAME);
  const tags = capTags(parseJsonArray(row.tags).map((t) => String(t)));
  const header = [`Recipe: ${name}`, `Tags: ${tags}`];

  const description = String(row.description ?? '').trim();
  const descriptionLines = description ? [`Description: ${capText(description, MAX_DESCRIPTION)}`] : [];

  const ingredients = parseJsonArray(row.ingredients);
  const ingredientLines = ingredients.length ? ['Ingredients:', ...ingredients.map(ingredientLine)] : [];

  const base = [...header, ...descriptionLines, ...ingredientLines];
  let content = join(base);

  if (content.length <= MAX_CONTENT) {
    // §2.3 step 3: whole steps in order, then the first that doesn't fit is cut and marked.
    const steps = parseJsonArray(row.steps).map((s, i) => `${i + 1}. ${String(s).trim()}`);
    const lines = [...base];
    let stepsHeaderAdded = false;
    for (const step of steps) {
      const prefix = stepsHeaderAdded ? [] : ['Steps:'];
      const whole = join([...lines, ...prefix, step]);
      if (whole.length <= MAX_CONTENT) {
        lines.push(...prefix, step);
        stepsHeaderAdded = true;
        continue;
      }
      const room = MAX_CONTENT - join([...lines, ...prefix]).length - 1; // - 1 for the newline
      const cut = room > ELLIPSIS.length ? capText(step, room) : '';
      if (cut.length > ELLIPSIS.length && cut.length <= room) lines.push(...prefix, cut);
      break;
    }
    content = join(lines);
  } else {
    // §2.3 step 4: no steps fit. (a) drop the description, (b) names only, (c) trailing names.
    content = join([...header, ...ingredientLines]);
    if (content.length > MAX_CONTENT) {
      const names = ingredients.map((ing) => String(ing?.name ?? '').trim());
      content = join([...header, 'Ingredients:', ...names]);
      if (content.length > MAX_CONTENT) {
        const suffixFor = (n) => `(+${n} more ingredients)`;
        const budget = MAX_CONTENT - suffixFor(names.length).length - 1;
        const kept = [...header, 'Ingredients:'];
        let length = join(kept).length;
        for (const n of names) {
          if (length + 1 + n.length > budget) break;
          kept.push(n);
          length += 1 + n.length;
        }
        const omitted = names.length - (kept.length - header.length - 1);
        content = join([...kept, suffixFor(omitted)]);
      }
    }
  }

  return {
    content,
    contentHash: sha256(content),
    occurredAt: toIso(row.saved_at ?? row.savedAt),
  };
}

/** @returns {{ content: string, contentHash: string, occurredAt: string }} occurredAt is logged_at. */
export function buildMealLogDocument(row) {
  const itemName = String(row.item_name ?? row.itemName ?? '').trim();
  const category = row.category ? ` (${row.category})` : '';
  const loggedAt = toIso(row.logged_at ?? row.loggedAt);
  const parsed = new Date(loggedAt);
  const date = Number.isNaN(parsed.getTime()) ? String(loggedAt).slice(0, 10) : parsed.toISOString().slice(0, 10);
  const wasExpiring = row.was_expiring !== undefined ? row.was_expiring : row.wasExpiring;
  const expiring = wasExpiring === true ? 'yes' : wasExpiring === false ? 'no' : 'unknown';
  const content = `Meal log: ate ${itemName}${category} on ${date}. Was expiring: ${expiring}.`;
  return { content, contentHash: sha256(content), occurredAt: loggedAt };
}
