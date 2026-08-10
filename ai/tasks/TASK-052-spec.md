# TASK-052 — Structured Outputs for the 6 JSON-Producing AI Calls

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.6/10 — approve after revisions | Praised the behavior-preserving scope, the structure/semantics split (schema vs. prompt), shared schema/helper reuse, and treating refusal/truncation as first-class new failure modes. Six required changes, all applied below: (1) `extractStructuredContent` generalized from two hardcoded checks (`refusal`, `finish_reason === 'length'`) to bucket on any non-`'stop'` finish reason, catching `content_filter` and any future value, not just the two known today; (2) retry policy in `parseRecipeImage` tightened and given real rationale — only `length`/`parse_failed` (transient) retries, refusal/content_filter (policy-driven, won't improve on retry) do not, and the "why only this function" question answered with a concrete infra reason (RETRY_BUDGET_MS's 18s/40s accounting doesn't exist elsewhere) rather than "matches existing behavior"; (3) logging standardized on one `structured_status` field (`ok`/`refusal`/`length`/`content_filter`/`parse_failed`) computed uniformly across all 6 functions, via a `PARSE_FAILED` sentinel pattern extended from `parseRecipeImage` (previously the only user of it) to all six; (4) schema export/test-import strategy stated explicitly; (5) D-2 extended with an explicit future file-split threshold; (6) new automated test asserting every schema round-trips through the exact `response_format` object shape used in production. One point pushed back on rather than applied as suggested: the reviewer's claim that all "six hand-written JSON Schemas" duplicate existing Zod validators was checked against the actual code and found to apply to only 1 of 6 (`PARSED_RECIPE_SCHEMA`, plus indirectly `enrichRecipeFields`'s fields via the merge) — the other 3 have no pre-existing counterpart at all. The reviewer's preferred remedy (generate JSON Schema from Zod) was declined with a concrete reason (Zod's optional/coerce/default semantics don't map onto strict-mode's required-nullable/no-coercion rules, and codegen would need a new npm dependency); their fallback remedy (document + synchronize) was adopted, strengthened with a real automated key-set cross-check test (D-9) rather than a comment alone. |
| DRAFT-2 | 9.9/10 — APPROVED FOR IMPLEMENTATION | Confirmed every round-1 change was correctly applied, specifically praising the `finish_reason !== 'stop'` generalization, the justified (not historical) retry policy, the unified `structured_status` vocabulary, the honest schema-duplication scoping (1 of 6, not 6 of 6), and the explicit export strategy. No required changes. One accepted-and-applied optional suggestion: `parseStructuredResponse`, a single helper collapsing the extract/parse/derive-status sequence each of the 6 call sites was still repeating inline — the reviewer flagged this as "where the implementation will naturally end up" and it was folded in now (Design 1) rather than left as an implementation-time surprise, since it completes D-1's original goal (avoid 6 duplicated sequences) rather than leaving it half done. Two non-blocking observations explicitly not requiring changes: the JSON-serialization test is a smoke test, not a deep guarantee (already scoped that way, no over-claiming to walk back); `ENRICH_RECIPE_FIELDS_SCHEMA`'s indirect overlap with the Zod validator was flagged as a minor nit the reviewer confirmed the spec already accounts for in D-9's wording. |

---

## Request

TASK-051's research pass identified this as deferred finding #1 (of 5 remaining, see
[TASK-051-spec.md](TASK-051-spec.md#related-findings-not-addressed-by-this-task-remaining-5-for-future-task-planning)):
4 of the app's 7 AI calls (`parseReceipt`, `parseRecipeImage`, `parseRecipeText`, `enrichRecipeFields`)
rely on prompt-instructed JSON + regex-stripped markdown fences (`safeParseJSON`,
[aiService.js:14-27](../../server/services/aiService.js)) with no `response_format` at all; the other 2
JSON-producing calls (`eatThisNow`, `expandSuggestion`) use the weaker `response_format: { type:
'json_object' }` mode, which guarantees valid JSON but not schema-conformant JSON. (`chat` is the app's
7th AI call and is explicitly out of scope — it uses OpenAI tool/function calling, a different, already
schema-constrained mechanism; see Current Behavior.)

Connor asked for a spec covering exactly this finding: move all 6 calls onto OpenAI's Structured Outputs
(`response_format: { type: 'json_schema', json_schema: { strict: true, schema: {...} } }`), which uses
constrained decoding so the model literally cannot emit a token that would violate the schema — eliminating
the JSON-parse-failure class of error these 6 calls currently defend against with `safeParseJSON`'s
fallback-on-failure pattern, and (for `parseRecipeImage`) a same-call retry loop.

Per the efficiency-guide research done before drafting this (see Research below), structured outputs
trades JSON-parse-failure risk for two new, different failure modes — a moderation **refusal**
(`message.refusal` populated) and **output truncation** (`finish_reason === 'length'`) — neither of which
existed as a distinguishable case before. This spec's Design section handles both explicitly rather than
treating this as a drop-in `response_format` swap.

---

## Current Behavior (confirmed by reading the code)

**Six functions in [aiService.js](../../server/services/aiService.js) produce JSON via prompt instruction,
not schema enforcement:**

| Function | Current `response_format` | Prompt-instructed shape |
|---|---|---|
| `eatThisNow` (line 268) | `{ type: 'json_object' }` | Array wrapped in prose (`Respond with a JSON array:\n[{...}]`) |
| `expandSuggestion` (line 320) | `{ type: 'json_object' }` | Object, full shape spelled out in prose |
| `parseReceipt` (line 376) | none | Array, full shape + a long block of classification-judgment rules |
| `parseRecipeImage` (line 451) | none | Object, full shape spelled out in prose |
| `parseRecipeText` (line 541) | none | Object — comment at line 534-537 already states it "Mirrors
  `parseRecipeImage`'s JSON contract" |
| `enrichRecipeFields` (line 612) | none | Object, prompt says "Omit any field you cannot determine
  rather than guessing" |

All six route their raw `message.content` string through `safeParseJSON` (line 14), which strips markdown
fences the model may add despite instructions, then `JSON.parse`s, returning a caller-supplied `fallback`
(`[]`, `null`, or `PARSE_FAILED`) on any parse error. Only `parseRecipeImage` (lines 497-521) additionally
retries once, within an 18-second budget, when `safeParseJSON` returns its `PARSE_FAILED` sentinel — the
other five functions have no retry and simply return their fallback on the first failure.

**`eatThisNow`'s and `parseReceipt`'s caller-side unwrap code already anticipates an object wrapper.**
`eatThisNow` (lines 310-313): `Array.isArray(parsed) ? parsed : (parsed.suggestions ?? parsed.meals ?? [])`.
`parseReceipt` (line 423): `Array.isArray(parsed) ? parsed : (parsed.items ?? [])`. Neither function's
prompt currently asks the model for that wrapper shape — this fallback path is presently unreachable
given the current array-only prompt instructions, but both are relevant to Design below since Structured
Outputs requires a JSON **object** at the schema root, not a bare array (confirmed in Research).

**`enrichRecipeFields`'s one caller already treats a missing key and an explicit `null` identically.**
[ai.js:353-361](../../server/routes/ai.js) merges the result with `raw.servings ?? enrichment.servings ??
null` (and the same `??` pattern for `prepMins`/`cookMins`/`description`; `tags` uses
`enrichment.tags ?? []`) — `??` treats `undefined` and `null` the same way. This matters directly for
Design 6 below.

**`parseRecipeText` has a documented "no recipe found" escape hatch** the model is told to use instead of
guessing: `{ "name": "", "ingredients": [], "steps": [] }` (line 559-560), checked by the caller's `usable`
gate at line 578-579 and again in [ai.js:371](../../server/routes/ai.js). This must keep working under a
schema that requires every field present (see Design 7).

**`chat` (line 682) is unaffected by this task.** It uses `PANTRY_TOOLS` (OpenAI function/tool-calling,
lines 40-262) via `provider.startChatSession`/`sendMessage` in
[openaiProvider.js](../../server/services/ai/openaiProvider.js) — a separate, already schema-constrained
mechanism (each tool's `parameters` is itself a JSON Schema the model must satisfy to call that tool).
Structured Outputs' `response_format: json_schema` is for freeform-JSON chat completions, a different
API surface; there is nothing to migrate here.

**Model support:** all six functions use `gpt-4o-mini` or `gpt-4o` (model-family aliases, not dated
snapshots — [aiService.js:288, 346, 380, 457, 542, 619](../../server/services/aiService.js)). Structured
Outputs requires `gpt-4o-mini-2024-07-18`/`gpt-4o-2024-08-06` or later; the family aliases have pointed
past those snapshots for well over a year as of this writing (see Constraints).

---

## Research

- [OpenAI: Introducing Structured Outputs in the API](https://openai.com/index/introducing-structured-outputs-in-the-api/)
  — constrained decoding guarantees schema-conformant output; supported model snapshots.
- [OpenAI: Structured model outputs (API guide)](https://developers.openai.com/api/docs/guides/structured-outputs)
  — `strict: true` requirement, `additionalProperties: false` at every object level, all properties must
  be listed in `required` (optional fields expressed as a nullable union type, not omission), schema
  root must be an object (not an array), refusal (`message.refusal`) as a first-class response field.
- [Schema `additionalProperties` must be false when strict is true — OpenAI Developer Community](https://community.openai.com/t/schema-additionalproperties-must-be-false-when-strict-is-true/929996)
  and [OpenAI structured outputs JSON schema: a practical guide — CodeWords](https://www.codewords.ai/blog/openai-structured-outputs-json-schema)
  — confirms `additionalProperties: false` and full `required` lists are needed at **every** nesting
  level, not just the root; up to 5 levels of nesting supported; keep schemas well under ~30 fields to
  avoid added latency/refusal risk (all 6 schemas below are 5-9 fields, well inside this).
- [Structured Outputs sometimes failing due to "Could not parse response content as the length limit was
  reached" — OpenAI Developer Community](https://community.openai.com/t/structured-outputs-sometimes-failing-due-to-could-not-parse-response-content-as-the-length-limit-was-reached/1130878)
  and the Python SDK's `LengthFinishReasonError` behavior — confirms `finish_reason === 'length'` is a
  distinct, real failure mode under Structured Outputs (truncated/unparseable JSON), separate from a
  refusal, that this app's plain `chat.completions.create` call (not the SDK's `.parse()` convenience
  helper) must check for itself.
- Structured Outputs + vision input compatibility (`parseReceipt`, `parseRecipeImage`) confirmed by
  OpenAI's own cookbook examples using receipt/image extraction with `response_format: json_schema` —
  vision and `response_format` are independent axes of the same Chat Completions call.

---

## Design

### 1. New shared helper: `parseStructuredResponse` — every non-`'stop'` outcome, extracted and parsed once

New helpers in `aiService.js`, next to `safeParseJSON`. Round 1 only shared the refusal/length *check*;
round 2 (architect review) generalized that check to bucket on *any* non-`'stop'` finish reason (since
`content_filter` is a real, currently-existing finish reason distinct from `refusal` — a moderation block
on the output, not a model-initiated refusal — not just a hypothetical future case); round 2's
non-blocking observation that the extract/parse/derive-status sequence was still duplicated inline at
each of the 6 call sites (not just the check) is folded in here as a second, small helper, so each call
site is a single call rather than a repeated 4-line sequence:

```js
// Structured Outputs (response_format: json_schema, strict: true) removes JSON-parse
// failures as a practical concern, but introduces terminal states that aren't parse
// errors: a moderation refusal (message.refusal populated), or the response ending for
// any reason other than 'stop' — most commonly 'length' (truncated before the JSON
// closed), but also e.g. 'content_filter'. Both classes must be checked before
// `safeParseJSON` ever sees `message.content` — on refusal, content is typically null;
// on a non-'stop' finish reason, content may be a truncated/blocked fragment that would
// otherwise fail JSON.parse for the wrong, harder-to-diagnose reason.
function extractStructuredContent(response) {
  const choice = response.choices[0];
  if (choice.message.refusal) return { status: 'refusal', content: null };
  if (choice.finish_reason !== 'stop') return { status: choice.finish_reason, content: null };
  return { status: 'ok', content: choice.message.content };
}

// Module-level sentinel so "JSON.parse produced no usable result" is distinguishable
// from "the model's actual output happened to be null/[]".
const PARSE_FAILED = Symbol('parse_failed');

// One call per call site instead of the extract/parse/derive-status sequence repeated
// 6 times. `fallback` is the function's own existing fallback value ([], null, etc.) —
// `result` is either the successfully parsed content or that fallback; `structuredStatus`
// is always one of the 5 values below, for a uniform log line across all 6 functions.
function parseStructuredResponse(response, fallback) {
  const structured = extractStructuredContent(response);
  const parsed =
    structured.status === 'ok' ? safeParseJSON(structured.content, PARSE_FAILED) : PARSE_FAILED;
  const structuredStatus =
    structured.status !== 'ok' ? structured.status : parsed === PARSE_FAILED ? 'parse_failed' : 'ok';
  return { result: parsed === PARSE_FAILED ? fallback : parsed, structuredStatus };
}
```

`structuredStatus` is one of `ok` / `refusal` / `length` / `content_filter` / `parse_failed` —
standardized across all 6 log lines (Design 3-8) instead of each function inventing its own field name,
addressing the architect review's logging-consistency point directly (searchable as one field,
`grep structured_status=`, across every AI call). Each call site becomes, roughly:

```js
const { result, structuredStatus } = parseStructuredResponse(response, /* this function's fallback */ []);
```

No new fallback contract — `result` already equals the function's existing fallback value whenever
parsing failed for any reason, exactly as `safeParseJSON`'s direct callers used to compute inline; only
now it's one call instead of a repeated sequence, and the *reason* is always available alongside it.
`safeParseJSON` itself is unchanged: it remains a cheap, harmless defensive backstop for the case where
`finish_reason === 'stop'` and there's no refusal, but the content still somehow fails `JSON.parse` —
kept rather than removed, since deleting it would be a larger diff for zero behavioral benefit (D-5).
`parseRecipeImage` (Design 6) is the one function that needs the intermediate `structuredStatus` *before*
deciding whether to apply the fallback (its retry decision), so it calls `parseStructuredResponse` up to
twice rather than using its `result` blindly on the first call — see Design 6.

### 2. Six schemas, defined inline in `aiService.js` next to `PANTRY_TOOLS`

Following the existing precedent of `PANTRY_TOOLS` (lines 40-262) — tool/function JSON schemas already
live as module-level constants in this file. New constants, same convention, placed just above the
functions that use them:

```js
const EAT_THIS_NOW_SCHEMA = {
  name: 'eat_this_now_suggestions',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string', description: 'One sentence.' },
            usesExpiring: { type: 'array', items: { type: 'string' } },
            estimatedMinutes: { type: 'number' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          },
          required: ['name', 'description', 'usesExpiring', 'estimatedMinutes', 'difficulty'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  },
};

const EXPAND_SUGGESTION_SCHEMA = {
  name: 'expanded_recipe',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantity: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            substitute: {
              type: ['string', 'null'],
              description:
                'null if the ingredient is semantically present in the pantry; otherwise the single ' +
                'best pantry item that could realistically replace it, or null if none exists.',
            },
          },
          required: ['name', 'quantity', 'unit', 'substitute'],
          additionalProperties: false,
        },
      },
      steps: { type: 'array', items: { type: 'string' } },
      servings: { type: 'number' },
      prepMins: { type: 'number' },
      cookMins: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'name', 'description', 'ingredients', 'steps', 'servings', 'prepMins', 'cookMins', 'tags',
    ],
    additionalProperties: false,
  },
};

const PARSE_RECEIPT_SCHEMA = {
  name: 'receipt_items',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: PANTRY_CATEGORIES },
            quantity: { type: 'number' },
            unit: { type: 'string' },
            estimatedExpiryDays: { type: ['integer', 'null'] },
            classification: {
              type: 'string',
              enum: ['produce', 'dairy', 'meat', 'packaged', 'beverage', 'non_food', 'uncertain'],
            },
          },
          required: ['name', 'category', 'quantity', 'unit', 'estimatedExpiryDays', 'classification'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

// Shared by parseRecipeImage (vision) and parseRecipeText (text) — the code already
// documents these two as mirroring the same JSON contract (see parseRecipeText's docblock).
const PARSED_RECIPE_SCHEMA = {
  name: 'parsed_recipe',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantity: { type: ['number', 'string', 'null'] },
            unit: { type: ['string', 'null'] },
          },
          required: ['name', 'quantity', 'unit'],
          additionalProperties: false,
        },
      },
      steps: { type: 'array', items: { type: 'string' } },
      servings: { type: ['number', 'null'] },
      prepMins: { type: ['number', 'null'] },
      cookMins: { type: ['number', 'null'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'name', 'description', 'ingredients', 'steps', 'servings', 'prepMins', 'cookMins', 'tags',
    ],
    additionalProperties: false,
  },
};

const ENRICH_RECIPE_FIELDS_SCHEMA = {
  name: 'recipe_field_enrichment',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      description: { type: ['string', 'null'] },
      servings: { type: ['number', 'null'] },
      prepMins: { type: ['number', 'null'] },
      cookMins: { type: ['number', 'null'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['description', 'servings', 'prepMins', 'cookMins', 'tags'],
    additionalProperties: false,
  },
};
```

`PANTRY_CATEGORIES` is a new shared constant (D-7) — the 10-item category list already duplicated
verbatim between `add_pantry_item`'s and `update_pantry_item`'s `parameters.properties.category.enum`
inside `PANTRY_TOOLS` (lines 66-79, 118-132). Extracting it removes those 2 duplicates while adding this
task's 3rd use, a net reduction, not a net addition, of copies of the same list.

Every object node (root and nested) has `additionalProperties: false` and a `required` array that is
exactly its `properties` keys — the strict-mode invariant Research flagged as the most common way to get
this wrong. Optional-in-practice fields (`description`, `quantity`, `unit`, `substitute`, `servings`,
`prepMins`, `cookMins`, `estimatedExpiryDays`) are expressed as `type: [<type>, 'null']` unions, not
omitted from `required` — omission is not legal under `strict: true`.

### 3. `eatThisNow` — wrap the array, wire the schema, drop the now-redundant shape prose

```js
response_format: { type: 'json_schema', json_schema: EAT_THIS_NOW_SCHEMA },
```
replaces `response_format: { type: 'json_object' }`. The prompt's `Respond with a JSON array:\n[{...}]`
line is replaced with `Respond with 2-3 suggestions.` — the schema (with its `description` fields) now
carries the structural contract; the prompt keeps only what the schema can't express (how many
suggestions, the expiring-items-first prioritization). Unwrap stays exactly as it is today
(`parsed.suggestions ?? parsed.meals ?? []`, line 313) — it already matches the schema's `suggestions`
wrapper key, and keeping the `?? parsed.meals` alternate costs nothing and preserves compatibility with
the fallback `[]` path unchanged. Log line (line 305-309) gains `structured_status=<value>` (Design 1),
same position/format as the existing `prompt_tokens`/`cached_tokens` fields.

### 4. `expandSuggestion` — same treatment

```js
response_format: { type: 'json_schema', json_schema: EXPAND_SUGGESTION_SCHEMA },
```
replaces `response_format: { type: 'json_object' }`. The prompt's `Respond with this exact JSON:\n{...}`
line is dropped entirely; the substitute-field semantics (`substitute` should be null if the ingredient
is already in the pantry, otherwise the best replacement) move into the schema's `description` for that
property (shown above) rather than staying duplicated in prose. Return value/fallback (`null` on failure)
unchanged; log line gains `structured_status` (Design 1).

### 5. `parseReceipt` — wrap the array, wire the schema, keep the classification-judgment prose

```js
response_format: { type: 'json_schema', json_schema: PARSE_RECEIPT_SCHEMA },
```
The prompt's `Return a JSON array. Each element: {...}` shape sentence is dropped — but the substantial
non_food/pet-food/uncertain classification **judgment** rules (lines 398-409) are unchanged. Those are
instructions about *how to classify*, not about *what shape to emit*; the schema enforces the latter,
not the former. Unwrap changes from `Array.isArray(parsed) ? parsed : parsed` (implicit, since the prompt
asked for a bare array) to explicitly reading `parsed.items` — matching the wrapper the schema now
requires, and the exact fallback (`parsed.items ?? []`, line 423) already anticipated. Log line gains
`structured_status` (Design 1).

### 6. `parseRecipeImage` — wire the schema; retry only on transient failures, not policy-driven ones

```js
response_format: { type: 'json_schema', json_schema: PARSED_RECIPE_SCHEMA },
```
`callOnce()` (lines 497-500) changes from returning `{ content, usage }` to running the new
`parseStructuredResponse` (Design 1) and returning its result alongside `usage`:

```js
async function callOnce() {
  const response = await openaiClient.chat.completions.create(requestOptions);
  const { result, structuredStatus } = parseStructuredResponse(response, null);
  return { result, structuredStatus, usage: response.usage };
}

const RETRYABLE_STATUSES = new Set(['length', 'parse_failed']);
let { result, structuredStatus, usage } = await callOnce();
let retried = false;
if (RETRYABLE_STATUSES.has(structuredStatus) && Date.now() - startedAt < RETRY_BUDGET_MS) {
  retried = true;
  ({ result, structuredStatus, usage } = await callOnce());
}
```

— i.e. retry (within the same existing 18-second budget, same single-retry limit) only when the failure
is plausibly **transient**: `length` (the model ran out of tokens mid-JSON — a second attempt at the same
image may simply produce a shorter, complete transcription) or `parse_failed` (defensive; expected to be
unreachable under `strict: true` with `finish_reason === 'stop'`, kept for the same reason `safeParseJSON`
itself is kept — see D-5). **`refusal` and `content_filter` are deliberately excluded from retry** —
both are policy/moderation outcomes on the same input image, not transient conditions; retrying
immediately would spend a second paid vision call with no realistic chance of a different verdict. This
replaces the old `PARSE_FAILED`-sentinel-based `result`/`retried` bookkeeping (lines 509-521) — the
sentinel now lives inside `parseStructuredResponse` (Design 1) instead of being re-declared locally here.
The log line (line 526) uses the single
`structured_status` field (Design 1) in place of the round-1 draft's separate `parse_failed`/`refusal`
booleans — one field, five possible values, distinguishable after the fact by grep alone.

### 7. `parseRecipeText` — reuse `PARSED_RECIPE_SCHEMA`; the "no recipe found" escape hatch stays valid

```js
response_format: { type: 'json_schema', json_schema: PARSED_RECIPE_SCHEMA },
```
The documented no-recipe-found response, `{ "name": "", "ingredients": [], "steps": [] }`, is still
schema-valid under `strict: true` as long as the model also fills the now-mandatory
`description`/`servings`/`prepMins`/`cookMins`/`tags` fields — the prompt's existing sentence describing
this escape hatch is extended to say so explicitly: `{ "name": "", "description": null, "ingredients":
[], "steps": [], "servings": null, "prepMins": null, "cookMins": null, "tags": [] }`. The caller's
`usable` gate (line 578-579: `result.name || result.ingredients?.length || result.steps?.length`) is
unaffected — it already treats this exact shape as unusable. Log line gains `structured_status`
(Design 1); this function has no retry (D-4).

### 8. `enrichRecipeFields` — schema forces all 5 keys present; prompt changes "omit" to "set null"

```js
response_format: { type: 'json_schema', json_schema: ENRICH_RECIPE_FIELDS_SCHEMA },
```
The prompt's `Omit any field you cannot determine rather than guessing` becomes `Set any field you
cannot confidently determine to null (or [] for tags), rather than guessing` — `strict: true` makes
omission impossible; the caller (Current Behavior above) already treats a `null` value and an absent key
identically via `??`, so this is a wording change with **no merge-logic change required**.

One nuance worth stating explicitly in the prompt rather than leaving implicit: the schema requires the
model to emit all 5 keys even when only some were listed in `missingFields` (e.g. only `tags` was
missing). The prompt already scopes *which* fields to actually try to determine
(`It is missing these fields: ${missingFields.join(', ')}`); add one sentence — `For any field not in
that list, always return null (or [] for tags) without attempting to determine it` — so the model
doesn't spend output tokens re-deriving fields nobody asked for. This is a token-efficiency detail, not a
correctness one: even if the model returned a real value for a field outside `missingFields` anyway, the
caller's merge (`raw.servings ?? enrichment.servings ?? null`) always prefers the already-present `raw`
value first, so it would be silently discarded either way. Log line gains `structured_status` (Design 1);
this function has no retry (D-4).

### 9. Guarding against `PARSED_RECIPE_SCHEMA` and the Zod `parsedRecipeSchema` drifting apart

Architect review round 1 correctly identified that `PARSED_RECIPE_SCHEMA` (this task, constrains what the
model may emit) and the existing Zod `parsedRecipeSchema`
([ai.js:221-241](../../server/routes/ai.js), validates/coerces whatever `raw` object reaches
`/parse-recipe-image` or `/parse-recipe-url` before it's persisted — regardless of whether `raw` came
from `parseRecipeImage`, `parseRecipeText`, or the JSON-LD+`enrichRecipeFields` merge) now describe
overlapping shapes and must evolve together. Generating one from the other was considered and declined
(D-9) — instead, `parsedRecipeSchema` is exported from `ai.js` (a test-only visibility change, no runtime
behavior change) so a new test can assert the two schemas' field sets stay in lockstep:

```js
// aiService.schemas.test.js (excerpt)
import { parsedRecipeSchema } from '../routes/ai.js';
import { PARSED_RECIPE_SCHEMA } from './aiService.js';

test('PARSED_RECIPE_SCHEMA top-level fields match the Zod parsedRecipeSchema fields', () => {
  const jsonSchemaKeys = Object.keys(PARSED_RECIPE_SCHEMA.schema.properties).sort();
  const zodKeys = Object.keys(parsedRecipeSchema.shape).sort();
  assert.deepStrictEqual(jsonSchemaKeys, zodKeys);
});

test('ingredient sub-schema fields match', () => {
  const jsonSchemaKeys = Object.keys(
    PARSED_RECIPE_SCHEMA.schema.properties.ingredients.items.properties
  ).sort();
  const zodKeys = Object.keys(parsedRecipeSchema.shape.ingredients.element.shape).sort();
  assert.deepStrictEqual(jsonSchemaKeys, zodKeys);
});
```

This doesn't guarantee full type-level equivalence (the two schemas legitimately differ in *kind* —
Zod's is optional-by-omission with coercion and defaults, for validating arbitrary-source input; the
JSON Schema is required-but-nullable with no coercion, for constraining model output) — but it does
guarantee neither can add or remove a field without the other test failing, which is the actual failure
mode worth guarding against (a new recipe field added to one and silently forgotten in the other).

---

## Decisions

- **D-1: Two small shared helpers (`extractStructuredContent` + `parseStructuredResponse`, plus a shared
  `PARSE_FAILED` sentinel and a uniform `structured_status` log field) — one call per call site, not six
  duplicated extract/parse/log sequences.** Matches this file's existing pattern of small shared helpers
  (`safeParseJSON`, `wrapAIError`). This decision evolved across both review rounds: round 1's original
  draft only shared the refusal/length *check* (`extractStructuredContent`), still leaving each of the 6
  call sites to inline the same parse-then-derive-status sequence; round 2 generalized the check to any
  non-`'stop'` finish reason, and round 2's architect review separately noted the still-duplicated
  sequence — folded in as `parseStructuredResponse`, completing what this decision set out to do in the
  first place rather than leaving a known duplication for implementation to rediscover.
- **D-2: Schemas live inline in `aiService.js`, not a new file.** `PANTRY_TOOLS` already establishes this
  file as where this app keeps its OpenAI-facing JSON schemas; a new `server/services/ai/schemas.js`
  would split one coherent concern (this file's prompts and their shape contracts) across two files for
  no functional benefit today. Revisit if this file's size becomes a real problem — not the case yet
  (881 lines before this task, an estimated ~1050-1130 after). If a 7th structured-output call is ever
  added to this app, that's the point to extract a dedicated schemas module rather than growing this
  file indefinitely — noted here so it isn't re-litigated from scratch next time.
- **D-3: `parseRecipeImage` and `parseRecipeText` share one `PARSED_RECIPE_SCHEMA` constant, not two
  near-identical copies.** Codifies what the existing code comment already asserts (they mirror the same
  contract). If a future task needs them to diverge, that's a one-line fork at the point of divergence —
  cheaper than maintaining a second copy in the meantime for a divergence that may never happen.
- **D-4: Retry is added only to `parseRecipeImage`, and only for `length`/`parse_failed`, not
  `refusal`/`content_filter` — with concrete reasons, not "matches existing behavior."** Two separate
  questions, two separate answers:
  - *Why only `parseRecipeImage` of the 6?* It's the only one with an established outer-timeout budget
    that already accounts for a retry — `RETRY_BUDGET_MS = 18000` exists specifically to "stay under
    ai.js's 40s outer timeout so a retry can still complete" (existing comment, line 458). Adding retry
    to the other 5 would require first auditing each one's own outer-timeout/rate-limiter budget to see
    if a second call even fits — real infrastructure work with no usage data yet showing those 5 actually
    truncate often enough to justify it, not a mechanical consequence of this schema migration.
  - *Why exclude `refusal`/`content_filter` from the one function that does retry?* Both are
    policy/moderation outcomes evaluated against the same input image — retrying immediately re-sends the
    identical image and is very unlikely to get a different verdict, so it would just spend a second paid
    vision call for no realistic benefit. `length` is different in kind: it's a token-budget outcome, and
    a second attempt at the same image can produce a shorter, complete transcription (e.g. a lucky
    reroll skips a verbose aside). Design 6 has the resulting `RETRYABLE_STATUSES` set.
  The other 5 functions keep their existing "fail once, return the fallback" contract; any non-`ok`
  status on those now falls into exactly the same fallback path a parse failure already used to.
- **D-5: `safeParseJSON`'s markdown-fence-stripping regex is left untouched, not removed.** Structured
  Outputs never wraps JSON in markdown fences, so the regex becomes a no-op in the common case — but it's
  harmless, and removing it is a diff with no behavioral upside, only a small risk of collateral damage
  to the (still-relevant) `chat` code path if anyone ever reused the function carelessly. Left as-is.
- **D-6: `enrichRecipeFields`'s prompt wording changes from "omit" to "set null," with zero caller-side
  code change.** Verified directly against [ai.js:353-361](../../server/routes/ai.js)'s `??`-based merge
  before deciding this — confirmed `undefined` (omitted key) and `null` (explicit key) are already
  handled identically there, so this is purely a prompt-wording change forced by `strict: true`'s "all
  keys required" rule, not a behavior change.
- **D-7: `PANTRY_CATEGORIES` extraction (deduping `PANTRY_TOOLS`'s 2 existing copies) is bundled into
  this spec rather than split out.** Small, mechanical, same file, and this task is already adding a 3rd
  copy of the identical list for `PARSE_RECEIPT_SCHEMA` — extracting once instead of copying a 3rd time
  is the lower-total-diff option, not scope creep. Flagged as easy to decline/revert in review if the
  architect prefers a `parseReceipt`-only change with zero touches to `PANTRY_TOOLS`.
- **D-8: `chat` (tool/function calling) is explicitly out of scope**, per Current Behavior — a different
  mechanism, not a 7th instance of this task's pattern.
- **D-9: `PARSED_RECIPE_SCHEMA` and the existing Zod `parsedRecipeSchema` stay as two separately
  maintained schemas, guarded by an automated cross-check test, rather than generating one from the
  other.** Raised in architect review round 1 as the spec's biggest concern. Checked first how much of
  the "6 new schemas duplicate existing validators" framing actually holds: only `PARSED_RECIPE_SCHEMA`
  (shared by `parseRecipeImage`/`parseRecipeText`) and, indirectly, `enrichRecipeFields`'s 5 fields (via
  the merge into a `parsedRecipeSchema`-validated object) genuinely overlap with a pre-existing
  validator — `EAT_THIS_NOW_SCHEMA`, `EXPAND_SUGGESTION_SCHEMA`, and `PARSE_RECEIPT_SCHEMA` have no
  Zod (or any other) counterpart today, so there's no duplication risk for 3 of the 6. For the one pair
  that does overlap, generating JSON Schema from the Zod definition (the reviewer's preferred option) was
  declined on two concrete grounds: (1) the two schemas encode genuinely different semantics — Zod's is
  optional-by-omission with `.coerce`/`.default()`, used to validate/normalize `raw` regardless of
  *which* source produced it (AI or JSON-LD); the JSON Schema is required-but-nullable with no coercion,
  used only to constrain one AI call's output — a generator would need to either lossily flatten that
  difference or become schema-specific enough that it stops being a general codegen step; (2) every
  available generator (e.g. `zod-to-json-schema`) is a new npm dependency, breaking this project's
  consistent zero-new-deps discipline (TASK-051's Constraints, and this spec's own). Adopted the
  reviewer's fallback instead (explicit documentation) and strengthened it with an actual automated
  safeguard rather than a comment: Design 9's key-set cross-check test, which fails CI if either schema
  gains or loses a field the other doesn't know about — the real failure mode worth preventing, without
  requiring true type-level equivalence between two schemas that are legitimately different kinds of
  thing.

---

## Allowed Files

- `server/services/aiService.js` — add `extractStructuredContent` and `parseStructuredResponse` helpers
  (internal, not exported — only the schema constants need test visibility), the shared `PARSE_FAILED`
  sentinel, and `PANTRY_CATEGORIES`, `EAT_THIS_NOW_SCHEMA`, `EXPAND_SUGGESTION_SCHEMA`,
  `PARSE_RECEIPT_SCHEMA`, `PARSED_RECIPE_SCHEMA`, `ENRICH_RECIPE_FIELDS_SCHEMA` constants — all six
  schema constants and `PARSED_RECIPE_SCHEMA` in particular are **named exports** (needed by
  `aiService.schemas.test.js`, Design 9); wire each schema into its function's `response_format`
  (Design 3-8); update `PANTRY_TOOLS`'s two category `enum` arrays to reference `PANTRY_CATEGORIES`
  (D-7); prompt-text edits described in Design 3-8; every function's log line adds `structured_status`
  (Design 1); `parseRecipeImage`'s retry condition (Design 6).
- `server/routes/ai.js` — change `const parsedRecipeSchema = z.object({...})` (line 221) to
  `export const parsedRecipeSchema = ...`. Test-only visibility change (Design 9) — no behavior change,
  the route handlers that already call `parsedRecipeSchema.parse(raw)` are untouched.
- New: `server/services/aiService.schemas.test.js` — structural strict-mode validation of the 6 new
  schema constants, the `response_format`-shape serialization check, and the `PARSED_RECIPE_SCHEMA` /
  `parsedRecipeSchema` key-set cross-check (Testing/Verification Plan, Design 9).

## Forbidden Files

- `server/services/aiService.js`'s `chat`, `suggestRecipes`, `formatPantrySection`,
  `_buildFallbackReply`, `RECIPE_ENRICHABLE_FIELDS`, and `PANTRY_TOOLS`'s tool `name`/`description`
  strings or non-category `parameters` — untouched by this task (D-8; `PANTRY_TOOLS`'s only change is the
  category-enum dedup in D-7).
- `server/services/ai/openaiProvider.js`, `server/services/ai/resolveProvider.js`,
  `server/middleware/requireAiAccess.js` — the provider/gating layer this task's 6 functions sit behind
  is unrelated to their response-format/schema contract.
- `server/routes/ai.js` — scope limited to exactly the one-word `export` addition on `parsedRecipeSchema`
  (Design 9). No route-handler logic changes; every route still
  calls the same `aiService.js` functions the same way with the same arguments and return-value
  contracts (Constraints).
- `parsedRecipeSchema`'s own field definitions (the Zod validator in
  [ai.js:221-241](../../server/routes/ai.js)) — already accepts `null` for every field this task's
  schemas make nullable; the only permitted change is the one-word `export` (Allowed Files, Design 9), no
  change to its actual validation rules.
- Every non-AI route/service — entirely unrelated.

---

## Constraints

- **Every function's external return-value contract is unchanged.** `eatThisNow` still returns an array
  (`[]` on failure); `expandSuggestion`/`parseRecipeImage`/`parseRecipeText` still return an object or
  `null`; `parseReceipt` still returns the filtered `food` array; `enrichRecipeFields` still returns an
  object or `null`. This task changes *how reliably* and *how* (schema vs. prompt) the shape is produced,
  not what callers receive.
- **Model aliases (`gpt-4o-mini`, `gpt-4o`) must keep resolving to snapshots `>= 2024-07-18` /
  `>= 2024-08-06` respectively** for Structured Outputs support — true today and has been for over a
  year; if either alias is ever pinned to an older dated snapshot in the future, that would silently
  break these 6 calls. Not enforceable in code; flagged here for awareness.
- **`strict: true` requires, at every object level of every schema:** `additionalProperties: false`, and
  a `required` array that exactly equals that object's `properties` keys (no field may be optional by
  omission — express "may be absent" as a nullable type union instead). Verified structurally by the new
  test file, not just by eyeballing the schema literals.
- **Refusal detail (`message.refusal`'s string content) must never be logged.** It can echo back
  moderation-flagged user input (e.g. from `chat` — not in scope, but the same caution applies to
  anything user-supplied reaching these prompts, like receipt/recipe image content). Log only the
  `structured_status` value (`'refusal'`, never the refusal text itself), matching this file's existing
  "no prompt/response content in log lines" convention (TASK-051 Constraints).
- **`extractStructuredContent` must bucket on any non-`'stop'` `finish_reason`, not enumerate only
  `'length'`.** `content_filter` is a real, currently-existing finish reason distinct from `refusal`
  (architect review round 1) — hardcoding only `'length'` would silently mis-handle it as if
  `status === 'ok'` with truncated/empty content. Verified by the Design 1 implementation using
  `!== 'stop'` rather than `=== 'length'`.
- **No change to any function's `max_tokens` value.** Truncation risk (`finish_reason === 'length'`) is a
  pre-existing latent risk this task surfaces and handles explicitly (Design 1) rather than tuning away —
  changing token budgets is deferred finding #5 (context-size cap) from TASK-051, a separate task.
- **Verify `response.choices[0].message.content` is a plain string in the installed SDK before assuming
  `safeParseJSON`'s `text.replace(...)` is safe to call on it (architect review round 1).** Expected to
  already be true — this app calls the raw `chat.completions.create` (not a `.parse()`/`.beta` convenience
  wrapper that might return a pre-parsed object), and the Chat Completions API has always returned
  `message.content` as a string, including in today's `json_object`-mode calls this task replaces. Cheap
  to confirm with one `typeof` check against a real response during implementation (Verification Plan)
  rather than asserted here as fact.
- **Zero new npm dependencies.** The installed `openai` SDK (`^4.104.0`) already supports
  `response_format: json_schema` via the plain `chat.completions.create` call this file already uses; no
  SDK upgrade or helper library (e.g. Zod-to-JSON-Schema, declined in D-9) needed for hand-written schema
  literals this
  small.

---

## Testing / Verification Plan

1. **Schema structural validation (new automated test, `aiService.schemas.test.js`)**: a small recursive
   walker asserts, for every object node in all 6 exported schemas, that `additionalProperties === false`
   and that `required` is exactly `Object.keys(properties)` — catching the single most common way to get
   `strict: true` wrong (Research) before it ever reaches a live OpenAI 400 error. Pure data assertions,
   no OpenAI call, no mocking needed.
2. **`response_format` shape round-trips through `JSON.stringify`/`JSON.parse` unchanged (architect
   review round 1)**: for each of the 6 schemas, build the exact `{ type: 'json_schema', json_schema:
   SCHEMA }` object this app sends to OpenAI and assert it survives a stringify/parse round-trip
   byte-for-byte — catches an accidental non-serializable value (a `Symbol` slipped into an `enum` array,
   `undefined` in a property, a circular reference) before it ever reaches a live API call.
3. **`PARSED_RECIPE_SCHEMA` / Zod `parsedRecipeSchema` key-set cross-check (Design 9, architect review
   round 1)**: the two tests shown in Design 9 — top-level fields and `ingredients` sub-schema fields —
   pass today and must keep passing; if a future task adds a recipe field to one schema and not the
   other, this is the test that's supposed to catch it.
4. **Live call per function, happy path**: trigger all 6 endpoints once each in local dev
   (`eat-this-now`, `expand-suggestion`, `parse-receipt`, `parse-recipe-image`, `parse-recipe-url` via
   both its JSON-LD-enrichment and full-text-extraction tiers) — confirm each still returns a usable
   result shaped exactly as before, and that the log line now includes `structured_status=ok`.
5. **`message.content` type check (architect review round 1)**: log (or breakpoint-inspect) `typeof
   response.choices[0].message.content` on at least one real response during Step 4 — confirm it's
   `'string'` before relying on `safeParseJSON`'s string methods, per the Constraints entry on this.
6. **`parseRecipeText`'s no-recipe-found escape hatch**: feed a URL with no extractable recipe content
   through `/parse-recipe-url`'s Tier 2 (AI-text) path — confirm the all-null/empty response (Design 7)
   still produces the existing 422 "Couldn't automatically find a recipe" response, not a schema error.
7. **`enrichRecipeFields`'s merge is unaffected by the wording change**: run the Tier 1b (JSON-LD +
   enrichment) path on a real recipe URL missing only 1-2 of the enrichable fields — confirm the merged
   result still has the JSON-LD-provided fields untouched and only the genuinely-missing ones filled in
   (or left `null` if the model couldn't determine them), matching current behavior.
8. **Refusal/truncation/content-filter paths — code inspection, not forced live repro.** These are rare,
   hard-to-trigger edge cases (deliberately provoking a moderation refusal, a content-filter block, or
   exhausting a `max_tokens` budget on purpose) — verify `extractStructuredContent`'s branches and
   `parseRecipeImage`'s `RETRYABLE_STATUSES`-gated retry condition (Design 6) by direct code review
   against the documented SDK behavior (Research), the same verification-by-inspection precedent
   TASK-050 and TASK-051 used for their own low-probability edge branches, rather than by manufacturing a
   live occurrence.
9. **Existing test suite still passes**: `npm test --prefix server` — confirm the new schema test file
   passes and nothing else regresses (no existing tests exercise these 6 functions' live behavior today,
   per Current Behavior — this task adds the first automated coverage of any kind for them, scoped to
   what's mechanically verifiable without a live API key).
10. **Token/prompt-size sanity check**: compare a sample prompt string for `eatThisNow` and
    `expandSuggestion` before/after Design 3-4's prose trims — confirm they're shorter (schema now
    carries the structural contract instead of prose), and that no semantic instruction was lost in the
    trim (cross-check against the "moved to schema `description`" claims in Design 3-4, the same
    word-for-word-preserved discipline TASK-051's Design 5 prompt reorder required of itself).

---

## Out of Scope (v1)

- **The other 4 deferred TASK-051 findings** (vision-model accuracy eval, content-hash caching for
  recipe-URL parsing, chat streaming, context-size cap) — unrelated to this task, each still needs its
  own design decision or measurement per TASK-051's own accounting.
- **`chat`'s tool-calling schemas (`PANTRY_TOOLS`)** — already schema-constrained via a different OpenAI
  mechanism (function calling), not `response_format`; only the category-enum dedup (D-7) touches this
  constant, and only cosmetically.
- **Retrying `eatThisNow`/`expandSuggestion`/`parseReceipt`/`parseRecipeText`/`enrichRecipeFields` on
  refusal or truncation** (D-4) — deliberately not added; those functions keep today's fail-once
  contract.
- **Tuning `max_tokens` to reduce truncation risk** — that's deferred finding #5 (context-size cap)
  territory, a distinct design decision about prompt/context budgets generally, not specific to this
  task's `response_format` change.
- **Model version pinning** (moving `gpt-4o-mini`/`gpt-4o` to dated snapshots) — unrelated to Structured
  Outputs support, which the current aliases already provide (Constraints).

---

## Known Risks

- **Prompt behavior could shift subtly even though the schema is stricter.** Moving field semantics from
  inline prose into schema `description`s (Design 3-4) is the documented best practice, but it's still a
  prompt-content change for 2 of the 6 functions — must be verified live (Verification Step 4), not
  assumed equivalent just because the words moved rather than disappeared.
- **Truncation risk is pre-existing, not introduced by this task, but this task makes it detectable for
  the first time.** Before this change, a truncated response would most likely already fail
  `safeParseJSON` silently and fall through to the same fallback path — this task doesn't fix that
  underlying risk (deferred to finding #5), it just gives it a name (`structured_status=length`) instead
  of an indistinguishable generic parse failure.
- **`enrichRecipeFields`'s always-present-keys requirement could theoretically encourage the model to
  hallucinate a value for a field it wasn't asked to determine**, even with the added "always return null
  for fields not in that list" instruction — mitigated to a non-issue by the caller's merge order
  (Design 8), but worth knowing this is a schema-shape side effect, not a design goal.
- **The `PARSED_RECIPE_SCHEMA`/`parsedRecipeSchema` cross-check (Design 9) guards field sets, not full
  type equivalence.** It would not catch, for example, one schema's `servings` becoming `integer`-only
  while the other stays a looser `number` — a real but narrower gap than "the two schemas could drift
  apart entirely," which is the failure mode it does catch. Accepted as the pragmatic middle ground
  between D-9's declined full-codegen option and no automated guard at all.
