import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const NAV_STEPS = [
  { element: '[data-tour="nav-chat"]', popover: { title: 'Chat', description: 'Ask the AI assistant to add pantry items, suggest meals, or build a shopping list — just by typing.' } },
  { element: '[data-tour="nav-dashboard"]', popover: { title: 'Dashboard', description: "See what's expiring soon and what you can cook tonight." } },
  { element: '[data-tour="nav-pantry"]', popover: { title: 'Pantry', description: 'Everything you have on hand, with expiry tracking.' } },
  { element: '[data-tour="nav-recipes"]', popover: { title: 'Recipes', description: 'Save recipes by photo, URL, or search — cook from what you have.' } },
  { element: '[data-tour="nav-shopping"]', popover: { title: 'Shopping', description: 'Auto-built shopping lists from what your pantry is missing.' } },
  { element: '[data-tour="nav-household"]', popover: { title: 'Household', description: 'Invite others, manage members, and set dietary preferences shared by everyone here.' } },
];

const START_DELAY_MS = 100;
// Matches Sidebar.jsx's `transition-transform duration-200` on the slide-in
// overlay — the tour must wait out this transition before driver.js measures
// nav-item positions, or it spotlights their pre-transition (off-screen)
// location.
const SIDEBAR_TRANSITION_MS = 200;

// onFinished fires once, whichever way the tour ends (driver.js's
// onDestroyed callback runs on natural completion, Escape, overlay click, or
// the close button alike) — this is deliberately the single source of "the
// tour step is over," not a separate call made when the tour merely *starts*.
export function runProductTour(onFinished, { setMobileNavOpen } = {}) {
  const isMobile = !window.matchMedia('(min-width: 768px)').matches; // matches Tailwind `md:` used throughout Sidebar.jsx

  function launch() {
    driver({
      showProgress: true,
      steps: NAV_STEPS,
      onDestroyed: () => {
        if (isMobile) setMobileNavOpen?.(false);
        onFinished();
      },
    }).drive();
  }

  if (isMobile) {
    setMobileNavOpen?.(true);
    setTimeout(() => requestAnimationFrame(launch), SIDEBAR_TRANSITION_MS);
  } else {
    // Called after at least one prior user click (the Welcome step's
    // Continue button), so desktop's always-visible nav is already long
    // painted — this delay is cheap insurance against a future caller that
    // skips that click, not a fix for an observed bug.
    requestAnimationFrame(() => setTimeout(launch, START_DELAY_MS));
  }
}
