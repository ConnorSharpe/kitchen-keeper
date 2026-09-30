import { z } from 'zod';
import { searchRecipesAndMeals as searchService } from '../../retrieval/searchService.js';
import { captureExceptionSafely } from '../../../instrument.js';

// TASK-069 §2.7. Results are untrusted user data: returned only as structured tool-result JSON
// with a fixed field set and bounded snippets, never as instructions.

const DAY_MS = 24 * 60 * 60 * 1000;
const SNIPPET_MAX = 300;

// Inclusive calendar date (UTC). Round-trips through Date to reject impossible dates (2026-02-30).
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Invalid calendar date');

const searchSchema = z
  .object({
    query: z.string().min(1).max(500),
    source_types: z.array(z.enum(['recipe', 'meal_log'])).optional(),
    date_from: calendarDate.optional(),
    date_to: calendarDate.optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .refine((a) => !a.date_from || !a.date_to || a.date_from <= a.date_to, 'date_from is after date_to');

export async function searchRecipesAndMeals(args, ctx) {
  let parsed;
  try {
    parsed = searchSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid data: ${e.message}` };
  }

  // Inclusive dates → half-open UTC interval [date_from 00:00Z, (date_to + 1 day) 00:00Z).
  const dateFrom = parsed.date_from ? new Date(`${parsed.date_from}T00:00:00.000Z`) : undefined;
  const dateTo = parsed.date_to
    ? new Date(new Date(`${parsed.date_to}T00:00:00.000Z`).getTime() + DAY_MS)
    : undefined;

  let found;
  try {
    found = await searchService(ctx.householdId, {
      query: parsed.query,
      sourceTypes: parsed.source_types,
      dateFrom,
      dateTo,
      limit: parsed.limit ?? 5,
    });
  } catch (err) {
    captureExceptionSafely(err, { requestId: ctx.requestId });
    return { ok: false, error: 'search_unavailable' };
  }

  return {
    ok: true,
    mode: found.mode,
    results: found.results.map((r) => ({
      source_type: r.source_type,
      source_id: r.source_id,
      title: r.title,
      snippet: String(r.snippet ?? '').slice(0, SNIPPET_MAX),
      occurred_at: r.occurred_at,
    })),
  };
}
