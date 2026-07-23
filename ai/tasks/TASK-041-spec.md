# TASK-041 — Tour Expansion, Household-Page Replay, Mobile Layout Fixes, Chat Capabilities Info, Dead-Code Sweep

Version: DRAFT-3 (post-architect review, round 2) — **APPROVED FOR IMPLEMENTATION**

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-2 | 9.8/10 — approve after two small polish items | **Adopted (both required, both spec-polish rather than architectural)**: (1) `waitForElement()`'s timeout now has a defined failure path: on timeout, the tour calls `driver.destroy()` rather than leaving a partially-active overlay — reusing the exact same early-exit path already established for the Back-button case (DRAFT-2) and, before that, for every other way a tour can end (TASK-040's original `onDestroyed`-is-truth rule). No new state, just closing a previously-unspecified gap. (2) `onSaveHouseholdName`/`onAddItems` are now explicitly documented as promise-returning interfaces — both real (`OnboardingGate`) and no-op (`OnboardingPreview`) implementations must return a `Promise`, so `await`-ing callers can't silently pick up different timing behavior depending on which one is wired in. **Also adopted (readability, non-blocking per the review)**: `waitForElement` is now specified as a standalone named utility near the top of `productTour.js`, called with `await` from `advanceTo`, rather than described as logic embedded inline. **Confirmed, no changes needed**: the review's "Things I Would Not Change" list (page-level `useEffect` hooks, a formal tour state machine, broadening into `PageLayout`, revisiting mobile rotation) matches DRAFT-2's own "Not adopted" reasoning exactly — no further action. |
| DRAFT-1 | 9.2/10 — approve after revision on Parts A/B | **Adopted**: (1) Part B split into a new `OnboardingPreview` component instead of an `OnboardingGate` mode flag — `OnboardingGate`'s contract stays "is real onboarding pending," full stop; preview is a sibling that reuses the same building blocks. (2) Preview no-ops are now injected via new callback props (`onSaveHouseholdName` on `WelcomeStep`, `onAddItems` on `StaplesChecklist`) rather than an internal `previewMode` boolean branching inside those components — matches how they already take `onComplete`/`onContinue`/`onDismiss` as props rather than knowing their own context. (3) Part A's per-step `onNextClick` handlers collapsed into one shared advance function reused by every step, rather than 12 separately authored handlers. (4) Part A's wait-for-element step swapped from a raw `requestAnimationFrame` polling loop to a `MutationObserver` (bounded by the same kind of timeout already used elsewhere in this file) — more precise, and cancellable the same way this codebase already cancels in-flight work elsewhere (`abortRef` pattern in `RecipeUpload.jsx`/`RecipeUrlImport.jsx`). (5) Added an explicit browser-Back-during-tour decision: reuses the *existing* "any `onDestroyed` means the tour step is over" rule from TASK-040 rather than inventing new state — a Back navigation that diverges from the tour's own expected route just triggers `driver.destroy()`, which was already the single source of truth for "tour is done" (no new special case needed). (6) Part C's `pl-12` is now cross-referenced with a paired code comment in `Sidebar.jsx` instead of being a silent magic number. (7) Part E's copy generalized instead of a literal 1:1 mirror of `PANTRY_TOOLS`' names, so it doesn't need editing every time a tool is added/removed. (8) Elevated the household-rename-during-preview check from Known Risks into an explicit Verification step. (9) Added verification for tour cancellation mid-navigation-wait and page refresh during preview. **Not adopted**: (a) The review's literal proposal for Part A — a global "pending step" coordinator with target pages (`RecipesPage.jsx`, `PantryPage.jsx`) announcing readiness via their own `useEffect` — was not adopted. That would require every page with a tour target to become tour-aware, which is the exact coupling `OnboardingGate` already exists to avoid (TASK-040 mounted it at `AppLayout`, not per-page, specifically so pages stay onboarding-ignorant). Checked directly against this app's actual pages (something the review couldn't do without file access): every tour-target button in `RecipesPage.jsx`/`PantryPage.jsx` renders synchronously on route mount — none sit behind `Suspense`, lazy-loading, or a data fetch — so the theoretical async-rendering failure modes the review raised (the actual justification for the coordinator) don't apply to this app's real component tree. The `MutationObserver` swap (above) addresses the same underlying concern — "don't assume the DOM update lands within N animation frames" — without the page-level coupling. (b) A formal tour "state machine" (`TourStep` with `beforeEnter`/`afterEnter` hooks) — the review itself called this non-mandatory, and it doesn't fit this codebase's repeated, explicit preference against introducing new abstractions at this scale (TASK-040 declined comparable extractions twice, at similar line counts). The one real complaint underneath it — hand-written per-step handlers — is fixed directly (see (3) above) without adopting a pattern used nowhere else in this app. (c) Re-testing mobile orientation changes mid-tour — already raised and explicitly declined in TASK-040 ("unsupported ... not worth engineering around," that spec's own architect review round 3). Part A doesn't change that reasoning, so it isn't being re-litigated here. (d) The review's broader `PageLayout` (breadcrumbs, loading states, etc.) suggestion — the review itself flagged this as "not for this task," so no action taken now. |

---

## Origin

Raised by the user in conversation, as a follow-up to TASK-040 (onboarding: Welcome step + household naming,
6-step guided tour, staples checklist — implemented and deployed to production). Six requests bundled into
one spec:

1. Extend the guided product tour to cover page-level action buttons (recipe upload, receipt scan, etc.),
   not just the sidebar nav.
2. Let a user replay the onboarding tour from the Household page — previewing both the `new_household` and
   `joined` flows — without creating new accounts, purely for testing.
3. Fix the mobile hamburger menu overlapping page titles (screenshot supplied).
4. Fix the redundant native iOS action sheet stacking on top of the app's own "Take Photo / Choose from
   Library" upload modal (screenshot supplied).
5. Add an info icon on the Chat page explaining what the AI assistant can actually do.
6. Sweep the project for redundant/dead code — closing out the `/login` redirect bug flagged and spun off
   as `task_8893cd9f` during the TASK-040 session.

## Current State (confirmed by reading the code, not assumed)

### 1. Tour is sidebar-only

`productTour.js`'s `NAV_STEPS` ([productTour.js:4-11](client/src/components/onboarding/productTour.js:4))
targets only the six `data-tour="nav-*"` attributes on `Sidebar.jsx`'s `NavLink`s
([Sidebar.jsx:38,48,58,76,86,97](client/src/components/layout/Sidebar.jsx:38)). The tour never navigates —
driver.js only knows about elements already mounted on the current page — so it can never reach the
scan-receipt/scan-barcode/add-item buttons on `/pantry` ([PantryPage.jsx:131-148](client/src/pages/PantryPage.jsx:131))
or the upload-image/import-url/find-online buttons on `/recipes`
([RecipesPage.jsx:299-348](client/src/pages/RecipesPage.jsx:299)). Confirmed while designing Part A: none of
these six target buttons sit behind `Suspense`, lazy-loading, or a data fetch on either page — both pages
render their full header/button row synchronously as part of the route's initial render, independent of
their `loading` state for the rest of the page.

### 2. Tour is one-time only by design; Household page has no onboarding UI

TASK-040's own Decisions explicitly scoped re-triggering to "one-time only for v1." `OnboardingGate.jsx`
only renders while `!onboarding.complete` ([OnboardingGate.jsx:15](client/src/components/onboarding/OnboardingGate.jsx:15));
once `user_onboarding.complete = true` server-side, nothing in the client can show Welcome/Tour/Checklist
again short of a manual DB edit. `HouseholdPage.jsx` has no onboarding-related section today. `AppLayout.jsx`
owns `mobileNavOpen`/`setMobileNavOpen` state ([AppLayout.jsx:8](client/src/components/layout/AppLayout.jsx:8))
and passes it only to `Sidebar` and `OnboardingGate` — not down through `<Outlet />` to page components —
relevant to Part B, which needs a page (`HouseholdPage`) to reach it.

### 3. Hamburger button overlaps page titles on mobile

`Sidebar.jsx:129-134` renders the hamburger as `fixed top-3 left-3 z-50 md:hidden` — pinned at the mobile
viewport's top-left corner (roughly a 12–48px × 12–48px footprint), independent of page content flow. Every
page's `<h1>` starts at its container's own padding (16–24px), directly underneath: `PantryPage.jsx:124-125`,
`RecipesPage.jsx:291-293`, `ShoppingPage.jsx:50-52`, `DashboardPage.jsx:7-9`, `ChatPage.jsx:164-165`,
`HouseholdPage.jsx:189-190` — six pages, same problem, matching the supplied screenshot.

### 4. Redundant iOS camera action sheet

`RecipeUpload.jsx:279-319` and `ReceiptUpload.jsx:191-231` already do the conceptually right thing for
mobile — two explicit buttons ("Take Photo" / "Choose from Library"), each wired to its own hidden
`<input type="file">` (one with `capture="environment"`), triggered via `ref.current?.click()` inside the
button's `onClick`. Per current WebKit behavior (confirmed via web research below), iOS Safari treats a
hidden file input clicked programmatically through a JS ref — rather than a real, directly-tapped element,
or a `<label for>` pointing at it — as insufficiently user-initiated, and falls back to its own full action
sheet (Photo Library / Take Photo / Choose File) on top of whatever UI called it. That's exactly what the
screenshot shows: the app's own two-button choice still visible behind the native sheet.

### 5. Chat page has no capability explainer

`ChatPage.jsx:164-169`'s header is a static title/subtitle with no info affordance. The assistant's actual
tool surface is defined server-side in `PANTRY_TOOLS`
([aiService.js:34-256](server/services/aiService.js:34)): `add_pantry_item`, `update_pantry_item`,
`remove_pantry_item`, `consume_pantry_item`, `suggest_recipes`, `save_recipe` — plus dietary/allergy handling
in the system prompt ([aiService.js:687-733](server/services/aiService.js:687)). Receipt scanning,
recipe-image OCR, and URL import are separate UI flows elsewhere in the app — the chat assistant cannot
invoke them, so any info copy must not imply it can.

### 6. Confirmed dead/broken code (closes `task_8893cd9f`)

- `RecipeUpload.jsx:180`, `ReceiptUpload.jsx:45`, `RecipeUrlImport.jsx:37` each hardcode
  `window.location.href = '/login'` on a 401 — a route that doesn't exist post-Clerk-migration (Clerk mounts
  at `/sign-in`/`/sign-up`, [App.jsx:42-48](client/src/App.jsx:42)). The correct pattern already exists and
  is used everywhere else: `client/src/api/index.js:26-29`'s `request()` redirects to `/sign-in`, guarded
  against a redirect loop with `!window.location.pathname.startsWith('/sign-in')`. These three files can't
  use `api.*` (raw `fetch`+`FormData` needed for file uploads) but should replicate that same guarded
  redirect, not the current broken one.
- `client/src/components/layout/ProtectedRoute.jsx` is dead code — zero importers (`App.jsx` uses its own
  inline `PrivateRoute` wrapping Clerk's `SignedIn`/`SignedOut`/`RedirectToSignIn` instead,
  [App.jsx:21-30](client/src/App.jsx:21)) — and has the same `/login` bug internally
  ([ProtectedRoute.jsx:10](client/src/components/layout/ProtectedRoute.jsx:10)), moot only because the file
  is never rendered.

---

## Web Research Findings

- **iOS file-input action sheet**: multiple sources agree the reliable fix is a `<label htmlFor="...">`
  pointing at a real (off-screen-but-not-`display:none`) `<input>`, with no JS-mediated `.click()` in the
  path at all — "no JavaScript...which iOS likes." Devnote.in's writeup on this exact bug was the clearest
  source; general guidance elsewhere (Apple Developer Forums threads) is consistent but less specific.
- **Cross-route driver.js tours**: driver.js (installed: `^1.8.0`) has no built-in feature for this — the one
  concrete public example found (driver.js GitHub issue #457) is a DIY `localStorage`-plus-polling approach,
  not a library API. Confirms this is genuinely bespoke wiring for Part A, not something we're missing.

---

## Design

### Part A — Extend the guided tour to page-level action buttons (full 12-step interleaved tour)

**New `data-tour` targets:**
- `PantryPage.jsx`: `data-tour="scan-receipt"` ([:132](client/src/pages/PantryPage.jsx:132)),
  `data-tour="scan-barcode"` ([:138](client/src/pages/PantryPage.jsx:138)),
  `data-tour="add-item"` ([:144](client/src/pages/PantryPage.jsx:144)).
- `RecipesPage.jsx`: `data-tour="upload-recipe-image"` ([:306](client/src/pages/RecipesPage.jsx:306)),
  `data-tour="import-recipe-url"` ([:312](client/src/pages/RecipesPage.jsx:312)),
  `data-tour="find-recipes-online"` ([:318](client/src/pages/RecipesPage.jsx:318)).

**Step order** — interleaved: visit each page once, cover its nav item and its own buttons together, then
move on (12 steps total, up from 6):

```js
const STEPS = [
  { element: '[data-tour="nav-chat"]', route: '/' },
  { element: '[data-tour="nav-dashboard"]', route: '/dashboard' },
  { element: '[data-tour="nav-pantry"]', route: '/pantry' },
  { element: '[data-tour="scan-receipt"]', route: '/pantry' },
  { element: '[data-tour="scan-barcode"]', route: '/pantry' },
  { element: '[data-tour="add-item"]', route: '/pantry' },
  { element: '[data-tour="nav-recipes"]', route: '/recipes' },
  { element: '[data-tour="upload-recipe-image"]', route: '/recipes' },
  { element: '[data-tour="import-recipe-url"]', route: '/recipes' },
  { element: '[data-tour="find-recipes-online"]', route: '/recipes' },
  { element: '[data-tour="nav-shopping"]', route: '/shopping' },
  { element: '[data-tour="nav-household"]', route: '/household' },
];
```

**Cross-route advancement — one shared handler, not 12.** A single `advanceTo(driverObj, targetIndex)`
function is wired once (as the tour's step-transition hook — exact wiring against driver.js `^1.8.0`'s API,
whether a driver-level default or a thin per-step wrapper generated from this one function in a loop, is an
implementation detail; the point is there is exactly one implementation of "how do I get to the next step,"
not twelve):

```js
async function advanceTo(driverObj, targetIndex) {
  const target = STEPS[targetIndex];
  if (target.route !== window.location.pathname) navigate(target.route);
  const found = await waitForElement(target.element, { timeoutMs: 2000 });
  if (!found) {
    driverObj.destroy(); // see waitForElement's failure path, below
    return;
  }
  driverObj.moveTo(targetIndex);
}
```

`waitForElement(selector, { timeoutMs })` is a small standalone utility near the top of `productTour.js`
(not logic embedded inline in `advanceTo`) — it returns a `Promise<boolean>`, resolving `true` the instant a
`MutationObserver` on `document.body` sees the target selector match (more precise than a
`requestAnimationFrame` poll — it resolves on the actual DOM-insertion event rather than sampling
frame-by-frame), or `false` if `timeoutMs` elapses first. Both the observer and the timeout are
disconnected/cleared as soon as either resolves — and, symmetrically, on tour cancellation, so nothing
resolves after the tour has already been destroyed. This mirrors the `abortRef`-on-close pattern already used
in `RecipeUpload.jsx`/`RecipeUrlImport.jsx` for the same category of problem (don't let in-flight async work
outlive the thing that started it), rather than introducing a new cancellation idiom.

**Timeout failure path.** A `waitForElement` timeout means a selector typo, a route bug, or the target
element unexpectedly not rendering — a real bug, not a transient condition worth retrying. `advanceTo` treats
it exactly like any other tour-ending event: call `driver.destroy()` rather than leaving a partially-active
overlay stuck mid-navigation. This is the same `onDestroyed`-is-truth path every other exit already goes
through (natural completion, `Escape`, overlay click, close button, and — per the Back-button handling below
— a route that diverges from the tour's own expectations), so no new state or special-cased recovery UI is
needed; the tour just ends, same as if the user had closed it.

`runProductTour` gains a `navigate` parameter (React Router's `useNavigate()`, obtained in
`OnboardingGate.jsx`/`OnboardingPreview.jsx` — both already render under `<AuthProvider>`/`<BrowserRouter>`,
so the hook is free to call there) alongside the existing `setMobileNavOpen`.

**Mobile sidebar handling.** With page-button steps now interleaved, the sidebar must close before a
page-button step (so it doesn't cover the button being highlighted) and reopen before the next nav step —
extend the existing open/close calls (`productTour.js:32,39`) to fire on every step transition based on
whether the step's `element` matches `[data-tour^="nav-"]`, not just once at tour start/end.

**Browser Back button mid-tour.** A physical/native Back press bypasses driver.js's Next button entirely and
changes the route out from under the tour. No new state machine is needed for this: TASK-040 already
established that `onDestroyed` firing — however the tour ends — is the single source of truth for "the tour
step is over" ([OnboardingGate.jsx:31](client/src/components/onboarding/OnboardingGate.jsx:31), comment).
Reused directly: if the current route ever diverges from the active step's expected `route` (checked on
driver.js's highlight-start hook), call `driverObj.destroy()` — the existing `onDestroyed` → `onFinished`
wiring then handles it exactly like any other early exit (closes the mobile sidebar if open, advances
onboarding past the tour step). No Back-specific branch anywhere.

### Part B — Replay the onboarding tour from Household page (separate `OnboardingPreview` component)

**New section in `HouseholdPage.jsx`**, below the members list: "Preview onboarding" with two buttons —
"Preview: new household" and "Preview: joined household" — visible to any member (matches this app's
fully-shared household model, same reasoning TASK-040 already established for who may rename the household).

**`OnboardingGate` stays exactly what it already is** — "is real onboarding pending" — and is not touched
beyond the refactor described below. Instead, a new sibling component owns the preview:

**New file** `client/src/components/onboarding/OnboardingPreview.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WelcomeStep from './WelcomeStep.jsx';
import StaplesChecklist from './StaplesChecklist.jsx';
import { runProductTour } from './productTour.js';

const NOOP = async () => {};

export default function OnboardingPreview({ flow, onClose, setMobileNavOpen }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('welcome');

  function startTour() {
    setStep('tour');
    runProductTour(
      () => (flow === 'new_household' ? setStep('checklist') : onClose()),
      { setMobileNavOpen, navigate }
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeStep
        flow={flow}
        onContinue={startTour}
        onDismiss={onClose}
        onSaveHouseholdName={NOOP}
      />
    );
  }
  if (step === 'checklist') {
    return (
      <StaplesChecklist onComplete={onClose} onDismiss={onClose} onAddItems={NOOP} />
    );
  }
  return null;
}
```

Both `OnboardingGate` and `OnboardingPreview` call the exact same `runProductTour()` — the only difference
between real onboarding and a preview is which flow drives it and which callbacks the child steps are given,
never a second tour implementation.

**Callback injection, not a `previewMode` flag, in the child components** — keeps `WelcomeStep`/
`StaplesChecklist` presentational and consistent with how they already take `onComplete`/`onContinue`/
`onDismiss` as props rather than branching on their own context:

- `WelcomeStep.jsx` gains a new required prop `onSaveHouseholdName(trimmedName)` (async). Its existing inline
  `await api.patch('/api/household', { name: trimmed })`
  ([WelcomeStep.jsx](client/src/components/onboarding/WelcomeStep.jsx)) is replaced with
  `await onSaveHouseholdName(trimmed)`. `OnboardingGate` supplies a wrapper that does the real `PATCH`;
  `OnboardingPreview` supplies `NOOP`.
- `StaplesChecklist.jsx` gains a new required prop `onAddItems(items)` (async). Its existing inline
  `await api.post('/api/pantry/bulk', { items })` ([StaplesChecklist.jsx:68](client/src/components/onboarding/StaplesChecklist.jsx:68))
  is replaced with `await onAddItems(items)`. `OnboardingGate` supplies a wrapper that does the real `POST`;
  `OnboardingPreview` supplies `NOOP`. `onComplete` already exists as a prop on this component and needs no
  change — `OnboardingPreview` just passes `onClose` instead of the real `completeOnboarding` wrapper.
- `OnboardingGate.jsx` itself only changes to supply these two new callbacks (thin wrappers around the API
  calls it effectively already made inline via its children) — a refactor, not new behavior.

**Contract: both injected callbacks must return a `Promise`.** `onSaveHouseholdName` and `onAddItems` are
`await`-ed by their callers (`WelcomeStep`/`StaplesChecklist`), which drives real UI behavior around them
(`submitting` state, `disabled` buttons, try/catch error handling) — so the real and no-op implementations
must have identical calling semantics, not just the same return value. `const NOOP = async () => {};` (not a
plain synchronous `() => {}`) is required specifically so that a future edit to the preview path can't
silently change the `await` timing its callers depend on.

**Threading `setMobileNavOpen` to `HouseholdPage`.** `AppLayout` owns this state today and only passes it to
`Sidebar`/`OnboardingGate`, not through `<Outlet />`. Use React Router's `useOutletContext()` — the
idiomatic mechanism for exactly this (pass data to a nested route's element without prop-drilling through
every intermediate route) — via `<Outlet context={{ setMobileNavOpen }} />` in `AppLayout.jsx`.

**No server-side changes needed for this part** — confirmed no real API call fires from any exit point of
`OnboardingPreview` or its children.

### Part C — Mobile header/title offset (shared `PageHeader` component)

New file `client/src/components/layout/PageHeader.jsx`:

```jsx
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-center justify-between flex-wrap gap-3 pl-12 md:pl-0 ${className}`}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
```

`pl-12` (48px) clears the hamburger's 12px offset + ~36px width; `md:pl-0` removes it once the hamburger is
`md:hidden` too. Applied to the title/subtitle block only (not the whole row), so right-aligned action
buttons are unaffected. This is a static, rarely-changing button — not worth a runtime-measured/derived
layout — but to stop it from silently drifting out of sync, add a one-line paired comment in each file:
`PageHeader.jsx` notes `pl-12 clears Sidebar.jsx's mobile hamburger (top-3 left-3, ~36px)`, and
`Sidebar.jsx:129`'s hamburger button gets a matching comment pointing back at `PageHeader.jsx`'s `pl-12`.

Adopted in: `PantryPage.jsx:122-150`, `RecipesPage.jsx:288-350`, `ShoppingPage.jsx:47-63`,
`DashboardPage.jsx:6-13`, `HouseholdPage.jsx:189-190` (no `actions`, no `subtitle` — just `title`).
`ChatPage.jsx:163-169`'s header has different surrounding chrome (fixed bar, `border-b`, `bg-white`, and —
per Part E — will also carry the new info icon) — it keeps its own outer container but uses `PageHeader`
internally for the title/subtitle/actions row, with `actions` holding the new info icon button.

### Part D — Fix redundant iOS action sheet

Convert the hidden-input-plus-ref-click pattern to label-based triggering in both `RecipeUpload.jsx` and
`ReceiptUpload.jsx`:

```jsx
<input
  id="recipe-upload-camera-input"
  type="file"
  accept="image/*"
  capture="environment"
  onChange={handleFileChange}
  className="sr-only"
/>
<label
  htmlFor="recipe-upload-camera-input"
  className="flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors text-center cursor-pointer"
>
  📷 Take Photo
</label>
```

(mirrored for the library input/button in both files, with distinct `id`s per file:
`recipe-upload-camera-input`/`recipe-upload-library-input` in `RecipeUpload.jsx`,
`receipt-upload-camera-input`/`receipt-upload-library-input` in `ReceiptUpload.jsx`). `hidden` is replaced
with `sr-only` (off-screen, not `display:none`) since sources disagree on whether visibility or the
JS-mediated click is the actual trigger for the bad fallback — cheap to do both. `cameraInputRef`/
`libraryInputRef` and their button `onClick` handlers are removed; `handleFileChange` is unchanged.

### Part E — Chat page capability info icon

Small ⓘ button in `ChatPage.jsx`'s header (via `PageHeader`'s new `actions` slot, Part C), opening a
lightweight modal (reusing the existing `fixed inset-0 z-50 ... bg-black/40` pattern used throughout, e.g.
`RecipeUpload.jsx:219-227`) describing what the assistant can actually do — grounded in `PANTRY_TOOLS`
([aiService.js:34-256](server/services/aiService.js:34)) and the system prompt's dietary/allergy handling
([aiService.js:687-733](server/services/aiService.js:687)), written generally enough not to require an edit
every time a tool is added or removed, rather than a literal 1:1 list of today's six tool names:

> Ask Kitchen Keeper to add, update, or remove pantry items just by describing them in plain language, or to
> log what you've eaten or used up. Ask what to cook and it'll suggest recipes from what's already in your
> pantry — prioritizing what's expiring soon — and save any suggestion straight to your recipe book.
> Suggestions always account for your household's dietary profile and flag allergy conflicts.

(exact copy to be refined during implementation; the constraint is staying accurate to what the assistant can
actually invoke — receipt scanning, recipe-image OCR, and URL import live elsewhere in the app and are not
things the chat assistant itself can do).

### Part F — Dead-code sweep

- Fix the three raw-fetch 401 handlers (`RecipeUpload.jsx:180`, `ReceiptUpload.jsx:45`,
  `RecipeUrlImport.jsx:37`) to match `api/index.js`'s canonical pattern:
  `if (res.status === 401 && !window.location.pathname.startsWith('/sign-in')) { window.location.href = '/sign-in'; return; }`.
- Delete `client/src/components/layout/ProtectedRoute.jsx` outright. Before deleting, re-confirm zero
  importers (`grep -r ProtectedRoute client/src`) and run `npm run lint` afterward as a safety net — cheap
  insurance, not because there's any doubt today's grep result will change.
- Grep sweep for other orphaned files/dead exports during implementation, same bounded discipline TASK-040
  used for `LoginPage.jsx`/the `users` table — fix what's actually found, not an open-ended audit.
- Closes background task `task_8893cd9f` (already unable to formally withdraw the chip — it wasn't tracked
  across a restart — but this Part supersedes it regardless).

---

## Decisions (resolved by user, 2026-07-22)

1. **Tour scope — full 12-step interleaved tour** (Part A), covering both nav items and page-level action
   buttons in one continuous sequence, rather than staying at 6 steps or splitting into two separate tours.
2. **Household-page replay — side-effect-free preview** (Part B). No server-side reset endpoint; the preview
   never touches `user_onboarding`, never renames the household for real, and never inserts real pantry
   items, even if staples are "selected" during the previewed checklist.
3. **Header fix — extract a shared `PageHeader` component** (Part C), rather than patching six pages
   individually, since this is the second onboarding/layout task to touch the same six near-identical
   headers.

## Out of Scope

- Any change to `StaplesChecklist`'s actual staples list/categories.
- Re-triggering onboarding for *other* household members (Part B is a self-serve preview for whoever clicks
  it, not an admin "reset onboarding for user X" tool).
- General performance/bundle-size review of driver.js's now-longer step list.
- A formal tour state-machine abstraction, or a broader `PageLayout` (breadcrumbs/loading states/etc.) beyond
  today's `PageHeader` — both raised during review as reasonable future directions, neither adopted now (see
  Architect Review History).
- Any dead code found during the Part F sweep that's unrelated to the onboarding/login-redirect family (flag
  separately rather than silently expanding this task).

## Known Risks

- Part A's cross-route tour-continuation logic is genuinely bespoke (no driver.js API for it) — the
  highest-risk, most-novel part of this task. Worth prototyping early rather than last, since a failure mode
  here (tour gets stuck mid-navigation, or highlights the wrong element after a route change) is more
  disruptive to a first-run user than any other part of this spec.
- Part D's fix is based on published guidance and matches the user's own screenshot, but iOS camera-picker
  behavior has changed across iOS/Safari versions before and could again — needs an actual device check
  during verification, not just code review.
- Part C's `PageHeader` extraction touches six already-shipped pages at once — low risk individually (a
  simple prop-driven presentational component) but worth its own regression pass across all six, independent
  of the mobile-padding fix itself.
- The 12-step tour (Part A) is a real increase in first-run friction versus TASK-040's original 6 — accepted
  per the user's explicit choice above, but worth watching for drop-off if this app ever gets tour-completion
  analytics (currently out of scope, per TASK-040's own Out of Scope).
- Mobile orientation changes mid-tour remain unsupported, unchanged from TASK-040's own accepted risk — not
  re-verified here (see Architect Review History).

## Verification Steps

1. Full 12-step tour, desktop and mobile: confirm every step lands on the correct route before highlighting,
   sidebar opens/closes at the right transitions on mobile, and the tour completes (or is closed early) with
   exactly one `onDestroyed` fire.
2. Tour cancellation mid-navigation-wait: close the tour (Escape / overlay click / close button) while
   `waitForElement`'s `MutationObserver` is still pending. Confirm no `moveTo()` call fires afterward, the
   observer disconnects, and no console error/dangling timeout.
3. Browser Back button during a route-crossing step: confirm the tour ends cleanly via the existing
   `onDestroyed` path (same as any other early exit) — no stuck overlay, no orphaned observer/timeout.
4. `waitForElement` timeout (simulate by temporarily renaming a `data-tour` target during testing): confirm
   the tour calls `driver.destroy()` and closes cleanly, same as any other early exit — no stuck overlay.
5. Household-page preview, both flows: confirm no `PATCH /api/household`, no `PATCH /api/onboarding`, and no
   `POST /api/pantry/bulk` fire at any point (network tab), regardless of how far into the preview you go or
   how you exit it. Specifically: type a custom household name in the preview's Welcome step, exit the
   preview (any path), then reload `/household` and confirm the real household name is unchanged.
6. Refresh mid-preview: confirm the app returns to normal state with no onboarding/preview overlay — and that
   nothing about the preview was written to `localStorage`/`sessionStorage`.
7. Mobile viewport, all six pages: confirm the title is fully clear of the hamburger button, and action
   buttons (where present) are unaffected.
8. iPhone (real device, not simulator): tap "Take Photo" and confirm the camera opens directly with no
   action sheet; tap "Choose from Library" and confirm the photo library opens directly. Repeat for both
   `RecipeUpload` and `ReceiptUpload`.
9. Chat page info icon: confirm the modal opens/closes correctly and the copy stays accurate to the real
   tool surface — no mention of receipt scanning, recipe-image OCR, or URL import.
10. `grep -r "'/login'"` across `client/src` returns zero matches; confirm `ProtectedRoute.jsx` is deleted and
    nothing imports it.
11. `npm test` / `npm run lint` / `npm run build` all pass.
