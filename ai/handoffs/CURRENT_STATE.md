# Task
TASK-036 — Structural Cleanup: Chat Route Extraction, Client/Server Dedup, Lint/Format, CI. **All four parts (C, A, B, D) implemented and committed this session**, following the spec's own recommended order (C → A → B → D). No production defect motivated this task — pure refactor/tooling, zero intended user-facing behavior change.

# Current Status
All of [ai/tasks/TASK-036-spec.md](../tasks/TASK-036-spec.md) is implemented. Five commits, one per part (Part C split into two: tooling+fixes, then an isolated reformat commit per D-C1):
1. `fb2da63` — Part C: ESLint 9 + Prettier added, pre-existing lint-blocking issues fixed (dead code, unescaped JSX entities, an abstract-interface file's intentionally-unused params).
2. `aad3cc0` — Part C: repo-wide Prettier reformat, isolated commit, zero semantic changes (markdown excluded — see Decisions).
3. `74a1d93` — Part A: chat route tool handlers extracted from `server/routes/ai.js` into `server/services/chat/`.
4. `d3c919c` — Part B: `shared/` directory for client/server dedup (with one flagged deviation from the spec's literal text — see Decisions).
5. `e20b178` — Part D: GitHub Actions CI workflow.

**Not pushed.** All work is local commits on `main`. Pushing needs separate user authorization (safety-rule boundary, not a task blocker).

# Files Modified
**Part C (tooling):** new `eslint.config.js`, `.prettierrc`, `.prettierignore`; `package.json`/`server/package.json` scripts + devDependencies; lint-driven fixes in `client/src/hooks/useRecipes.js`, `client/src/pages/{RecipesPage,DashboardPage,HouseholdPage,LoginPage}.jsx`, `client/src/components/pantry/{SplitItemModal,ReceiptUpload}.jsx`, `client/src/components/shopping/BuildListModal.jsx`, `server/services/{householdService,pantryService,aiService}.js`, `client/public/sw.js`.

**Part C (reformat):** ~70 client/server `.js`/`.jsx`/`.json` files, Prettier `--write` only. Markdown (`ai/`, `docs/`, `README.md`) deliberately excluded — see Decisions.

**Part A:** `server/routes/ai.js` (949 → 385 lines), `server/services/recipeSearchService.js` (+`suggestForChat()`, +`deriveRecipeKey()`), new `server/services/chat/createToolHandlers.js` + `handlers/{addPantryItem,updatePantryItem,removePantryItem,consumePantryItem,suggestRecipes,saveRecipe}.js`.

**Part B:** new `shared/{expiry,pantryDefaults}.js` + `shared/{expiry,pantryDefaults}.test.js`; deleted `server/utils/{expiry,pantryDefaults}.js`; import-site updates in `server/routes/ai.js`, `server/services/{aiService,pantryService}.js`, `server/services/chat/handlers/{addPantryItem,consumePantryItem}.js`; `client/vite.config.js` (+`@shared` alias); rewrote `client/src/utils/{expiry,pantryDefaults}.js` to import from shared.

**Part D:** new `.github/workflows/ci.yml`.

# Files Already Reviewed
Full reads this session: `server/routes/ai.js` (pre- and post-extraction), `server/services/recipeSearchService.js`, `server/utils/{expiry,pantryDefaults}.js`, `client/src/utils/{expiry,pantryDefaults}.js`, `client/vite.config.js`, all three `package.json` files, `client/src/components/recipes/RecipeCard.jsx` / `client/src/pages/ChatPage.jsx` (to confirm the "Save Recipe" button routes through the chat tool, not a direct REST call).

# Dependency Chain
Matches the spec's own Overall Allowed Files exactly, with one addition: Part B also touched `server/routes/ai.js` for its remaining (non-chat-tool) `getExpiryDays`/`getExpiryStatus`/`getDefaultStorageLocation` imports — not explicitly named in the spec's Part B file list, but `ai.js` was already an allowed file for this task overall and this import-site update is a direct, necessary consequence of deleting `server/utils/expiry.js`/`pantryDefaults.js`.

Irrelevant (untouched, per spec's Overall Forbidden Files): `server/db/schema.js`, `server/db/migrations/`, AI prompts/tool JSON schemas, `vercel.json` (Part C's Prettier pass touched its formatting only, confirmed — flagged per the spec's explicit "call out any vercel.json change" instruction).

# Architecture Notes
- **`eslint-plugin-react-hooks` pinned to `^5.2.0`, not the latest `^7.x`.** v7's `recommended` config bundles 16 React-Compiler-oriented rules (`set-state-in-effect`, `purity`, `immutability`, etc.) — a materially different, much stricter thing than "hooks linting," and would have generated the exact large pre-existing-violation backlog D-C2 explicitly said to avoid. v5's `recommended` is the classic 2-rule set (`rules-of-hooks: error`, `exhaustive-deps: warn`), matching D-C2's actual intent for a codebase with no React Compiler usage.
- **`no-unused-vars` configured with `argsIgnorePattern`/`varsIgnorePattern: '^_'`** globally, plus a file-scoped `args: 'none'` override for `server/services/ai/providerInterface.js` (an abstract base class whose method params document the adapter contract, always unused in the base — every method throws `'Not implemented'`).
- **Markdown excluded from Prettier** (`.prettierignore`: `*.md`) after the first `--write` pass reformatted `ai/tasks/*.md` archived specs into wide, padded tables — pure noise on historical records, reverted before committing. This wasn't in the spec's Allowed Files list as an explicit exclusion, but "every source file, for formatting only" reasonably reads as code, not documentation/spec archives.
- **`suggestForChat()` calls `findByPantry()` directly**, not via `aiService.suggestRecipes()`'s wrapper — both now live in `recipeSearchService.js`, and going through `aiService` would create an import cycle (`aiService.js` already imports from `recipeSearchService.js`).
- **The `recipeSuggestions` closure-mutation preserved per D-A1**, via `ctx.result = { recipeSuggestions: [] }` — written by `handlers/suggestRecipes.js`, read by the `/chat` route after `aiService.chat()` returns.
- **`shared/`'s two files have asymmetric shapes**: `pantryDefaults.js` has zero client-only additions today, so `client/src/utils/pantryDefaults.js` is a pure `export * from '@shared/pantryDefaults.js'`. `expiry.js` has 5 client-only UI helpers (`getRipeningDays`, `isRipening`, `getRipeningState`, `getExpiryRowClass`, `getExpiryBadgeClass`, `getExpiryLabel`), so `client/src/utils/expiry.js` imports the 2 shared calc functions, re-exports them, and layers the UI helpers on top — matching the spec's Fix Approach step 1 exactly.

# Decisions Made
- **Part C: markdown excluded from Prettier's scope** (see Architecture Notes) — an implementer's-call exclusion the spec didn't explicitly authorize, but D-C1's own goal ("minimal diff," "reviewable in isolation") is directly undermined by reformatting unrelated historical documents. Flagged, not silently done.
- **Part C: `eslint-plugin-react-hooks` version pin to `^5`** (see Architecture Notes) — required to actually satisfy D-C2's stated intent, since the literal "install the recommended config" instruction would have violated D-C2's own reasoning given v7's scope change.
- **Part C: dead-code/unescaped-entity fixes bundled into the same commit as the ESLint/Prettier tooling setup**, not the separate reformat commit — these are semantic (not formatting) changes, so isolating them from the *reformat* pass (which the spec's acceptance criteria require to be "zero semantic changes") took priority over isolating them from the *tooling setup* commit, which the spec didn't require to be logic-change-free.
- **Part B: abandoned the spec's literal `server/package.json` `"imports": {"#shared/*": "./shared/*"}` subpath-imports map**, confirmed via a live reproduction that Node throws `ERR_INVALID_PACKAGE_TARGET` for any `imports` target resolving outside the declaring package's own directory — `shared/` is a sibling of `server/`, not nested inside it, and Part B's Fix Approach step 1 requires it to be top-level (shared with `client/` via the same directory). Used plain relative imports instead (`../../shared/...`, `../../../../shared/...` from the deepest chat-handler files) — the same pattern already used everywhere else in this codebase, including every file Part A added this session. This is the single largest deviation from the spec's literal text this session; everything else matched.
- No other spec-level decisions were revisited — implementation followed TASK-036-spec.md's own Decisions (D-A1 through D-A3, D-B1 through D-B4, D-C1/D-C2, D-D1) as written.

# Remaining Work
1. **Push and open a PR** so Part D's own acceptance criterion (a real GitHub Actions run) can actually be observed — not done this session, needs explicit authorization (a `git push` is outside what I do without asking first).
2. **Part B's last verification step — a live Vercel preview deployment check** (pantry CRUD, AI chat round-trip, shopping-list build) — also blocked on the push above; the spec calls this "a cheap sanity check... even though this redesign removes the specific dependency-resolution risk that made it a hard gate in DRAFT-1," so it's valuable but not risk-critical given everything else (npm ci, build, live dev-server `@shared` resolution) was already verified locally.
3. Nothing else outstanding from this spec — all four parts' own acceptance criteria that don't require a push are met and verified.

## Backlog (carried forward, unchanged from prior sessions unless noted)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.
- One real household item (`BNLS/SL BRST`, id 19) still has `storageLocation: 'pantry'` from TASK-031's session testing — cosmetic.
- `POST /api/ai/eat-this-now` doesn't honor the recipe blocklist (TASK-034 Out of Scope, confirmed unchanged) — candidate for a follow-up task if it proves to matter in practice.
- C2 (from TASK-035 session): Clerk running in Development mode on production — Vercel env-var / Clerk-dashboard config question, not a code change. Still open, not touched this session (out of TASK-036's scope).
- **New this session**: `recipeScorer.js`'s bundle-size warning (`index-*.js` at 542 kB gzipped 159 kB) surfaced by every `npm run build` this session — pre-existing, not caused by this task, not part of its scope (no code-splitting work was in TASK-036-spec.md). Worth a follow-up task if load time ever becomes a concern.

# Known Risks
- **Untested against a real GitHub Actions runner** — the workflow was validated by parsing its YAML and replicating each step's exact command locally (all passed), but the actual `ubuntu-latest` environment, Node 20 install, and `actions/setup-node` cache behavior have not been observed running for real. Low risk (the steps are simple `npm` invocations already proven to work), but not zero.
- **Part A's live verification exercised real production data** (the shared Neon dev/prod database) — a test pantry item (`TASK036 test chicken`, added/updated/consumed-ambiguity-checked/removed) and a test-saved recipe (`BBQ Gochujang Cauliflower Fried Rice`, saved then deleted) were both created and cleaned up via the real UI this session. Confirmed clean via a final Pantry-page and Recipes-page read after cleanup — no residual test data left behind.
- **Bundle-size warning is pre-existing**, not a regression from this session (see Backlog) — confirmed by it appearing identically in every `npm run build` run across all three parts.
- No automated test suite beyond `node --test` (`foodNormalization.test.js`, `keyEncryption.test.js`, `purineIndex.test.js`, plus this session's new `shared/expiry.test.js` and `shared/pantryDefaults.test.js` — 72 tests total now, up from 59) — consistent with every prior session's methodology; this session added net-new coverage rather than removing any.

# Verification Results
- **Part C**: `npm run lint` exit 0 (was 45 errors → 36 after the react-hooks pin → 0 after fixes). `npx prettier --check .` clean after the reformat commit. 59/59 tests pass before and after reformat. Client build output unchanged (same bundle sizes) before/after reformat.
- **Part A**: All six chat tools live-verified via the real chat UI: `add_pantry_item` ✅, `update_pantry_item` ✅, `consume_pantry_item` ✅ (exercised its ambiguous-match branch), `remove_pantry_item` ✅ (confirmed absent from Pantry page after), `suggest_recipes` ✅ (re-ran TASK-035's exact "What should I make with garlic?" check — 3/3 candidates contain garlic, same as before extraction), `save_recipe` ✅ (confirmed recipe appeared in Recipes page, then deleted). 59/59 unit tests pass. Lint clean.
- **Part B**: `npm ci` succeeds clean at root (cascades to `server/` and `client/`). `npm run build` produces working `client/dist`. 13 new `shared/` tests + 59 existing = 72/72 pass. Live-verified the client dev server's `@shared` alias resolves correctly at runtime (not just `vite build`) — Pantry page rendered all expiry statuses/labels and storage badges with zero console errors, against the real dev-server + real database. Grep-confirmed zero remaining `Mirror of server/...` comments repo-wide.
- **Part D**: `.github/workflows/ci.yml` YAML parsed and validated with `js-yaml`. Each step's exact command (`npm ci`, `npm run lint`, `npm test`, `npm run build`) run locally in sequence — all pass. Not yet observed running on an actual GitHub Actions runner (needs a push).

# Recommended Next Action
Ask the user whether to push this branch (5 commits, all local) so Part D's CI workflow and Part B's Vercel-preview check can both be observed for real — the only two spec acceptance criteria not verifiable without a push. If the user isn't ready to push yet, TASK-036 is otherwise fully implemented and locally verified; no further local work is queued.

# Forbidden Exploration
No longer applicable — TASK-036 is complete pending the push decision above; no fresh spec is queued yet.

# Context Notes
- branch: main
- worktree: none
- context pressure: high — full 4-part spec (C→A→B→D) implemented, live-verified, and committed in one session, including a from-scratch Node `imports` restriction investigation in Part B.

# PowerShell Merge Block
All 5 commits already made locally this session (see Current Status for hashes) — nothing further to stage. This block is only relevant if the user wants to push.

```powershell
git push
```
