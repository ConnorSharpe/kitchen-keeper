import './instrument.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.jsx';
import { logEvent, isStandalonePwa } from './lib/debugLog.js';
import { installOauthMarkerListener } from './lib/authTransition.js';
import './index.css';

// TASK-064: production auth-recovery behavior, not diagnostics — writes kk_pending_oauth so a
// sign-in interrupted by the uncommanded reload (see ai/tasks/TASK-064-spec.md Section 2) can be
// recovered.
installOauthMarkerListener();

// TASK-063: earliest possible capture point, before Clerk or React mount — if the double
// sign-in is caused by something that resets state before the app even renders, this is the
// only place it would show up.
logEvent('app-boot', {
  href: window.location.href,
  referrer: document.referrer,
  standalone: isStandalonePwa(),
  visibilityState: document.visibilityState,
  swController: !!navigator.serviceWorker?.controller,
  // TASK-066 §0 item 4 / §2.3: confirms (not assumes) which browser and device config a capture
  // actually came from — devicePixelRatio is generic repro context, not a refresh-rate signal.
  userAgent: navigator.userAgent,
  devicePixelRatio: window.devicePixelRatio,
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js')
  );
}

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey)
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY env var');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
