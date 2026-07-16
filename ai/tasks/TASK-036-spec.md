# TASK-036 — Structural Cleanup: Chat Route Extraction, Client/Server Dedup, Lint/Format, CI

Version: DRAFT-3 — **APPROVED FOR IMPLEMENTATION** (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.5/10 — approve A/C/D with refinements, do not approve B as-is | Adopted: (1) Part A's `chatToolHandlers.js` restructured into `server/services/chat/createToolHandlers.js` + one file per handler, to avoid recreating the same blob in a new location, with an explicit note authorizing further extraction if any handler file grows large; (2) Part C's zero-lint-errors criterion softened to "errors block CI, warnings may remain if explicitly justified"; (3) Part D gains a `build` step in the CI pipeline (install → lint → tests → build), on the reasoning that a broken production build with green lint is worse than a lint failure; (4) added acceptance criteria: Part A runs the existing test suite as a baseline sanity check (with the honest caveat that it doesn't cover the chat route today), Part B verifies `npm ci` from a clean checkout, Part C verifies the Prettier pass produces zero semantic/test-result changes. **Reassessed rather than adopted verbatim: Part B.** The architect's recommendation was to defer npm-workspaces conversion to a separate future task, since it's a large infrastructure change for a small (~150-line) duplication problem. Agreed with the risk diagnosis, but on closer inspection of this codebase (server is plain Node ESM, client already runs Vite) npm workspaces aren't required to solve this problem at all — a plain `shared/` directory imported by relative path (or a Vite alias) removes the duplication with zero package-manager or Vercel dependency-resolution risk. Part B is rewritten around that instead of scheduling a workspace migration for later. **Not adopted**: splitting this into four separate TASK-036A/B/C/D documents — the user explicitly chose one consolidated spec for this round, and the reason the architect gave for isolating Part B (its blast radius) is substantially reduced by the redesign below. |
| DRAFT-2 | 9.6/10 — **APPROVED FOR IMPLEMENTATION** | No blocking issues; all remaining comments explicitly characterized as polish, not architectural deficiencies. Adopted: (1) Part A's "implementer's call" on the `server/utils/expiry.js`/`pantryDefaults.js` wrappers resolved — checked actual call sites (3 server files: `aiService.js`, `ai.js`/its post-extraction chat handlers, `pantryService.js`) and decided to remove the wrapper files entirely per the architect's recommendation, updating those 3 import sites directly; (2) since removing the wrappers means server files at varying depths (`routes/`, `services/`, `services/chat/handlers/`) would otherwise need fragile relative paths like `../../../../shared/expiry.js`, added a Node subpath-imports map (`"imports": {"#shared/*": "./shared/*"}`) to `server/package.json` — a built-in Node ESM feature, not an npm dependency or workspace, so it doesn't reintroduce the package-topology risk Part B was redesigned to avoid; (3) `shared/`'s one-way dependency rule is now actually enforced, not just documented — since Part C is adding ESLint in this same spec, wired in an `import/no-restricted-paths` (or equivalent `no-restricted-imports`) rule scoped to `shared/**` banning imports from `client/` or `server/`, going further than the architect's own suggestion of "conventions today, lint rule someday"; (4) added a literal, objective Part B acceptance criterion: zero remaining "Mirror of server/..." comments repo-wide; (5) added one-line clarifications: `recipeSearchService.js` remains independently usable recipe-domain logic, not chat-domain logic; `shared/` is explicitly limited to pure utilities, application/business-logic services must never migrate there. **Not adopted**: reordering to `A → C → B → D` — the architect raised it again but explicitly said they wouldn't block on it now that Part B carries no infrastructure risk; kept `C → A → B → D` per DRAFT-2's reasoning. **Noted, not actioned**: a future `handlers/index.js` barrel file if the handlers directory grows — left as a natural follow-up, not mandated now, consistent with this spec's scope discipline elsewhere. |

---

## Origin

This is not a bug-fix task — no production defect motivates it. It follows a request to research current Node/Express + React project-structure and portfolio-repo best practices, then audit this codebase against them, ahead of two upcoming changes to this project's status: (1) real day-to-day use by the user's household, (2) going public as a portfolio piece. Four independent findings came out of that audit; the user asked for all four to be wrapped into one spec for architect review before implementation, rather than implemented directly, given the project's established preference for review before structural/infra changes.

All four parts are pure refactors or additive tooling — **none change user-facing behavior**. The bar for each is: zero regressions, verified live where the change touches request-serving code paths (Parts A and B), verified via passing checks where it doesn't (Parts C and D).

---

## Part A — `server/routes/ai.js`'s `/chat` Handler: Extract Inline Tool Business Logic

### Problem

`server/routes/ai.js` is 684 lines — every other route file in this codebase is 86–125 lines (`household.js` 86, `shopping.js` 93, `push.js` 111, `recipes.js` 109, `pantry.js` 125) and delegates directly to a service. `ai.js` breaks that pattern: its `POST /chat` handler alone spans lines 263–682 (~420 lines) and defines a `toolHandlers` object **inline in the route** with six full tool implementations — `add_pantry_item`, `update_pantry_item`, `remove_pantry_item`, `consume_pantry_item`, `suggest_recipes`, `save_recipe`. `suggest_recipes` alone is a ~180-line scoring/tiering/annotation pipeline (dedup → blocklist filter → strategy resolution → scoring → target-ingredient partitioning → strategy sort → pantry-status annotation).

This is the one clear violation of the routes-stay-thin / logic-in-services convention the rest of the codebase already follows correctly, and it's also a practical maintenance cost: TASK-034 and TASK-035 both had to make targeted fixes inside this exact `suggest_recipes` closure, and both required reading through the entire route file to find it.

### Technical complication (must be resolved before extraction, not during)

The `toolHandlers` closures capture route-scope variables by reference. Most are read-only captures (`householdId`, `history`, `allItems`, `allRecipes`, `requestId`). One is not: `let recipeSuggestions = []` (line 297) is **mutated** inside `suggest_recipes` (line 637: `recipeSuggestions = annotated;`) and read again after `aiService.chat()` returns (line 677, passed into `chatService.savePair`). This mutation-via-outer-closure is a hidden side-channel that any extraction must explicitly account for.

### Fix Approach

Extract `toolHandlers` into `server/services/chat/`, not a single new file — per architect review round 1, a single `chatToolHandlers.js` just relocates the same growth problem to a new address. Structure:

```
server/services/chat/
    createToolHandlers.js      — factory: createToolHandlers(ctx) returns the toolHandlers object,
                                  ctx = { householdId, history, allItems, allRecipes, requestId }
    handlers/
        addPantryItem.js
        updatePantryItem.js
        removePantryItem.js
        consumePantryItem.js
        saveRecipe.js
        suggestRecipes.js      — thin wrapper only; scoring/tiering logic lives in
                                  recipeSearchService.js per D-A2 below
```

Each `handlers/*.js` file exports a single function taking `(args, ctx)`, doing its own zod validation and returning the same `{ok, ...}` shape the inline versions do today. `createToolHandlers.js` wires them into the object the chat dispatch loop expects. **Standing rule for this and future sessions**: if any individual handler file grows large enough to raise the same concern this task is fixing (rough guide: over ~100 lines), further decomposition within `handlers/` is pre-authorized — no new spec needed for that follow-up split. (Noted, not required now, per architect review round 2: if `handlers/` grows to many files, a `handlers/index.js` barrel re-exporting them may be worth adding then — left as a natural follow-up rather than built preemptively for six handlers.)

Two further sub-decisions flagged for architect input rather than decided unilaterally:

1. **The `recipeSuggestions` side-channel.** Two options: (a) preserve the mutation pattern — the factory also takes a mutable result holder (e.g. `ctx.result = { recipeSuggestions: [] }`, mutated by the handler, read by the route after `aiService.chat()` returns) — smallest diff, but keeps a wart; or (b) refactor to an explicit return — `suggest_recipes` returns its full annotated suggestions as part of its tool-result object, and `aiService.chat()`'s tool-call dispatch loop threads that back out to its own return value instead of relying on an external mutation. (b) is architecturally cleaner but touches `aiService.chat()`'s dispatch loop, which is outside this task's original scope. **Recommendation: (a) for this task**, explicitly flagged in code as a known pattern to revisit if `aiService.chat()`'s dispatch loop is ever touched for another reason — not fixing two things in one diff.
2. **How far `suggest_recipes` decomposes.** Two options: (a) move the entire ~180-line pipeline into `chatToolHandlers.js` as one function; or (b) keep `chatToolHandlers.js` as a thin wrapper (zod validation, `{ok, error}` wrapping) that calls a new `recipeSearchService.suggestForChat(...)` for the scoring/tiering/annotation logic itself — keeping tool-plumbing separate from recipe-domain logic, and putting the domain logic next to `findByPantry()` (which already owns the TASK-035 targeting fix) rather than in a file named for chat tooling. **Decision: (b)**, confirmed in architect review round 1. `recipeSearchService.js` remains recipe-domain logic in its own right — usable independently of chat tooling, not a chat-specific dependency — this is the point of putting it there rather than in `services/chat/`.

No logic changes are intended anywhere in this part. Every existing invariant (TASK-034 targeting, TASK-035 plural matching and query-dilution fix, blocklist filtering) must produce byte-identical behavior before and after.

### Decisions

- **D-A1**: `recipeSuggestions` closure mutation is preserved as-is for this task (option (a) above), not refactored to an explicit return — scope discipline, not an endorsement of the pattern.
- **D-A2**: `suggest_recipes`'s domain logic (scoring/tiering/annotation) moves to `recipeSearchService.js`; `chatToolHandlers.js` stays a thin tool-plumbing wrapper — confirmed in architect review round 1.
- **D-A3**: No behavior change anywhere in Part A. This is a pure move, not a rewrite.

### Acceptance Criteria

- `server/routes/ai.js` shrinks to roughly the scale of the codebase's other route files (target: under ~260 lines, matching route-declares-schema-and-delegates elsewhere).
- Live-verified via the real chat UI, all six tools behave identically pre/post-extraction: add an item, update it, consume it, remove it, ask for recipe suggestions naming a specific ingredient, save a suggested recipe.
- Re-run TASK-035's exact live check — "What should I make with garlic?" — and confirm all returned candidates still genuinely contain garlic (Tier-1 partitioning intact post-extraction).
- `aiService.js`'s public `chat()` signature is unchanged (per D-A1).
- Existing test suite (`node --test` across the three current `*.test.js` files) passes with no changes. Flagged honestly: none of the three today cover the chat route or its tools, so this is a baseline sanity check (nothing broke elsewhere), not coverage of the code actually being moved — the live-verification steps above are what actually cover this part.

---

## Part B — Kill Client/Server Code Duplication via a Shared Source Directory (No Workspaces)

### Problem

`client/src/utils/expiry.js` and `client/src/utils/pantryDefaults.js` are hand-maintained copies of `server/utils/expiry.js` and `server/utils/pantryDefaults.js` — both explicitly comment-labeled `// Mirror of server/utils/...`. Diffing them this session shows they've already drifted: the client copy carries five additional exported functions (`getRipeningDays`, `isRipening`, `getRipeningState`, `getExpiryRowClass`, `getExpiryBadgeClass`, `getExpiryLabel`) that don't exist server-side, and the shared header comments no longer match. This is an unlabeled superset now, not a clean mirror — any future fix to the shared calculation logic (expiry-day math, default storage location per category) risks landing in only one copy, a real correctness risk, not just a duplication smell.

Root cause: `client/` and `server/` are two fully independent npm packages, installed separately via the root `package.json`'s `postinstall: npm install --prefix server && npm install --prefix client`. Nothing today lets one import from the other.

### Revised approach — round 1 finding

DRAFT-1 proposed converting the repo to npm workspaces plus a `shared/` package to solve this. Architect review round 1 flagged that as disproportionate — a large infrastructure change (install mechanics, dependency resolution, Vercel's function-bundling behavior) for what's actually a small amount of duplicated logic — and recommended splitting the workspace migration into its own later task.

On closer inspection, npm workspaces aren't required to solve this problem at all, so there's a smaller fix than "defer it" available: **a plain `shared/` directory of source files, imported by relative path, with no `package.json`, no workspace declaration, and no change to how either package installs or builds.** `server/` is already plain Node ESM — relative imports across directories work natively, no bundler involved. `client/` already runs on Vite, which supports resolving arbitrary path aliases outside `src/` with a one-line `vite.config.js` change. Neither needs a package boundary to import a handful of pure functions from a shared folder.

### Fix Approach

1. New top-level `shared/` directory (plain files, no `package.json`): `shared/expiry.js` and `shared/pantryDefaults.js`, holding only the calculation logic that exists identically in both locations today — the expiry-day math, plus `getDefaultStorageLocation`/`STORAGE_LOCATIONS`/`STORAGE_LOCATION_LABELS`. Client-only, UI-specific functions (`getRipeningDays`, `getExpiryRowClass`, `getExpiryBadgeClass`, `getExpiryLabel` — Tailwind-class/formatting helpers with no server equivalent) **stay in `client/src/utils/expiry.js`**, which imports the shared calc functions and layers UI helpers on top.
2. `server/utils/expiry.js` and `server/utils/pantryDefaults.js` are **deleted**, not kept as re-export wrappers — decided in architect review round 2 rather than left as an implementer's-choice ambiguity. Confirmed only 3 server files import them today (`server/services/aiService.js`, `server/routes/ai.js` — moving to `server/services/chat/` per Part A — and `server/services/pantryService.js`), a small enough call-site count that updating imports directly is cleaner than carrying a permanent indirection layer.
3. Those 3 (now-relocated, per Part A) server call sites, and the new `shared/` files themselves at varying directory depths, need a way to reference `shared/` without fragile relative paths like `../../../../shared/expiry.js` from `server/services/chat/handlers/`. Fix: `server/package.json` gains a Node subpath-imports map — `"imports": {"#shared/*": "./shared/*"}` — so any server file imports via `import { getExpiryDays } from '#shared/expiry.js'` regardless of its own depth. This is a built-in Node ESM feature (resolved by Node itself, not npm), so it does **not** reintroduce any package-manager or install-mechanics risk — added to Overall Allowed Files below.
4. `client/vite.config.js` gains a resolve alias, e.g. `'@shared': path.resolve(__dirname, '../shared')`, so client imports read `import { getExpiryDays } from '@shared/expiry.js'` rather than a fragile relative path.
5. **No changes to either `package.json`'s dependencies, no root `workspaces` field, no change to `postinstall`, `build`, or `vercel-build` scripts, no change to `api/index.js`'s import of `server/app.js`.** Install and build mechanics are untouched — `server/package.json`'s `imports` map (step 3) is metadata Node reads at import-resolution time, not a dependency or install-affecting field.

### Dependency-direction rule (from architect review round 1 — adopted and, per round 2, enforced not just documented)

`shared/` may only be imported **by** `client/` and `server/`; it must never import **from** either. Round 1 accepted convention-only enforcement (no package-manager boundary to enforce it automatically, the way an npm workspace would). Round 2 improves on that: since Part C adds ESLint in this same spec anyway, wiring in a `no-restricted-imports` (or `eslint-plugin-import`'s `import/no-restricted-paths`) rule scoped to `shared/**`, banning any import from `../client` or `../server`, costs almost nothing extra and closes the "conventions erode over a year" risk the architect flagged — immediately, not as a someday item. See Part C for the actual rule addition; noted here since it's Part B's boundary being enforced.

### Why this supersedes rather than just defers the workspaces plan

The architect's core objection was blast radius: install/build/deploy mechanics changing to fix ~60–80 lines of duplicated logic. This redesign has none of that — nothing about `node_modules` resolution, Vercel's function bundling, or either package's install process changes. The Vercel dependency-resolution risk DRAFT-1 flagged as "the single highest-risk item in this spec" doesn't apply to this design at all, because there's no dependency hoisting involved — `shared/` is source files, traced the same way `server/data/purineIndex.js` already is today. Full npm-workspaces conversion may still be worth doing someday if a second, harder cross-package sharing need shows up (e.g. shared TypeScript types, if this codebase ever adds TS) — noted under Out of Scope, not scheduled.

### Decisions

- **D-B1**: `shared/` contains only pure, dependency-free calculation functions. UI-specific code and DB/Express-specific code never cross into it (unchanged from DRAFT-1's intent, now also tooling-free). Per architect review round 2: `shared/` is intentionally and permanently limited to pure utilities — application services or business logic must never migrate there just because they happen to be used from two places. If a future need looks like "share business logic," that's a different, bigger decision than this task, not an extension of `shared/`'s existing scope.
- **D-B2 (superseded)**: DRAFT-1's `--prefix` vs `--workspace` question no longer applies — no workspace conversion in this design.
- **D-B3**: `shared/` has no test file of its own today (neither `expiry.js` nor `pantryDefaults.js` currently has *any* dedicated test, client or server side) — per architect review round 1's point that a shared, independently-reasoned-about module should have test coverage, this task adds one: `shared/expiry.test.js` and/or `shared/pantryDefaults.test.js` using `node:test`, matching this codebase's existing convention. This is new coverage, not migrated coverage — a net improvement over the status quo, not scope creep.
- **D-B4**: `server/utils/expiry.js`/`pantryDefaults.js` wrappers are removed, not kept — see Fix Approach step 2 (round 2 decision, replacing DRAFT-2's "implementer's call").

### Acceptance Criteria

- `client/src/utils/expiry.js` and `pantryDefaults.js` no longer contain duplicated calculation logic — they import it from `shared/`.
- Zero remaining `// Mirror of server/...` (or equivalent) comments anywhere in the repo — an objective, greppable end state (architect review round 2).
- `shared/` has unit test coverage for its calculation functions (new, per D-B3).
- `npm run dev` (root) still starts both client and server correctly.
- `npm run build` (root) still produces a working `client/dist`.
- `npm ci` succeeds from a clean checkout (both `server/` and `client/`, matching current install mechanics) — confirms nothing about the install path was accidentally disturbed.
- A Vercel preview deployment is checked end-to-end (pantry add/edit, AI chat round-trip, shopping-list build) before merging — kept as a cheap sanity check given this app's move to real household use, even though this redesign removes the specific dependency-resolution risk that made it a hard gate in DRAFT-1.

---

## Part C — Add ESLint + Prettier

### Problem

No lint or format config exists anywhere in the repo (`.eslintrc*`, `eslint.config.js`, `.prettierrc*` all absent). For a project going public as a portfolio piece, this is the first thing many reviewers check for and currently fails silently (no `lint` script exists to even run).

### Fix Approach

- Add a flat-config `eslint.config.js` (ESLint 9+) — a shared base at root plus workspace-specific overrides: `client` needs `eslint-plugin-react` + `eslint-plugin-react-hooks`, `server` doesn't.
- Include one rule enforcing Part B's `shared/` one-way dependency boundary: a `no-restricted-imports` (or `eslint-plugin-import`'s `import/no-restricted-paths`) rule scoped to files under `shared/**`, disallowing any import from `../client` or `../server`. This is a direct, immediate answer to architect review round 2's future-proofing concern ("conventions erode after a year") rather than a deferred one — costs one config block since ESLint is already being introduced here.
- Add Prettier with a `.prettierrc` matching this codebase's existing de facto style (single quotes, semicolons, 2-space indent, as seen consistently across current files) — chosen specifically so the first `--write` pass produces a minimal diff rather than a wall-to-wall reformat that obscures real changes in the same commit.
- Add `lint` / `format` scripts at root and in each workspace's `package.json`.

### Decisions

- **D-C1**: The initial Prettier `--write` pass runs repo-wide as part of this task, as its own isolated, no-logic-change commit — deferring it just means a larger, more-diverged codebase to reformat later.
- **D-C2**: Start from `eslint:recommended` + `eslint-plugin-react-hooks`'s recommended rules, not a stricter preset (e.g. Airbnb) — avoids generating a large backlog of pre-existing violations to triage in this task.

### Acceptance Criteria

- `npm run lint` exists at root and exits non-zero (fails CI) only on errors. Per architect review round 1: warnings may remain if explicitly justified in a code comment or this spec — the goal is a meaningful CI gate, not a zero-warning count that pressures disabling useful rules just to hit zero.
- `npm run format` (or equivalent) exists.
- The Prettier reformat pass is committed separately from any logic changes in Parts A/B, so it's reviewable in isolation.
- The reformat pass introduces zero semantic changes: existing test suite passes identically before and after, and the diff is spot-checked for ASI-risk patterns (e.g. multiline chained method calls, object literals returned without parens) that automated reformatting can occasionally break — per architect review round 1.

---

## Part D — Add CI

### Problem

No `.github/workflows` exists — nothing runs automatically on push or PR. For a public repo this is a low-effort, high-signal gap (no green checkmark, no proof the repo is in a working state at a glance).

### Fix Approach

One workflow, `.github/workflows/ci.yml`: on push/PR to `main`, run install → lint → test → build, in that order:
1. Install dependencies (Part B leaves the existing `--prefix`-based install path unchanged, so this step is unaffected by Part B).
2. `npm run lint` (Part C).
3. Existing test suite (`node --test` across `foodNormalization.test.js`, `keyEncryption.test.js`, `purineIndex.test.js`, plus the new `shared/` tests from Part B).
4. `npm run build` (root, i.e. the client production build). Added per architect review round 1: a green lint check with a broken production build is a worse failure mode to miss than a lint error, and this is a single cheap step to add.

No deploy step — Vercel already runs its own deploy-preview pipeline independently of this workflow.

**On fork PRs (architect review round 1 raised this — clarified, not simply adopted):** a standard `on: pull_request` trigger already runs automatically on PRs from forks by default, with no extra workflow configuration needed — this isn't an oversight to fix in the YAML. The one real nuance for a public repo is that GitHub requires manual maintainer approval before Actions runs for a **first-time contributor's** PR, which is a repository *Settings* toggle (Actions → Fork pull request workflows), not something expressed in `ci.yml`. Noting it here since it's relevant to "runs correctly once public," but there's no code change attached to it.

### Decisions

- **D-D1**: Part D is implemented last, after Parts B and C land — it depends on both the final install command (Part B, though now unchanged from today) and the `lint` script (Part C) existing. Sequencing note, not a blocker.

### Acceptance Criteria

- A PR against `main` shows a CI check that runs install → lint → test → build and reports pass/fail accurately at each stage.

---

## Recommended Implementation Order

**C → A → B → D** — unchanged from DRAFT-1, revisited explicitly given architect review round 1 argued for infra-last (`A → C → D → B`).

Their reasoning was sound for the DRAFT-1 version of Part B (an actual package-topology/install-mechanics change, best done once everything else is settled). It carries much less force now: the redesigned Part B touches no install, build, or deploy mechanics at all — it's a source-file reorganization comparable in risk to Part A, not an infrastructure migration. Given that, there's no longer a strong reason to sequence it last, and the original reasoning for C-first still holds (establish the formatting baseline before A/B produce diffs, so those diffs aren't tangled with incidental reformatting). Keeping C → A → B → D. If Part B is implemented and turns out to touch more than the files listed in Allowed Files below, that's a signal to stop and revisit sequencing, not push through.

---

## Overall Allowed Files

- `server/routes/ai.js`, new `server/services/chat/createToolHandlers.js` + `server/services/chat/handlers/*.js`, `server/services/recipeSearchService.js` (Part A)
- New `shared/expiry.js`, `shared/pantryDefaults.js`, `shared/expiry.test.js` and/or `shared/pantryDefaults.test.js`; deletion of `server/utils/expiry.js` and `server/utils/pantryDefaults.js` (per D-B4); `server/package.json` (new `imports` subpath map only — no dependency changes); `client/src/utils/expiry.js`, `client/src/utils/pantryDefaults.js`, `client/vite.config.js`; the 3 server files whose imports move (`server/services/aiService.js`, `server/services/pantryService.js`, and wherever Part A relocates the former `ai.js` chat-tool logic) (Part B)
- New `eslint.config.js` (root + workspace overrides), new `.prettierrc`, root/workspace `package.json` scripts sections, and — per D-C1 — every source file, for formatting only (Part C)
- New `.github/workflows/ci.yml` (Part D)

## Overall Forbidden Files

- `server/db/schema.js`, `server/db/migrations/` — zero schema changes anywhere in this spec
- No changes to AI prompts, tool JSON schemas, or any request/response shape — this is a structure-only spec
- No client component (`.jsx`) logic changes beyond the two utils files named in Part B, and those changes are import-source changes only, not logic changes
- `vercel.json` — not expected to require changes, but any change here in practice must be called out explicitly and separately, given Part B's deploy risk

## Constraints

- Zero user-facing behavior changes anywhere in this spec. Every part is refactor or additive tooling only. Architect review round 1 flagged that DRAFT-1's Part B (npm workspaces) made this claim inaccurate, since dependency-resolution mechanics are runtime behavior even if business logic doesn't change — correct at the time. The redesigned Part B below no longer touches install, build, or dependency-resolution mechanics at all, so the original "zero behavior change" claim now holds for every part of this spec, not just most of it.
- No new abstractions beyond what's specified (no controller layer, no ORM changes, no TypeScript conversion, no npm workspaces — all considered and explicitly out of scope, see below).
- Formatting changes (Part C) must land as commits isolated from logic changes (Parts A/B), so either is independently reviewable and revertable.
- `shared/` is a one-way dependency (importable by `client/`/`server/`, never imports from either) — see Part B's Dependency-direction rule.

## Out of Scope (considered, explicitly declined)

- **Full npm-workspaces / monorepo-tooling conversion** — DRAFT-1's original approach to Part B. Superseded, not merely deferred: the redesigned Part B (plain `shared/` directory, relative imports / Vite alias) solves the actual problem — duplicated logic — without it. Worth revisiting only if a harder cross-package sharing need shows up later (e.g. shared TypeScript types, if this codebase ever adopts TS, or a third app/package joining `client`/`server`) — not scheduled, no task number assigned.
- **TypeScript conversion** — a much larger, higher-risk change than anything in this spec; not requested, not undertaken here.
- **Switching package managers (e.g. to pnpm)** — moot now that Part B doesn't touch package management at all; noted as considered during research regardless.
- **Adding a controller layer between routes and services** — the existing route-calls-service-directly pattern (no controllers) already works well for every route file except `ai.js`'s `/chat`; introducing a controller layer project-wide would be a bigger architectural change than this audit's findings justify.
- **A test framework beyond Node's built-in `node:test`** — the existing three test files already use it; switching to Jest/Vitest is a separate decision not motivated by anything in this spec.

## Verification Steps

1. **Part A**: live chat-UI walkthrough of all six tools (see Acceptance Criteria), re-run of the TASK-035 garlic-targeting check, and existing test suite passes.
2. **Part B**: `npm ci` from a clean checkout, local `npm run dev` + `npm run build`, new `shared/` unit tests pass, then a Vercel preview deployment checked end-to-end (pantry CRUD, AI chat, shopping-list build) as a sanity check.
3. **Part C**: `npm run lint` exits non-zero only on unjustified errors; formatting-only commit reviewed in isolation; test suite passes identically before/after the reformat.
4. **Part D**: open a throwaway PR (or push to a branch) and confirm the CI check runs install → lint → test → build and reports correctly at each stage.
