# TASK-048 — Public Landing Page for Signed-Out Visitors

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.7/10 — approve after one revision | Confirmed the Clerk source-reading (`SignedIn`/`SignedOut` never flash the wrong state), the tiny blast radius, the rejection of a full route-tree restructure, the `<Link>`-over-modal-buttons decision (D-3), and the SEO/no-backend scoping — all as sound engineering. Required change, as proposed: stop `PrivateRoute` from hardcoding `LandingPage`/`'/'` inline, since a component whose job is "gate private content" hardcoding a specific marketing page name conflates two responsibilities. **Adopted, but not the literal proposed shape**: the review's own sketch (`<Route path="/" element={<RootPage/>}/>` with `RootPage` choosing `ChatPage` vs `LandingPage`) doesn't compose with this app's actual routing — `ChatPage` isn't self-contained, it depends on being rendered through `AppLayout`'s `<Outlet/>` (for `Sidebar`, `PantryProvider`, `OnboardingGate`, and the `mobileNavOpen` context every page reads via `useOutletContext()`). Pulling `/` out to a fully separate top-level route, as sketched, would require either a second `AppLayout` mount (remounting `PantryProvider` and `Sidebar` on every navigation between `/` and any other private page — a real regression: pantry data would refetch and flicker on each such nav, not just a cosmetic sidebar-state reset) or modifying `AppLayout` itself to support two different mounting styles — both larger changes than DRAFT-1's own review praised (see its section 3, "good rejection of unnecessary route restructuring", which argued against exactly this kind of AppLayout-ownership churn). Adopted the underlying principle a different way instead: `PrivateRoute` no longer imports `LandingPage` or hardcodes what a signed-out visitor to the public path sees — it accepts that element as a `publicHomeElement` prop from the route definition in `App.jsx` (which already owns "what public pages exist"), and only checks `location.pathname === '/'` to decide whether to use it. `PrivateRoute`'s own body is now generic — it no longer needs to know `LandingPage` exists. Also adopted as-suggested: an explicit constraint that `LandingPage` must never import `AppLayout`/`PantryProvider`, and accessibility checks added to Verification Steps. **Declined, with reasoning**: the literal `RootPage` restructure — see above. |
| DRAFT-2 | 10/10 — APPROVED FOR IMPLEMENTATION | Confirmed the `publicHomeElement` prop is the right shape: `App.jsx` owns routing configuration, `PrivateRoute` owns auth gating, `LandingPage` owns presentation, `AppLayout` owns the authenticated shell — no remaining unnecessary coupling. Agreed the declined `RootPage` restructure was the correct call given `ChatPage`'s dependency on `AppLayout`'s `<Outlet/>`/shared providers, not just accepted on faith. No further changes requested. One non-blocking observation for future reference (not actioned, not required): if additional public/authenticated route carve-outs are ever needed beyond this single `/` case, revisit whether a single specialized `publicHomeElement` prop is still the right abstraction, or whether a broader route-level mechanism is worth it at that point — deliberately not built now since only one carve-out exists today. |

---

## Origin

Today, anyone who hits the app while signed out — a fresh visitor, a shared link, someone who signed
out — is bounced straight into Clerk's embedded sign-in form with zero explanation of what the app even
is. That's a rough first impression, especially now that sign-up is deliberately unrestricted
(`README.md`: "Sign-up is currently unrestricted — create an account via the link above") as part of
taking this app public (see TASK-037's public-launch prerequisites). Connor asked for a landing page at
the root URL that (1) describes the app's actual purpose and (2) offers a "Create account" button and a
"Log in" button — nothing more elaborate for v1.

## Current Behavior (confirmed by reading the code)

- [App.jsx](../../client/src/App.jsx): the index route (`/`) renders `<ChatPage/>` nested inside a shared
  `PrivateRoute` + `AppLayout` wrapper. `PrivateRoute` is:
  ```jsx
  function PrivateRoute({ children }) {
    return (
      <>
        <SignedIn>{children}</SignedIn>
        <SignedOut><RedirectToSignIn /></SignedOut>
      </>
    );
  }
  ```
  This single component also gates `/dashboard`, `/pantry`, `/recipes`, `/shopping`, `/household` — every
  private route in the app shares it.
- `/sign-in/*` and `/sign-up/*` are already public, top-level routes rendering Clerk's `<SignIn>`/`<SignUp>`
  directly with `routing="path"`.
- [JoinPage.jsx](../../client/src/pages/JoinPage.jsx) is the one existing precedent for a route reachable
  while signed out — it does its own `isLoaded`/`isSignedIn` branching rather than going through
  `PrivateRoute`, because it needs custom logic (auto-joining a household once signed in). The new landing
  page doesn't need that custom logic, so it can lean on `PrivateRoute` directly instead of duplicating a
  manual gate.
- `client/index.html` has no `<meta name="description">` — just title, theme-color, and PWA tags.
- Installed package is `@clerk/clerk-react@^5.61.8` (plain SPA usage via `BrowserRouter`), **not**
  `@clerk/react-router` (the newer framework/loader-based package with the `<Show>` component and
  `rootAuthLoader()`). `<SignedIn>`/`<SignedOut>`/`useAuth()` are the correct, fully-supported primitives
  for this package, and this app already uses them consistently (`PrivateRoute`, `JoinPage.jsx`) — no
  reason to introduce a different auth-gating primitive for one new page.

### Confirmed, by reading the installed source, not assumed: `SignedIn`/`SignedOut` can't flash the wrong state

Read directly from `client/node_modules/@clerk/clerk-react/dist/index.js`:

```js
var SignedIn = ({ children, treatPendingAsSignedOut }) => {
  const { userId } = useAuth({ treatPendingAsSignedOut });
  if (userId) return children;
  return null;
};
var SignedOut = ({ children, treatPendingAsSignedOut }) => {
  const { userId } = useAuth({ treatPendingAsSignedOut });
  if (userId === null) return children;
  return null;
};
```

`SignedIn` requires a **truthy** `userId`; `SignedOut` requires `userId === null` (strict equality) —
and `useAuth`'s underlying context leaves `userId` as `undefined` until Clerk has actually resolved the
session, only setting it to `null` once it's definitively confirmed there's no session. So while Clerk is
still loading, `userId` is `undefined` — neither check passes, and **both components render nothing**.
There is no window where a signed-in user briefly sees signed-out content (or vice versa); this is the
same guarantee `PrivateRoute` already silently depends on today. This means the design below needs no
extra manual `isLoaded` gate — extending `PrivateRoute` inherits this guarantee automatically.

---

## Design

### The carve-out: `PrivateRoute` accepts a `publicHomeElement`, it doesn't hardcode one

The most surgical fix is inside `PrivateRoute` itself, not a route-tree restructure. `PrivateRoute`
already wraps one shared parent route matching all six private paths (`/`, `/dashboard`, `/pantry`,
`/recipes`, `/shopping`, `/household`) via `AppLayout`'s nested children. Rebuilding the route tree so `/`
sits outside that wrapper would mean either duplicating `AppLayout`'s mount (breaking the single shared
`mobileNavOpen` state and `PantryProvider` instance that `Sidebar`/`OnboardingGate`/pages all depend on —
see round-1 architect review above for why the more "obviously clean" `RootPage` alternative was tried and
declined) or restructuring routing more than this task's actual ask requires.

Instead, `PrivateRoute` gets one new optional prop, `publicHomeElement`. It still only ever checks
`location.pathname === '/'` internally, but it no longer needs to know `LandingPage` exists — the actual
element to show is handed to it from `App.jsx`'s route definitions, which already own "what public pages
exist." This keeps `PrivateRoute`'s job legible as "gate private content, with one configurable public
carve-out" rather than "gate private content *and* know about the marketing homepage":

```jsx
function PrivateRoute({ children, publicHomeElement }) {
  const location = useLocation();
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        {publicHomeElement && location.pathname === '/'
          ? publicHomeElement
          : <RedirectToSignIn />}
      </SignedOut>
    </>
  );
}
```

Signed-in behavior at `/` is completely unchanged (still `AppLayout` → `ChatPage`). Signed-out behavior at
every path *except* `/` is completely unchanged (still an immediate redirect to Clerk's sign-in). Only a
signed-out hit on the bare root path changes, from an immediate redirect to rendering `LandingPage`.

### `client/src/pages/LandingPage.jsx` (new)

Copy is drawn directly from `README.md`'s own already-written app description rather than invented
marketing language — this task presents what the app already claims to be, not a new pitch. Follows this
app's existing Tailwind conventions (`orange-600` brand accent — see `Sidebar.jsx`'s logo text and primary
buttons; `bg-gray-50` page background; `rounded-2xl` cards; emoji feature icons, matching `Sidebar.jsx`'s
nav icons).

```jsx
import { Link } from 'react-router-dom';

const FEATURES = [
  { icon: '🥦', title: 'Track your pantry', text: 'Add items manually or snap a photo of a grocery receipt.' },
  { icon: '⏰', title: 'See what\'s expiring', text: 'Color-coded urgency so nothing gets forgotten in the back of the fridge.' },
  { icon: '💬', title: 'Get AI meal ideas', text: 'Suggestions generated from what\'s about to expire, or chat freely with the AI assistant.' },
  { icon: '📖', title: 'Save your recipes', text: 'Keep a collection built from suggestions or your own search.' },
  { icon: '🛒', title: 'Build shopping lists', text: 'From pantry gaps or straight from a recipe\'s ingredients.' },
  { icon: '🏠', title: 'Share with your household', text: 'Everyone sees the same pantry, recipes, and lists in real time.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="px-6 py-4">
        <span className="text-lg font-bold text-orange-600">Kitchen Keeper</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 max-w-2xl">
          Stop throwing away food you forgot you had.
        </h1>
        <p className="mt-4 text-gray-500 max-w-xl">
          Kitchen Keeper is an AI-powered food waste management app for households. Track your pantry, see
          what's expiring, get AI meal suggestions tailored to what you have on hand, and share it all with
          your family — from your phone or browser.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link
            to="/sign-up"
            className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors"
          >
            Create account
          </Link>
          <Link
            to="/sign-in"
            className="px-6 py-2.5 border border-gray-300 hover:bg-gray-100 text-gray-700 font-medium rounded-lg transition-colors"
          >
            Log in
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 max-w-4xl text-left">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-2xl mb-2" aria-hidden>{f.icon}</div>
              <h2 className="font-semibold text-gray-900 mb-1">{f.title}</h2>
              <p className="text-sm text-gray-500">{f.text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
```

### `client/src/App.jsx` changes

```diff
-import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
+import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
 import { Toaster } from 'react-hot-toast';
 import {
   SignIn,
   SignUp,
   SignedIn,
   SignedOut,
   RedirectToSignIn,
 } from '@clerk/clerk-react';
 import { AuthProvider } from './context/AuthContext.jsx';
 import AppLayout from './components/layout/AppLayout.jsx';
 import ErrorBoundary from './components/layout/ErrorBoundary.jsx';
 import DashboardPage from './pages/DashboardPage.jsx';
+import LandingPage from './pages/LandingPage.jsx';
 import PantryPage from './pages/PantryPage.jsx';
 ...

-function PrivateRoute({ children }) {
+function PrivateRoute({ children, publicHomeElement }) {
+  const location = useLocation();
   return (
     <>
       <SignedIn>{children}</SignedIn>
       <SignedOut>
-        <RedirectToSignIn />
+        {publicHomeElement && location.pathname === '/'
+          ? publicHomeElement
+          : <RedirectToSignIn />}
       </SignedOut>
     </>
   );
 }
```

And the one route usage that wraps `AppLayout` picks up the new prop:

```diff
             <Route
               element={
-                <PrivateRoute>
+                <PrivateRoute publicHomeElement={<LandingPage />}>
                   <AppLayout />
                 </PrivateRoute>
               }
             >
```

Nothing else in `App.jsx` changes — the route tree itself, `AppLayout`, and every other page are untouched.
`PrivateRoute` itself never imports or references `LandingPage` by name in its own logic beyond receiving
it as a prop — that's the whole point of round 1's revision.

### `client/index.html` — add a meta description

Purely additive, no existing tag conflicts. Cheap and directly relevant now that `/` serves real public
content for the first time (link previews, whatever crawling does happen):

```diff
     <meta name="viewport" content="width=device-width, initial-scale=1.0" />
     <title>Kitchen Keeper</title>
+    <meta name="description" content="Kitchen Keeper is an AI-powered food waste management app for households — track your pantry, see what's expiring, and get AI meal suggestions from what you have on hand." />
     <meta name="theme-color" content="#16a34a" />
```

---

## Decisions

- **D-1**: Fix lives inside the existing shared `PrivateRoute`, gated on `location.pathname === '/'`,
  rather than restructuring the route tree to pull `/` out from under `AppLayout`. Restructuring would
  either duplicate `AppLayout`'s mount (breaking the single shared `mobileNavOpen` state and
  `PantryProvider` instance) or require a second, parallel layout just for the signed-out root — more
  moving parts than this task's actual ask. (Round 1 revised this: `PrivateRoute` takes the actual element
  as a `publicHomeElement` prop rather than hardcoding `LandingPage` inline — see D-6.)
- **D-2**: No manual `isLoaded` loading-state gate is added, unlike `JoinPage.jsx`'s custom gate — proven
  unnecessary by reading `SignedIn`/`SignedOut`'s actual source (see Current Behavior): both already render
  nothing until Clerk has resolved `userId` to either a real value or `null`.
- **D-3**: CTAs are plain `<Link>`s to the already-existing `/sign-up` and `/sign-in` path routes, not
  Clerk's `<SignUpButton>`/`<SignInButton>` modal-triggering components. This app already committed to
  full-page, path-based routing for auth (`routing="path"` on both `<SignIn>`/`<SignUp>` in `App.jsx`);
  introducing modal-triggering buttons here would be a second, inconsistent auth-entry pattern for no
  benefit.
- **D-4**: Landing page copy is drawn verbatim/near-verbatim from `README.md`'s existing app description
  and feature list — not new marketing copy — so the public-facing claim matches what's already written
  and true about the app today.
- **D-5**: No change to Clerk's configured post-sign-in/post-sign-up redirect. Neither `<SignIn>` nor
  `<SignUp>` in `App.jsx` currently passes `afterSignInUrl`/`afterSignUpUrl`/`fallbackRedirectUrl`, so both
  fall back to the Clerk instance's own dashboard-configured redirect — confirm during verification that
  this is in fact `/` (expected, since that's the app's existing default landing behavior for a
  newly-authenticated user), not assumed.
- **D-6** *(round 1)*: `PrivateRoute` receives the signed-out root's element as a `publicHomeElement` prop
  from `App.jsx` rather than hardcoding an import of `LandingPage` and a bare `'/'` check inline —
  `PrivateRoute`'s job stays "gate private content, with one configurable public carve-out," not "gate
  private content and also know what the marketing homepage is." The review's own suggested alternative
  (a standalone `RootPage` route sitting entirely outside `AppLayout`) was considered and declined: `ChatPage`
  isn't self-contained — it depends on `AppLayout`'s `<Outlet/>` for `Sidebar`, `PantryProvider`,
  `OnboardingGate`, and the `mobileNavOpen` context passed via `useOutletContext()`. Moving `/` outside that
  wrapper would force either a second `AppLayout` mount (real regression: `PantryProvider` — and therefore
  pantry data — would refetch every time a signed-in user navigates between `/` and any other private page,
  not just a cosmetic sidebar-state reset) or changes to `AppLayout` itself to support two different mounting
  styles, both larger than this task's scope and the same category of restructuring the review's own DRAFT-1
  feedback praised rejecting elsewhere (section 3, "good rejection of unnecessary route restructuring").

---

## Allowed Files

- New: `client/src/pages/LandingPage.jsx`
- Modified: `client/src/App.jsx` (`PrivateRoute` branch + one new import), `client/index.html` (one new
  `<meta>` tag)

## Forbidden Files

- `client/src/components/layout/AppLayout.jsx`, `Sidebar.jsx` — the private-app shell is unchanged; the
  signed-out root path never mounts either of them.
- `client/src/pages/ChatPage.jsx`, `JoinPage.jsx` — unrelated; ChatPage still renders unchanged for signed-in
  users at `/`, and JoinPage's own signed-out gate is a different, already-working mechanism this task
  doesn't touch.
- Anything under `server/` — this is a client-only routing + static content change; no API surface is
  involved.
- Clerk Dashboard configuration (sign-up restrictions, redirect URLs) — out of scope, non-code, tracked
  separately (see [[project_go_public_readiness]] / TASK-037's Deployment Prerequisites).

## Constraints

- Zero new npm dependencies.
- No backend/API changes of any kind.
- Signed-out behavior on every path other than `/` (`/dashboard`, `/pantry`, `/recipes`, `/shopping`,
  `/household`) must be byte-identical to today's — an immediate redirect to Clerk sign-in. This is a
  regression risk specifically because `PrivateRoute` is shared code, not new code written just for this
  page — verify explicitly, don't just assume the `pathname === '/'` check is narrow enough.
- Signed-in behavior at every path, including `/`, must be unchanged.
- `LandingPage` must never import `AppLayout` or `PantryProvider` — this ensures a signed-out visitor never
  triggers authenticated application state (pantry fetches, household lookups) before they've even signed
  in. Already true by construction (see the component in Design above, which has no such imports), stated
  explicitly per round-1 architect review so it's a documented invariant, not just an implied side effect.

## Out of Scope (v1)

- **Server-side rendering / prerendering for SEO.** This is a Vite SPA with no SSR; a crawler that doesn't
  execute JS sees an empty shell rather than the landing copy on first paint. Acceptable for now — this app
  is reached primarily via shared links and word of mouth at its current scale, not organic search — but a
  real fix (prerendering, or a framework migration) is a meaningfully bigger effort than this task.
- Any additional marketing page (pricing, testimonials, blog, docs) beyond the single landing screen.
- A/B testing or analytics instrumentation on the landing page.
- Localization/i18n.
- Changing Clerk's dashboard-configured sign-up restrictions or redirect URLs — non-code, tracked under
  TASK-037's Deployment Prerequisites / [[project_go_public_readiness]], not this task.

## Known Risks

- **SPA crawling limitation** — see Out of Scope above. Not solved here, called out so it isn't mistaken
  for an oversight.
- **Shared-component regression surface** — `PrivateRoute` gates five other private paths beside `/`; the
  path-based carve-out needs to be verified narrow (see Verification Steps), since a mistake here would
  silently make every private route public rather than just the root.

## Verification Steps

1. Signed out, navigate directly to `/`: `LandingPage` renders (app description + both buttons) — no
   redirect to Clerk's sign-in screen.
2. From `LandingPage`, click "Create account" → lands on `/sign-up`; complete sign-up → redirected back to
   `/`, which now renders `ChatPage` (confirms D-5's redirect-target assumption empirically, not just by
   reading config).
3. From `LandingPage`, click "Log in" → lands on `/sign-in`; sign in with an existing account → redirected
   back to `/`, `ChatPage` renders.
4. Signed out, deep-link directly to each of `/dashboard`, `/pantry`, `/recipes`, `/shopping`, `/household`
   — every one still redirects straight to Clerk's sign-in, exactly as before this change (regression check
   on the shared `PrivateRoute`).
5. Signed in, hard-refresh on `/` — confirm no visible flash of `LandingPage` before `ChatPage` appears.
6. Check both a mobile (375px) and desktop viewport — `LandingPage` is responsive, both buttons are
   reachable and tappable, feature grid reflows sensibly.
7. View page source (or a link-preview tool) confirms the new `<meta name="description">` is present.
8. Accessibility (added per round-1 architect review): tab through `LandingPage` using only the keyboard —
   both `<Link>`s receive a visible focus outline and activate on Enter; confirm `<h1>` is the only
   top-level heading and each feature card's `<h2>` nests correctly under it (no skipped heading levels).
