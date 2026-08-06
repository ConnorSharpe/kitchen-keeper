# Task

TASK-054 implementation session: implemented `ai/tasks/TASK-054-spec.md` (DRAFT-2, APPROVED FOR
IMPLEMENTATION, 9.95/10) end to end — chat's `pantrySummary`/`recipeSummary` are now capped at 150 items
each before being embedded in `POST /api/ai/chat`'s system prompt, truncating by expiry urgency (pantry) or
recency (recipes, already ordered) rather than an arbitrary cut. **Implemented and live-verified in local
dev, including a real edge case the spec's own D-6 claim did not survive contact with. Not yet committed.**

# What was done this session

- Implemented exactly per the spec's Allowed Files list and Design sections 1-3 — no scope drift.
- [aiService.js](../../server/services/aiService.js): added (next to the existing `formatPantrySection`
  helper, just before it) `CHAT_CONTEXT_LIMITS = { pantry: 150, recipes: 150 }`, `PANTRY_URGENCY_RANK`, and
  the two pure exported helpers `buildPantrySummary`/`buildRecipeSummary` (Design 1) — pantry truncation
  stable-sorts by expiry urgency via a `rank(item) => PANTRY_URGENCY_RANK[item.status] ?? Infinity` fallback
  (D-9), recipe truncation just slices (already `desc(savedAt)`-ordered, D-3). `chat()`'s `systemPrompt`
  construction now calls both helpers and emits a `[PARTIAL]`-marked header with "showing X of Y" text only
  when truncation actually happens (Design 2) — under-cap households get byte-identical prompt output to
  pre-task behavior (D-4), confirmed live. One new paragraph added to the cacheable `staticInstructions`
  (Design 3) telling the model `[PARTIAL]` means the list isn't the full inventory, that
  `consume_pantry_item` still works for unlisted items via full-inventory name-matching, and that
  `update_pantry_item`/`remove_pantry_item` need the user to confirm an item they can't see. No other
  function in the file changed; `routes/ai.js` and every Forbidden File listed in the spec are untouched.
- New [server/services/aiService.contextCap.test.js](../../server/services/aiService.contextCap.test.js):
  8 unit tests per the Testing Plan — under/over-cap behavior for both helpers, the DRAFT-2 stability
  regression test (same-urgency items keep original relative order after a forced truncation, using a
  padding item so the cap forces truncation while all 4 signal items from the spec's own example still
  survive the slice), explicit-`max` parameter coverage for both helpers, and a `CHAT_CONTEXT_LIMITS` sanity
  check. `npm test --prefix server`: **93/93 passing** (85 pre-existing + 8 new, no regression).
  `npm run lint`: clean.
- **Live-verified in local dev** (server on :3001, client on :5183, already-authenticated Clerk session,
  real household with ~30 pantry items — well under the 150 cap):
  - **Common case (Testing Plan step 6)**: asked "List all my pantry items by name" — reply correctly
    listed the household's actual items; server log showed `prompt_tokens=3843` first call,
    `cached_tokens=2816` on the very next call — confirms OpenAI prompt-cache hits on the static prefix are
    unaffected (Testing Plan step 8 / Design 2's byte-identical-when-untruncated claim), consistent with
    TASK-053's same finding.
  - **Truncated case (Testing Plan step 7)**: temporarily set `CHAT_CONTEXT_LIMITS.pantry = 3` and
    restarted the server (this launch config runs `node index.js` directly, no nodemon — confirmed the
    restart was necessary before trusting any result, per the Local Smoke Testing Protocol). Asked to list
    all visible pantry items — got back exactly 3 items (`Ben & Jerry's Ice Cream`, `STEELHEAD`,
    `ORG F EGGS`), `prompt_tokens` dropped to ~3037-3116 confirming a genuinely smaller prompt.
    `update_pantry_item` on one of the 3 visible items (`Ben & Jerry's Ice Cream` quantity → 2) worked
    normally (`tool_calls_count=1`) — reverted back to 1 immediately after, confirmed via a direct
    `/api/pantry` fetch. **`consume_pantry_item` on a truncated-out item ("Onions", not one of the visible
    3) did NOT succeed** — tried twice with different phrasings ("I ate 0.1 lb of the Onions" and "I just
    consumed the onions in my pantry"); both times the model declined to call any tool at all
    (`tool_calls_count=0` on both) and instead replied asking for clarification / stating there was no
    "onions" entry. This directly contradicts the spec's D-6 claim that "`consume_pantry_item` does not
    have this problem" and the new Design-3 instruction sentence telling the model exactly that — the
    *handler* itself is untouched and does still resolve by fuzzy name-match against the full,
    untruncated `ctx.allItems` (confirmed correct by code inspection, this task didn't touch it), but
    **gpt-4o-mini in practice won't attempt the tool call in the first place** when the named item isn't
    visible in the (truncated) prompt text, despite the explicit instruction. See Known Risks — this is a
    live finding, not a code defect in this task's diff.
  - All temporary smoke-test state fully reverted before ending the session: `CHAT_CONTEXT_LIMITS.pantry`
    back to 150 (confirmed via `grep` — no `TEMP`/`pantry: 3` left in the file), the ice cream quantity back
    to 1 (confirmed via a fresh `/api/pantry` fetch), no items added/removed. Both dev servers stopped
    cleanly. `git status`/`git diff --stat` confirms only `server/services/aiService.js` (modified, exactly
    the Allowed Files scope) and the new test file changed this session (`.claude/settings.local.json` was
    already modified before this session started, unrelated).

# Decisions Made

Implemented as designed — Design 1-3 and D-1 through D-9 held with no deviation in the code itself. No
scope changes were made in response to the consume_pantry_item finding below; per the spec's own framing,
D-6 is an accepted residual risk for this task, not something to fix here, and the finding sharpens rather
than invalidates that framing (see Known Risks).

# Known Risks

- **D-6's "consume_pantry_item does not have this problem" claim is only true about the tool handler's
  resolution logic, not about whether the model attempts the call at all.** Live-verified this session
  (see above): with a household over the cap, asking to consume/eat a truncated-out item produces zero
  tool calls, not a successful fuzzy-matched consumption. The spec's Design 3 instruction explicitly told
  the model this case still works for `consume_pantry_item` — gpt-4o-mini didn't follow it in either of two
  phrasings tried. This is a bigger practical gap than the spec's Known Risks section describes (which
  frames the residual risk as specific to `update_pantry_item`/`remove_pantry_item`). Options for a future
  task, not decided here: strengthen/reorder the prompt instruction, few-shot it, or give
  `consume_pantry_item` a fallback path when the model's first attempt comes back empty-handed. Not fixed
  in this session — same "accepted residual risk, not fixed by this task" framing as D-6 already used,
  just now backed by a live reproduction instead of an assumption.
- **Thresholds (150/150) remain a reasoned proposal, not a measured value** (spec's own Known Risks) — no
  real household is close to this scale; only the synthetic cap=3 override exercised the truncation path.
- Carried forward, unrelated to this task: TASK-053's Vercel Preview streaming verification (Testing Plan
  step 9) and OpenAI billing confirmation are both still open — see [[project_go_public_readiness]].

# Context Notes

- branch: `staging`.
- Dev servers were started via `.claude/launch.json` (`server` on 3001, `client` on 5183); the server had to
  be manually stopped/restarted once to pick up the temporary `CHAT_CONTEXT_LIMITS.pantry = 3` edit and
  once more after reverting it, since this launch config runs `node index.js` directly (no nodemon/hot
  reload) — confirmed this explicitly before trusting either result, per the Local Smoke Testing Protocol.
  Both servers stopped cleanly at the end of the session.
- Browser pane session was already Clerk-authenticated at the start of this session (no fresh sign-in
  needed, unlike TASK-053's session).

# Recommended Next Action

1. Review the diff, then let Claude know if/when to commit — no commit was made this session per the
   commit-only-on-request convention.
2. Decide whether the `consume_pantry_item`-on-truncated-item gap (Known Risks) needs its own follow-up
   task now or can wait for real usage data, same as the spec's other deferred items.
3. Unrelated carry-forward, not blocking TASK-054: TASK-053's Vercel Preview streaming check and OpenAI
   billing confirmation are still open per [[project_go_public_readiness]].

---

## Archived History

- TASK-047 through TASK-053 (spec-drafting + TASK-053 streaming implementation session): see
  [archive/TASK-047-053.md](archive/TASK-047-053.md)
