// TASK-062: iOS standalone-PWA Google OAuth self-correction.
//
// EXPECTED_OAUTH_CALLBACK_PATH is the spec's best-available-evidence default (Section 3.1), not a
// confirmed fact — on-device capture (Section 7) is still pending. If capture shows a different
// path, update only this constant.
export const EXPECTED_OAUTH_CALLBACK_PATH = '/sign-in/sso-callback';

export const OAUTH_RELOAD_MARKER_KEY = 'kk_oauth_reload_consumed';

export function cameFromOAuthCallback() {
  try {
    const ref = new URL(document.referrer);
    return (
      ref.origin === window.location.origin &&
      ref.pathname.startsWith(EXPECTED_OAUTH_CALLBACK_PATH)
    );
  } catch {
    return false;
  }
}

export function isStandalonePwa() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
