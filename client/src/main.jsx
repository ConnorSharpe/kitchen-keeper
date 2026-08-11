import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.jsx';
import { logEvent, isStandalonePwa } from './lib/debugLog.js';
import {
  installLifecycleLogging,
  installUrlChangeLogging,
  installClickLogging,
} from './lib/lifecycleLog.js';
import './index.css';

installLifecycleLogging();
installUrlChangeLogging();
installClickLogging();

// TASK-063: earliest possible capture point, before Clerk or React mount — if the double
// sign-in is caused by something that resets state before the app even renders, this is the
// only place it would show up.
logEvent('app-boot', {
  href: window.location.href,
  referrer: document.referrer,
  standalone: isStandalonePwa(),
  visibilityState: document.visibilityState,
  swController: !!navigator.serviceWorker?.controller,
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
