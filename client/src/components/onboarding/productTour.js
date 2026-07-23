import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

// Interleaved: visit each page once, cover its nav item and its own action
// buttons together, then move on. `route` drives cross-route advancement in
// `goToStep` below — it has no meaning to driver.js itself, which only knows
// about elements already mounted on the current page.
const STEPS = [
  { element: '[data-tour="nav-chat"]', route: '/', popover: { title: 'Chat', description: 'Ask the AI assistant to add pantry items, suggest meals, or build a shopping list — just by typing.' } },
  { element: '[data-tour="nav-dashboard"]', route: '/dashboard', popover: { title: 'Dashboard', description: "See what's expiring soon and what you can cook tonight." } },
  { element: '[data-tour="nav-pantry"]', route: '/pantry', popover: { title: 'Pantry', description: 'Everything you have on hand, with expiry tracking.' } },
  { element: '[data-tour="scan-receipt"]', route: '/pantry', popover: { title: 'Scan a receipt', description: 'Scan a grocery receipt to add multiple pantry items at once.' } },
  { element: '[data-tour="add-item"]', route: '/pantry', popover: { title: 'Add an item', description: 'Or add an item manually — name, quantity, and expiry date.' } },
  { element: '[data-tour="nav-recipes"]', route: '/recipes', popover: { title: 'Recipes', description: 'Save recipes by photo, URL, or search — cook from what you have.' } },
  { element: '[data-tour="upload-recipe-image"]', route: '/recipes', popover: { title: 'Upload a recipe photo', description: "Snap a photo of a recipe and we'll digitize it automatically." } },
  { element: '[data-tour="import-recipe-url"]', route: '/recipes', popover: { title: 'Import from a URL', description: 'Paste a link to import a recipe from anywhere on the web.' } },
  { element: '[data-tour="find-recipes-online"]', route: '/recipes', popover: { title: 'Find recipes online', description: "Search the web for recipes that use what's already in your pantry." } },
  { element: '[data-tour="nav-shopping"]', route: '/shopping', popover: { title: 'Shopping', description: 'Auto-built shopping lists from what your pantry is missing.' } },
  { element: '[data-tour="nav-household"]', route: '/household', popover: { title: 'Household', description: 'Invite others, manage members, and set dietary preferences shared by everyone here.' } },
];

const START_DELAY_MS = 100;
// Matches Sidebar.jsx's `transition-transform duration-200` on the slide-in
// overlay — any step that needs the sidebar open must wait out this
// transition before driver.js measures nav-item positions, or it spotlights
// their pre-transition (off-screen) location.
const SIDEBAR_TRANSITION_MS = 200;
// A timeout here means a selector typo, a route bug, or the target element
// unexpectedly not rendering — a real bug, not a transient condition worth
// retrying, so it ends the tour (see goToStep's failure path below).
const WAIT_FOR_ELEMENT_TIMEOUT_MS = 2000;

function isNavStep(step) {
  return step.element.startsWith('[data-tour="nav-');
}

// Resolves true the instant a MutationObserver on document.body sees
// `selector` match, or false if `timeoutMs` elapses first. `signal` mirrors
// the `abortRef`-on-close pattern already used in
// RecipeUpload.jsx/RecipeUrlImport.jsx: cancellable so an in-flight wait
// can't resolve after the tour that started it has already been destroyed.
function waitForElement(selector, { timeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) settle(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = setTimeout(() => settle(false), timeoutMs);
    const onAbort = () => settle(false);
    signal?.addEventListener('abort', onAbort);
  });
}

// onFinished fires once, whichever way the tour ends (driver.js's
// onDestroyed callback runs on natural completion, Escape, overlay click, or
// the close button alike, and this file's own goToStep/onHighlightStarted/
// popstate paths all funnel into the same driver.destroy() call) — this is
// deliberately the single source of "the tour step is over," not a separate
// call made when the tour merely *starts*.
export function runProductTour(onFinished, { setMobileNavOpen, navigate } = {}) {
  const isMobile = !window.matchMedia('(min-width: 768px)').matches; // matches Tailwind `md:` used throughout Sidebar.jsx
  const abortController = new AbortController();
  let driverObj;

  function finish() {
    abortController.abort();
    window.removeEventListener('popstate', onPopState);
    if (isMobile) setMobileNavOpen?.(false);
    onFinished();
  }

  // A physical/native Back press bypasses driver.js's Next button entirely
  // and changes the route out from under the tour — driver.js has no
  // built-in awareness of route changes, so this listener is the only thing
  // that catches it. Reuses the same "any route divergence ends the tour"
  // rule as onHighlightStarted below, just triggered by a different event.
  function onPopState() {
    const activeIndex = driverObj?.getActiveIndex();
    const activeStep = activeIndex !== undefined ? STEPS[activeIndex] : undefined;
    if (activeStep && activeStep.route !== window.location.pathname) {
      driverObj.destroy();
    }
  }

  // One shared function for advancing to any step, forward or backward,
  // including the very first one — not a separate implementation per
  // direction or for tour startup.
  async function goToStep(targetIndex, isInitial = false) {
    const target = STEPS[targetIndex];
    if (!target) {
      // Past the last step (Done clicked) or before the first (Previous
      // disabled by driver.js itself, so not reachable in practice) — treat
      // like any other tour-ending event.
      if (!isInitial) driverObj.destroy();
      return;
    }

    const showSidebar = isMobile && isNavStep(target);
    if (isMobile) {
      setMobileNavOpen?.(showSidebar);
      if (showSidebar) {
        await new Promise((resolve) => setTimeout(resolve, SIDEBAR_TRANSITION_MS));
        if (abortController.signal.aborted) return;
      }
    }

    if (target.route !== window.location.pathname) navigate?.(target.route);

    const found = await waitForElement(target.element, {
      timeoutMs: WAIT_FOR_ELEMENT_TIMEOUT_MS,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) return; // tour was destroyed while this wait was pending

    if (!found) {
      // See WAIT_FOR_ELEMENT_TIMEOUT_MS comment above — same early-exit path
      // as every other way the tour can end. `isInitial` means driver.js was
      // never `drive()`n, so there's nothing to destroy(); finish() directly.
      if (isInitial) finish();
      else driverObj.destroy();
      return;
    }

    if (isInitial) driverObj.drive(targetIndex);
    else driverObj.moveTo(targetIndex);
  }

  function start() {
    driverObj = driver({
      showProgress: true,
      steps: STEPS,
      onNextClick: (_el, _step, opts) => goToStep((opts.index ?? -1) + 1),
      onPrevClick: (_el, _step, opts) => goToStep((opts.index ?? 1) - 1),
      onHighlightStarted: (_el, step) => {
        if (step?.route && step.route !== window.location.pathname) driverObj.destroy();
      },
      onDestroyed: finish,
    });
    window.addEventListener('popstate', onPopState);
    goToStep(0, true);
  }

  if (isMobile) {
    start(); // goToStep(0, true) opens the sidebar itself and waits out its transition
  } else {
    // Called after at least one prior user click (the Welcome step's
    // Continue button, or the Household page's preview button), so
    // desktop's always-visible nav is already long painted — this delay is
    // cheap insurance against a future caller that skips that click, not a
    // fix for an observed bug.
    requestAnimationFrame(() => setTimeout(start, START_DELAY_MS));
  }
}
