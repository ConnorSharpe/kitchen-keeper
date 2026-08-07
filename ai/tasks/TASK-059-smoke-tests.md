# TASK-059 Full Regression Smoke Test
## Comprehensive Pre-Production-Push Smoke Test (staging → main)

---

## Purpose & Scope

Staging (`staging` branch) has accumulated multiple unreleased changes not yet on `main`/production —
most significantly the TASK-057 "Modern Farmhouse" visual redesign, which touched nearly every screen
(Sidebar, Dashboard, Pantry, Chat, Recipes, Shopping, Household, Landing, `DietaryProfileForm`). This
test exists to catch regressions across the **whole app**, not just the redesigned surface, before
`staging` is merged into `main` and deployed to real users.

This is a checklist for the agent to walk Connor through interactively (or execute directly via the
Local Smoke Testing Protocol / browser tools where the step doesn't require a human judgment call —
e.g. visual "does this look right" checks should go to Connor; "does the network request succeed" checks
can be automated). Not a unit/integration test suite — `npm test` (98/98) already covers logic-level
regressions; this covers what only a real running app can show you.

---

## Environment & Setup

- **Run this against the staging Preview deployment**, not production and not local — it's the only
  environment that (a) reflects the actual deployed build users will hit next, and (b) has its own
  isolated Neon branch and Clerk dev instance, so test writes can't pollute real user data. See
  [CONVENTIONS.md](../handoffs/CONVENTIONS.md) for environment details.
  - URL: `kitchen-keeper-git-staging-connorsharpes-projects.vercel.app`
  - If local dev is used instead for faster iteration, note it explicitly in Results — local's Neon
    branch is separate again, so a pass locally doesn't guarantee the staging *build* is clean (env
    vars, CDN caching, and prod build optimizations only exist in the deployed Preview).
- **Confirm the staging Neon branch has all pending migrations applied** before testing (per
  CONVENTIONS.md's canonical migration order) — a schema mismatch here produces confusing failures that
  look like app bugs.
- **Test account**: use a disposable Clerk dev-instance account (or an existing throwaway one) — Clerk's
  staging instance (`pk_test_...`) is separate from production, so no real user data is at risk here
  regardless.
- **Test data discipline**: prefix anything you create (household name, recipe titles, pantry items) with
  a visually distinctive marker, e.g. `ZZSMOKE-`, so cleanup is a trivial visual scan, not a guess. Delete
  everything you create before ending the session (create → verify → delete; see Cleanup section).
- Open DevTools/console tools alongside the browser pane for the whole session — several checks below are
  "no console errors," which is easy to miss without it open continuously.

---

## 0. Pre-Flight Environment Sanity Check

| # | Step | Expected |
|---|------|----------|
| PF-1 | Load the staging URL cold (no cache) | Landing page renders, no console errors, no failed network requests |
| PF-2 | Check Network tab for the initial page load | No 4xx/5xx on any request; API calls hit the staging API origin, not localhost or production |
| PF-3 | Confirm build freshness | Latest `staging` commit hash/timestamp matches what you expect (Vercel deployment log or a version marker if one exists) |

---

## 1. Auth & Account

| # | Step | Expected |
|---|------|----------|
| AUTH-1 | Sign up with a new test email via Clerk | Account created, redirected into the app (onboarding or dashboard) |
| AUTH-2 | Sign out | Returned to Landing page; protected routes redirect to sign-in if visited directly by URL |
| AUTH-3 | Sign back in with the same account | Lands back in the app with prior state intact (household, pantry, etc.) |
| AUTH-4 | Reload an authenticated page (e.g. Dashboard) | Session persists — no forced re-login on a simple refresh |
| AUTH-5 | Visit a protected route while signed out (direct URL) | Redirected to sign-in, not a crash or blank page |

---

## 2. Onboarding (new-account flow)

| # | Step | Expected |
|---|------|----------|
| ONB-1 | As a brand-new account (from AUTH-1), observe first-load behavior | `OnboardingGate` intercepts; `WelcomeStep` shown |
| ONB-2 | Progress through `StaplesChecklist` | Selections register; can proceed |
| ONB-3 | Reach `OnboardingPreview` and complete onboarding | `PATCH /api/onboarding` fires; redirected into the main app; onboarding does not reappear on next load |
| ONB-4 | Reload mid-onboarding (after WelcomeStep, before completing) | Onboarding resumes appropriately rather than losing all progress or crashing |

---

## 3. Household

| # | Step | Expected |
|---|------|----------|
| HH-1 | Open Household page | Household name, join code, and member list render; visually matches TASK-057's `.card-callout` migration (no raw-orange leftovers) |
| HH-2 | Rename household (`ZZSMOKE-Household`) | Name updates immediately, persists on reload |
| HH-3 | Send an invite to a second test email | Invite email sends (check for a success toast/state, not just no-error) — if `RESEND_API_KEY` isn't configured on staging, confirm the failure is a clear user-facing error, not a silent hang |
| HH-4 | Join via join code from a second account (or `JoinPage.jsx` directly with the code) | Second account joins the household; its previously auto-created empty household is cleaned up per `household.js`'s join logic; both accounts now see the same pantry/recipes/lists |
| HH-5 | Member list updates after join | New member appears in `/api/household/members` output on Household page without a hard refresh, or on next load at minimum |

---

## 4. Dashboard

| # | Step | Expected |
|---|------|----------|
| DASH-1 | Load Dashboard with existing pantry data | `ExpiryStrip` shows color-coded urgency (critical/warning/ok) matching item expiry dates |
| DASH-2 | Check `EatThisNow` suggestions | AI-generated suggestions render based on most-expiring items; loading state shows while generating, no indefinite spinner |
| DASH-3 | Use `QuickAdd` to add a pantry item from Dashboard | Item appears in Pantry; ExpiryStrip updates to reflect it if relevant |
| DASH-4 | Check `WasteSaved` counter | Renders a number/estimate without error (exact value not verifiable, just presence + no crash) |
| DASH-5 | Save a suggested recipe from `EatThisNow` | Recipe is added to Recipes with `source` reflecting AI-suggestion origin |

---

## 5. Pantry

| # | Step | Expected |
|---|------|----------|
| PANTRY-1 | Manually add an item (`ZZSMOKE-TestItem`) via `AddItemModal` | Item appears in pantry list/table immediately |
| PANTRY-2 | Scan a receipt via `ReceiptUpload` (use an in-browser-generated or real test receipt image — do not round-trip large binary data through your own context, per Local Smoke Testing Protocol) | Configured vision provider (`parseReceipt` in `aiService.js` — currently OpenAI vision; do not hardcode a provider name here, it has changed twice already: Gemini → Groq → OpenAI) extracts items successfully; a provider error surfaces a clear message, not a silent hang |
| PANTRY-3 | Edit an item's quantity/expiry | Change persists on reload |
| PANTRY-4 | Toggle Freeze on an item | Item marked frozen; AI-generated storage tip appears; "❄ Frozen" tag renders (raw-blue per TASK-057's accepted gap, not a bug) |
| PANTRY-5 | Split an item via `SplitItemModal` | Original item splits into two correctly (quantities sum correctly, no data loss) |
| PANTRY-6 | Delete the `ZZSMOKE-TestItem` | Item removed from list, no orphaned references elsewhere (Dashboard, Shopping) |
| PANTRY-7 | Resize to 375px, 768px, 1280px widths | Table↔card breakpoint switches cleanly, no horizontal overflow (this was explicitly verified for TASK-057 — regression-check it, don't assume it still holds) |
| PANTRY-8 | Verify `.btn-primary` styling on "Scan Receipt" and "+ Add Item" buttons | Both render as identical solid dark-green pills — this was a TASK-057 fix (`PantryPage.jsx`), confirm it didn't regress |

---

## 6. Recipes

Photo-upload camera/review-modal flow (file picker, iOS PWA camera, HEIC handling, abort-on-close, image
resize, timeout handling) was already exhaustively covered in
[TASK-024-smoke-tests.md](TASK-024-smoke-tests.md) — re-run only if recipe upload code changed since then.
This section covers what TASK-024 didn't, plus TASK-057 visual regression on Recipes.

| # | Step | Expected |
|---|------|----------|
| REC-1 | Import a recipe via `RecipeUrlImport` (paste a real recipe URL) | Recipe extracted and added, fields populated correctly |
| REC-2 | Open an existing recipe in `RecipeModal` (view mode) | Renders correctly, matches TASK-057 styling (source badges with correct icons/colors) |
| REC-3 | Edit and save a recipe | Changes persist |
| REC-4 | Favorite / unfavorite a recipe | State toggles and persists on reload |
| REC-5 | Delete a recipe (delete-confirm state) | Confirm dialog uses the solid-red delete-confirm state (accepted as raw-red, no token — not a bug); recipe removed |
| REC-6 | Search/filter recipes | Filtering works, no stale results after typing |
| REC-7 | Trigger `BlockedRecipesModal` (if reachable — e.g. a recipe flagged/blocked) | Renders without error if this path is reachable in current data |
| REC-8 | Check `AddRecipeMenu` | All entry points (upload, URL import, manual) are reachable and visually consistent |

---

## 7. Shopping

| # | Step | Expected |
|---|------|----------|
| SHOP-1 | Build a shopping list from pantry gaps via `BuildListModal` | List generated correctly from low/missing pantry items |
| SHOP-2 | Build/add to a list from a recipe's ingredients via `AddRecipesModal` / `RecipeSelectList` | Ingredients added, duplicates handled sensibly (not literal duplicate lines for the same item) |
| SHOP-3 | Manually add an item via `AddToListModal` (`ZZSMOKE-ShopItem`) | Appears in list immediately |
| SHOP-4 | Check off an item | Visual state updates (strikethrough/checked), persists on reload |
| SHOP-5 | Review `ShoppingResultSummary` after a build/add action | Summary accurately reflects what was added |
| SHOP-6 | Delete the `ZZSMOKE-ShopItem` and any other smoke-test items | List returns to pre-test state |
| SHOP-7 | Visual regression: this page was verified only by code review during TASK-057 (not live-clicked) — confirm live now | `.btn-primary`, `.card`, `.input`, `text-primary` all render correctly, no raw-orange |

---

## 8. Chat / AI Assistant

| # | Step | Expected |
|---|------|----------|
| CHAT-1 | Send a freeform kitchen question | Response streams/returns correctly, no truncation mid-sentence unless context-cap applies (TASK-054) |
| CHAT-2 | Check message bubble styling | `.chat-bubble-user` / assistant bubbles render per TASK-057 tokens (10.24:1 contrast verified previously — spot check it still looks right) |
| CHAT-3 | Trigger a `healthNote` (ask something touching a dietary/health concern, if the feature surfaces one) | Renders in blue (accepted raw-hue gap, not a bug) |
| CHAT-4 | Reload mid-conversation | History persists (or intentionally resets — confirm which is expected behavior, not a guess) |
| CHAT-5 | Send a very long conversation (many turns) | Context-size cap (TASK-054) behaves gracefully — no crash, no silent data loss the user isn't told about |

---

## 9. Dietary Profile / Settings

`DietaryProfileForm.jsx` was migrated to the new design system as a TASK-057 follow-up (judgment call #2)
— this is the highest-risk area for a fresh visual regression since it was the most recently touched file.

| # | Step | Expected |
|---|------|----------|
| DIET-1 | Open dietary profile settings | Form renders, existing profile data loads correctly |
| DIET-2 | Add an allergy tag | Renders as `.chip-allergy`, text clearly legible against its background, not washed out (previously verified at ≈8.93:1 by computed-CSS measurement during TASK-057 — this pass is a human legibility check, not a re-measurement) |
| DIET-3 | Add a non-allergy dietary tag | Renders as `.badge-tag`, clearly legible (previously measured ≈11.34:1) |
| DIET-4 | Remove a tag | Chip removes cleanly, no leftover empty space or layout jump |
| DIET-5 | Click into the tag-input field | Focus ring appears correctly (hand-written `focus-within` classes per TASK-057 — the shared `.input` class deliberately wasn't reused here; confirm the ring still shows) |
| DIET-6 | Save | Solid `.btn-primary` pill button, save persists on reload |

---

## 10. Push Notifications

| # | Step | Expected |
|---|------|----------|
| PUSH-1 | Trigger conditions for `PushNotificationBanner` to appear (varies by browser support/permission state) | Banner renders correctly, doesn't block other UI |
| PUSH-2 | Opt in | Permission prompt behaves correctly (or a graceful message if the browser/device doesn't support push) |
| PUSH-3 | Opt out / dismiss | Banner doesn't reappear inappropriately on next load |

---

## 11. Admin / Platform Settings (API-level — no dedicated UI page exists)

Relevant per memory: `publicAiAccessEnabled` is live in production as of 2026-07-30, OpenAI billing
confirmation still open — this isn't just a routine check, verify it deliberately.

| # | Step | Expected |
|---|------|----------|
| ADMIN-1 | As the owner account (`OWNER_CLERK_ID`), `GET /api/admin/platform-settings` | Returns current settings, 200 |
| ADMIN-2 | As a non-owner account, `GET /api/admin/platform-settings` | 403, not a crash or data leak |
| ADMIN-3 | Confirm `publicAiAccessEnabled` and `aiRateLimitMax` current values are intentional for what's about to ship to production | Flag to Connor if either looks unintended — this gate gets more consequential the moment `staging` merges to `main` |

---

## 12. Authorization Boundary Smoke Checks

TASK-055 hardened several API-layer boundaries (household-scoped `WHERE` clauses on pantry/recipe
mutations to close a TOCTOU gap, `inviteRateLimit`, `pushRateLimit`, push-subscription ownership rules,
`admin` owner-gate). These are exactly the kind of regression a UI-only smoke pass misses — a broken
`householdId` check can still render a normal-looking success screen. This section is deliberately
lightweight (Verification Agent tier, not deep pentesting) — it re-confirms known-hardened boundaries
still hold, not a full security audit.

| # | Step | Expected |
|---|------|----------|
| SEC-1 | Call a pantry mutation endpoint (e.g. `PATCH /api/pantry/:id`) with no auth token / an expired session | 401, not a crash or partial write |
| SEC-2 | As Account A, note a pantry item ID or recipe ID. As Account B (different household), attempt to update or delete that ID directly against the API | `{status:'forbidden'}` / equivalent — not silently successful, not a 500. This is the specific TOCTOU class TASK-055 fixed (`pantryService.js`/`recipeService.js` `update`/`remove`/`markUsed`/`toggleFreeze`/`toggleFavorite`) — confirm it still holds. |
| SEC-3 | Submit 11 household invites within an hour from the same account | 11th request is rejected (`inviteRateLimit`, 10/hour per user) |
| SEC-4 | Submit push subscribe/unsubscribe rapidly (>20 in 15 min) from the same account | Requests beyond the limit are rejected (`pushRateLimit`) |
| SEC-5 | Call `GET /api/push/cron` with no `Authorization` header and no `?secret=` query param | 401 — cron endpoint requires `CRON_SECRET` |
| SEC-6 | Attempt `GET /api/admin/platform-settings` as a non-owner account | 403 — already covered by ADMIN-2, listed here for completeness only, don't re-run |

---

## 13. Visual & Responsive Regression (TASK-057 focus)

| # | Step | Expected |
|---|------|----------|
| VIS-1 | `grep -rn "orange-" client/src` scoped to all TASK-057-touched files | Zero matches (already verified once — regression-check, don't re-trust it blindly after any further edits) |
| VIS-2 | Visit every page (Landing, Dashboard, Pantry, Recipes, Shopping, Household, Chat) at 375px, 768px, 1280px | No horizontal overflow, no broken layouts anywhere — Pantry/Shopping were the only ones explicitly breakpoint-tested before |
| VIS-3 | Spot-check `.badge-status-critical`, `.badge-status-warning`, `.badge-status-ok`, `.btn-primary` | Text remains clearly legible against its background on every page they appear, not just the pages already verified — a visual "can I read this comfortably" check, not a numeric re-measurement (the numeric contrast values belong to TASK-057's implementation-time verification, not this pass) |
| VIS-4 | Confirm the 5 remaining CRUD modals (`AddItemModal`, `SplitItemModal`, `BuildListModal`, `AddToListModal`, `AddRecipesModal`) still render in the **old** raw-orange style | This is TASK-057's accepted, documented gap (Section 11) — confirm it's still just visually inconsistent, not broken/crashing. Do not treat this as a bug to fix in this session. |
| VIS-5 | Cross-page nav (Sidebar) | Active-page highlighting, all links reachable, consistent across every page |

**Optional, not required for release**: if hardware/time permits, spot-check Chrome desktop, Safari
desktop, and iOS Safari/PWA specifically — this app leans on PWA-specific APIs (camera capture, push,
`MediaRecorder` for voice) that desktop Chrome-only testing won't exercise. Skip without blocking merge if
unavailable this session; note the gap in Results instead.

---

## 14. Error Handling & Edge Cases

| # | Step | Expected |
|---|------|----------|
| ERR-1 | Throttle network (Slow 3G) and perform a normal action (e.g. add pantry item) | Clear loading state, eventual success or a clear error — no silent hang |
| ERR-2 | Submit a form with invalid input (e.g. empty required field) | Client-side validation catches it, or server returns a clear 4xx the UI surfaces as a message — no raw stack trace shown to the user |
| ERR-3 | Trigger a 404 (visit a nonsense route) | App shows a reasonable not-found state, not a blank screen or crash |
| ERR-4 | Let a session expire (or simulate via clearing Clerk session) mid-use, then perform an action | Redirected to sign-in gracefully, no infinite spinner or unhandled promise rejection in console |
| ERR-5 | Rapid double-submit on a save button anywhere (Recipes save was explicitly guarded before — spot-check others) | No duplicate records created |

---

## 15. Cleanup

Before ending the session:

1. Delete every `ZZSMOKE-`-prefixed record created above (pantry items, shopping items, recipes, household
   rename reverted or left clearly marked if household itself is disposable).
2. Remove the second test account from the household (or delete it) if AUTH/HH tests created one.
3. Re-verify affected lists/counts are back to pre-test baseline — don't assume a delete click succeeded
   without checking.
4. Confirm no diagnostic/instrumentation code was left in the codebase (`git status` / `git diff` clean
   relative to what was intentionally changed, if any fix was made during testing).

---

## Results

**Status legend** — a smoke test surfaces real defects that aren't automatically release blockers; a
binary pass/fail forces premature judgment calls into the middle of testing. Use:

| Status | Meaning |
|--------|---------|
| ✅ Pass | Expected behavior confirmed |
| ❌ Fail | Release blocker unless explicitly waived by Connor |
| ⚠️ Issue | Real defect found, but blocking-ness needs judgment (e.g. a graceful-degradation message reads awkwardly; a platform limitation, not an app bug) |
| ⚪ N/A | Not executable this session (missing hardware/env) or genuinely not applicable |

| Area | Test | Status | Notes |
|------|------|--------|-------|
| Pre-flight | PF-1 – PF-3 | ⬜ | |
| Auth | AUTH-1 – AUTH-5 | ⬜ | |
| Onboarding | ONB-1 – ONB-4 | ⬜ | |
| Household | HH-1 – HH-5 | ⬜ | |
| Dashboard | DASH-1 – DASH-5 | ⬜ | |
| Pantry | PANTRY-1 – PANTRY-8 | ⬜ | |
| Recipes | REC-1 – REC-8 | ⬜ | |
| Shopping | SHOP-1 – SHOP-7 | ⬜ | |
| Chat | CHAT-1 – CHAT-5 | ⬜ | |
| Dietary Profile | DIET-1 – DIET-6 | ⬜ | |
| Push | PUSH-1 – PUSH-3 | ⬜ | |
| Admin | ADMIN-1 – ADMIN-3 | ⬜ | |
| Authorization Boundaries | SEC-1 – SEC-6 | ⬜ | |
| Visual/Responsive | VIS-1 – VIS-5 | ⬜ | |
| Error Handling | ERR-1 – ERR-5 | ⬜ | |
| Cleanup | — | ⬜ | |

(Fill in per the legend above as testing proceeds — mirror the granularity used in
[TASK-024-smoke-tests.md](TASK-024-smoke-tests.md) if a whole area needs individual sub-row tracking.)

---

## Production Merge Decision

This is a release gate, not just a checklist — state the decision explicitly at the end of the session.

**Proceed with `staging` → `main` merge only if:**
- No ❌ Fail rows remain (or each has an explicit, written waiver from Connor).
- No unresolved auth, data-isolation, or data-loss issue (any ❌/⚠️ in §12 Authorization Boundaries gets
  priority triage — these regress silently and are the hardest class to notice after the fact).
- The *only* visual inconsistencies found are the named Known Accepted Gaps below — anything else
  orange/inconsistent is a new regression, not pre-approved debt.
- `npm run build`, `npm run lint`, `npm test` are all green on `staging` immediately before merge.
- Cleanup (§15) fully executed — no leftover `ZZSMOKE-` data, no diagnostic code in the diff.

**Do not merge — and if already merged, roll back immediately — if any of these show up:**
- Sign-in/sign-up broken (AUTH-1–AUTH-3).
- Household data isolation broken (SEC-2) — one household able to read or mutate another's data.
- Core pantry mutations failing outright (add/edit/delete all broken, not just one edge case).
- A production API error rate spike immediately after deploy (check Vercel logs post-merge, not just
  pre-merge staging results — a staging pass doesn't guarantee identical production env vars/config).
- A database migration mismatch is detected (see CONVENTIONS.md's canonical migration order — confirm
  production's Neon branch has every migration `staging` assumes, *before* merging code that depends on
  them).

## Pass Criteria

All rows pass or are explicitly ⚪ N/A with a documented reason, and the Production Merge Decision above
resolves to "proceed."

## Known Accepted Gaps (not failures)

- 5 CRUD modals still raw-orange styled (TASK-057 Section 11, deliberately deferred to TASK-060).
- "❄ Frozen" tag, `StatusLabel` Frozen/Ripening text, Chat `healthNote`, recording-dot red, delete-confirm
  red — all intentionally raw-hue per TASK-057 (no token defined yet).
- iOS-hardware-gated recipe-upload tests (S2, S6, S7 in TASK-024) require a physical device and are out of
  scope here unless one is available this session.
