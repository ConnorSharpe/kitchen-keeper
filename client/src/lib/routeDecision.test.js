import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRouteDecision } from './routeDecision.js';

// Traces mirror TASK-063-spec.md Acceptance Criterion 6 exactly.

test('unsettled (loading or settling) never redirects and never renders children — always render-nothing', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'loading', isSignedIn: undefined },
      { hasPublicHome: true, pathname: '/' }
    ),
    'render-nothing'
  );
  assert.equal(
    resolveRouteDecision(
      { status: 'settling', isSignedIn: undefined },
      { hasPublicHome: true, pathname: '/' }
    ),
    'render-nothing'
  );
});

test('settling with a stale false about to correct to true is render-nothing, never redirect-to-sign-in', () => {
  // The stale raw value must never leak into the decision while status !== 'settled'.
  const decision = resolveRouteDecision(
    { status: 'settling', isSignedIn: false },
    { hasPublicHome: false, pathname: '/dashboard' }
  );
  assert.equal(decision, 'render-nothing');
});

test('settling with a stale true about to correct to false is render-nothing, never render-children', () => {
  const decision = resolveRouteDecision(
    { status: 'settling', isSignedIn: true },
    { hasPublicHome: false, pathname: '/dashboard' }
  );
  assert.equal(decision, 'render-nothing');
});

test('settled + signed in renders children regardless of hasPublicHome/pathname', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: true },
      { hasPublicHome: true, pathname: '/' }
    ),
    'render-children'
  );
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: true },
      { hasPublicHome: false, pathname: '/pantry' }
    ),
    'render-children'
  );
});

test('settled + signed out at "/" with a public home renders the public home', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: false },
      { hasPublicHome: true, pathname: '/' }
    ),
    'render-public-home'
  );
});

test('settled + signed out on a private route (no public home / not "/") redirects to sign-in', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: false },
      { hasPublicHome: true, pathname: '/pantry' }
    ),
    'redirect-to-sign-in'
  );
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: false },
      { hasPublicHome: false, pathname: '/' }
    ),
    'redirect-to-sign-in'
  );
});

// PublicRoute (SignIn/SignUp pages) calls this with hasPublicHome: false and inverts the result
// at its own call site (spec Section 3.2) — verified here at the decision-function level.
test('PublicRoute-shaped call: settled + signed in yields render-children, which PublicRoute inverts to a redirect', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: true },
      { hasPublicHome: false, pathname: '/sign-in' }
    ),
    'render-children'
  );
});

test('PublicRoute-shaped call: settled + signed out yields redirect-to-sign-in, which PublicRoute inverts to rendering the form', () => {
  assert.equal(
    resolveRouteDecision(
      { status: 'settled', isSignedIn: false },
      { hasPublicHome: false, pathname: '/sign-in' }
    ),
    'redirect-to-sign-in'
  );
});
