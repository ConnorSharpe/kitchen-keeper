# TASK-029.5 — Receipt Name-Expansion Prompt Reposition (Position-Bias Fix)

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 1)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.7/10 — approve after two small edits | Praised: the single-variable experimental discipline (only prompt position changes; model, wording, examples, schema, temperature, token count all held constant), the cheapest-fix-first escalation order (position → few-shot → two-pass), the choice of `BANANAS`→`Bananas` as the cleanest diagnostic criterion (removes real-world-knowledge as a confound), and the tight scope (one function, one relocated block, no other changes). Required: soften the "~22 points" research claim to avoid overstating certainty of the specific magnitude; add an explicit quantitative success threshold instead of a qualitative "compare against baseline" so the experiment has a predefined pass/fail gate. Recommended (non-blocking): explicitly call out how to interpret a *partial* result (sentence-casing succeeds but abbreviation expansion doesn't) as a distinct diagnostic signal pointing toward few-shot examples specifically, not the two-pass architecture. All three incorporated below. In addition, cross-checking the review against the live smoke-test data (which the architect reviewed only via the spec's prose summary, not the raw results) found the original "0 of 4 testable naming criteria" framing was internally inconsistent — the brand-prefixed item's own acceptance rule defines two acceptable outcomes ("either expands confidently or is left unchanged... either outcome is acceptable"), so it can't validly be tallied as a pass/fail data point alongside the three criteria that each have exactly one correct output. Corrected below: the quantitative gate is scored against 3 strict criteria (meat, produce, sentence-case), with the brand item recorded but explicitly excluded from the tally. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Naming-rules block | `server/services/aiService.js:297-304` `parseReceipt()` | A 7-bullet "For the "name" field:" block (abbreviation expansion, specificity, sentence case, brand handling, no embellishment, no inferred package size, illegible-line fallback), added by TASK-029. Currently sits immediately after the JSON-schema description and before `estimatedExpiryDays`/`classification` guidance — i.e. in the first half of the prompt, not at its start or end. |
| Classification block | `server/services/aiService.js:306-309` `parseReceipt()` | The TASK-028 non-food classification rules. Currently sits as the last substantive instruction block, immediately before the final `"Return ONLY a raw JSON array..."` directive. |
| Live smoke test, this session (2026-07-14) | `ai/handoffs/CURRENT_STATE.md` | A synthetic 7-line receipt (abbreviated meat/produce/dairy items, one already-clear item, one genuinely ambiguous SKU line, two non-food items) was run through the real `POST /api/ai/parse-receipt` endpoint. Results: classification worked correctly (2/2 non-food items dropped, ambiguous SKU line correctly left unexpanded). Naming-rule expansion did not fire on any of the 3 abbreviated items, and — the key data point — the one item requiring zero real-world knowledge to fix (`BANANAS` → `Bananas`, pure sentence-casing) was also left untouched. Full detail and raw results table logged in `ai/handoffs/CURRENT_STATE.md`'s "TASK-029 (receipt name expansion) — MIXED" section. |
| Research basis, this session | web research, 2026-07-14 | Prior work has documented measurable position-dependent instruction-following degradation in long prompts — models attend more reliably to instructions at the start or end of a prompt than to instructions placed in the middle ([Found in the Middle, arXiv](https://arxiv.org/html/2406.16008v1); [Atlan: Lost-in-the-Middle](https://atlan.com/know/llm/lost-in-the-middle-problem/)). The exact magnitude reported in that literature varies by model, context length, and instruction type and should not be treated as a guaranteed effect size here — but it makes instruction placement a plausible contributing factor, and the naming-rules block's current position vs. the classification block's current position is a real-world match worth testing directly rather than assuming. |

---

## Goal

Test whether repositioning the existing TASK-029 naming-rules block — with **no change to its wording, no model change, no other prompt change** — is sufficient to make abbreviation expansion and sentence-casing actually take effect, before reaching for heavier fixes (few-shot reformatting, or splitting into two chained LLM calls).

---

## Decision: Position First, Isolated From Every Other Variable

Per the same discipline TASK-030 applied to its three extraction-accuracy levers (most fundamental change first, one variable at a time, so a result can be attributed to a specific cause): this task changes exactly one thing — **where** the naming-rules block sits in the prompt string — and nothing else. If this alone measurably improves expansion behavior, it's the cheapest possible fix and should ship alone. If it doesn't, that's a clean, useful negative result: it rules out position bias as the (sole) cause before anyone spends a session on few-shot reformatting or a two-call architecture.

Two heavier options were considered and explicitly deferred rather than bundled in:

1. **Convert the inline bulleted examples into explicit few-shot input→output pairs.** Research on LLM-based attribute extraction+normalization shows demonstrations measurably improve this exact kind of task ([arXiv:2403.02130](https://arxiv.org/html/2403.02130v4): GPT-4 hit 91% F1 with 5 few-shot examples vs. plain instruction). Not done here because bundling it with the reposition would make it impossible to tell which change caused any observed improvement.
2. **Split into two chained calls** — one pass for faithful extraction + classification (already working), a second, narrowly-scoped pass purely for name normalization over the already-extracted list. Prompt-chaining research consistently shows this outperforms one prompt doing everything ([getmaxim.ai](https://www.getmaxim.ai/articles/prompt-chaining-for-ai-engineers-a-practical-guide-to-improving-llm-output-quality/)) — a short, single-purpose prompt has far less "middle" for anything to get lost in. Not done here because it's a real architecture change (extra API call, added latency and cost, a new function/route shape) that should go through its own review if the cheaper fix proves insufficient.

**Where to move it:** immediately before the final `"Return ONLY a raw JSON array. No markdown, no explanation."` line — i.e. directly after the classification block, making naming rules the new last substantive instruction. This is a straight cut-and-paste of the existing 7-bullet block with **zero wording changes**. The classification block itself is not edited — it simply ends up one position earlier (still in the prompt's back third, nowhere near the "lost in the middle" zone it was never in). This was chosen over inserting naming rules at the very start of the prompt because the schema description has to come before field-specific formatting rules make grammatical sense ("For the 'name' field: ..." is confusing before the model has been told a `name` field exists).

**Explicitly not changed:** the wording of any of the 7 naming-rules bullets, the classification block's wording, `estimatedExpiryDays` guidance, the JSON schema description, the model (`gpt-4o-mini`), `max_tokens`, or anything in `parseRecipeImage()` (unrelated function, untouched since TASK-030).

---

## Allowed Files

- `server/services/aiService.js` — `parseReceipt()` only: relocate the existing naming-rules bullet block within the prompt template literal. No wording changes to any existing bullet, no new bullets, no other prompt text touched.

## Forbidden Files

- Everything else. In particular: no changes to `server/routes/ai.js` (response shape unaffected), `client/src/components/pantry/ReceiptUpload.jsx` (upload flow unaffected), `parseRecipeImage()` (unrelated function, TASK-030 scope, already shipped), or the model/`max_tokens` used by `parseReceipt()`.

---

## Constraints

1. **Single-variable change.** The 7 naming-rules bullets move verbatim — same wording, same order relative to each other, same examples. Only their position within the overall prompt string changes.
2. **New position: immediately after the classification block, immediately before the final `"Return ONLY a raw JSON array..."` line.** Not at the very start of the prompt (see Decision above for why).
3. **No model change.** Stays `gpt-4o-mini`, matching TASK-029's original scope — this task isolates position, not model capability.
4. **No response-schema change.** `name` stays a plain string; nothing in `server/routes/ai.js` needs to change.
5. **No touching `parseRecipeImage()` or any other function in `aiService.js`.**

---

## Dependency Chain

Editing:
- `server/services/aiService.js` (`parseReceipt()` only — prompt template literal, one block relocated)

Requires:
- n/a

Irrelevant:
- `server/routes/ai.js`, `client/src/components/pantry/ReceiptUpload.jsx`, `parseRecipeImage()`, everything not `parseReceipt()`'s prompt string.

---

## Acceptance Criteria

Re-run the same combined smoke test methodology from this session (synthetic receipt image, real `POST /api/ai/parse-receipt` call, real household — cleaned up afterward per this repo's Local Smoke Testing Protocol) and compare directly against this session's baseline.

**Scored naming-expansion criteria** — strict pass/fail, each has exactly one correct transformed output, all three failed 0/3 in this session's baseline (note: the baseline was previously mis-tallied as "0 of 4" including the brand item below; corrected here — see Architect Review History):

- [ ] An abbreviated meat item (e.g. `CHKN THIGH BNLS`-style) is expanded to a full, specific name
- [ ] An abbreviated produce item (e.g. `ORG BANANA`-style) is expanded to a full, specific name
- [ ] An already-clear, non-abbreviated item in ALL CAPS (e.g. `BANANAS`) is sentence-cased to `Bananas` — **the single most important criterion**, since it isolates pure instruction-following from any real-world-knowledge confound

**Success gate (added per architect review round 1):** at least 2 of the 3 scored criteria above must pass, **and** neither regression check below may fail. Baseline was 0/3, so any improvement is notable; ≥2/3 is the bar for treating the reposition as sufficient on its own rather than "helped a little." Below that bar, this task's result is a valid negative finding, not a failure to write up — see Decision above for the next step in that case.

**Non-scored / flexible criterion** — excluded from the gate above because its own rule defines two acceptable outcomes, so it can't cleanly signal whether the fix worked either way:

- [ ] A store-brand-prefixed item (e.g. `GV 2% MLK GAL`-style) either expands confidently or is left unchanged per the "don't guess an unfamiliar brand" rule — record which outcome occurred, but don't count it toward the 2-of-3 gate.

**Regression checks** — must not fail, but are controls (both already passed in the baseline), not evidence the fix itself worked:

- [ ] A genuinely ambiguous/no-information line (e.g. a bare SKU code) is still left unexpanded, not hallucinated
- [ ] Classification (TASK-028) still works correctly post-move — non-food items still dropped, still logged — checks that nudging classification one position earlier didn't break it

**Interpreting a partial result (added per architect review round 1, recommended item):** if sentence-casing succeeds but the meat/produce abbreviation expansions still fail, that is a meaningfully different outcome than uniform failure — it suggests the model is now *reading* the relocated instructions (the position fix worked) but can't reliably apply the *knowledge-heavy* half of them (recognizing an abbreviation requires more than following a formatting rule). That specific pattern points toward few-shot examples (Decision option 1) as the next step rather than the two-pass architecture (Decision option 2). Record which pattern occurs either way — it determines what the next task should be, not just whether this one passed.

---

## Known Risks

- **This may not be sufficient on its own.** Position bias is a documented, measured effect, but it is one plausible explanation among several (model capability, prompt length overall, example quality) — if this reposition doesn't move the needle, that's a valid and useful outcome: it rules position out and justifies moving to few-shot reformatting or the two-pass architecture next, rather than guessing between them.
- **No before/after accuracy benchmark exists** — same limitation noted in TASK-028/029/030's specs. Verification is a direct re-run of the same synthetic-receipt smoke test against the quantitative gate defined in Acceptance Criteria, not a statistical sample across many receipts.
- Moving classification one position earlier (still solidly in the back third of the prompt, not into the "middle" zone) is assessed as low-risk but is a real change to something that was working — the acceptance criteria include an explicit classification regression check for this reason.

## Out of Scope

- Few-shot example reformatting (Decision option 1 above) — deferred pending this test's result.
- Two-pass/chained extraction+normalization architecture (Decision option 2 above) — deferred pending this test's result; would need its own spec if pursued (new function shape, added latency/cost, route changes).
- `response_format: { type: "json_schema", strict: true }` adoption — a valid complementary reliability improvement for malformed-JSON failures, but addresses a different failure mode than this task (content style, not shape) and was not part of this session's diagnosis. Worth its own follow-up if pursued.
- Any change to `parseRecipeImage()` / TASK-030 — already shipped, unrelated function.
