import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const toggleState = { enabled: false, callCount: 0 };

mock.module('../services/platformSettingsService.js', {
  namedExports: {
    isPublicAiAccessEnabled: () => {
      toggleState.callCount++;
      return Promise.resolve(toggleState.enabled);
    },
  },
});

const { requireAiAccess, NoApiKeyError } = await import(
  './requireAiAccess.js'
);

const OWNER = 'owner_clerk_id';

function makeReq(householdOwnerClerkId) {
  return { user: { householdOwnerClerkId } };
}

test('owner household bypasses the toggle entirely (no DB call)', async () => {
  process.env.OWNER_CLERK_ID = OWNER;
  toggleState.enabled = false;
  toggleState.callCount = 0;
  let nextCalled = false;
  await requireAiAccess(makeReq(OWNER), {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(
    toggleState.callCount,
    0,
    'requireAiAccess must make no DB/toggle call for the owner household'
  );
});

test('non-owner household succeeds when the toggle is on', async () => {
  process.env.OWNER_CLERK_ID = OWNER;
  toggleState.enabled = true;
  let nextCalled = false;
  await requireAiAccess(makeReq('other_household_clerk_id'), {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('non-owner household throws NoApiKeyError when the toggle is off', async () => {
  process.env.OWNER_CLERK_ID = OWNER;
  toggleState.enabled = false;
  await assert.rejects(
    () => requireAiAccess(makeReq('other_household_clerk_id'), {}, () => {}),
    NoApiKeyError
  );
});
