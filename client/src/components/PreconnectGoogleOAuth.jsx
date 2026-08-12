import { useLayoutEffect } from 'react';

// TASK-065: warms the connection to Google's OAuth endpoint before the user taps the
// Google button, so the redirect (client-side, no `crossorigin` -- credentialed request,
// matches a normal top-level navigation per the HTML Standard's preconnect algorithm)
// doesn't pay a cold DNS+TLS cost inside WebKit's ~1s transient-activation window.
const GOOGLE_OAUTH_ORIGIN = 'https://accounts.google.com';

export default function PreconnectGoogleOAuth({ children }) {
  useLayoutEffect(() => {
    let link = document.head.querySelector(
      `link[rel="preconnect"][href="${GOOGLE_OAUTH_ORIGIN}"]`
    );
    const createdHere = !link;
    if (createdHere) {
      link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = GOOGLE_OAUTH_ORIGIN;
      document.head.appendChild(link);
    }
    return () => {
      if (createdHere) link.remove();
    };
  }, []);

  return children;
}
