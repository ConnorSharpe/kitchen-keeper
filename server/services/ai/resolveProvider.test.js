import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, NoApiKeyError } from './resolveProvider.js';

const OWNER = 'owner_clerk_id';

test('owner always gets the platform key, regardless of toggle or BYOK', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: OWNER,
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: false,
  });
  assert.equal(provider.client.apiKey, 'platform-key');
});

test('non-owner with BYOK key uses their own key when toggle is off', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: false,
  });
  assert.equal(provider.client.apiKey, 'household-byok-key');
});

test('non-owner with BYOK key uses their own key even when toggle is on', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: true,
  });
  assert.equal(provider.client.apiKey, 'household-byok-key');
});

test('non-owner without a key gets the platform key when toggle is on', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: null,
    publicAiAccessEnabled: true,
  });
  assert.equal(provider.client.apiKey, 'platform-key');
});

test('non-owner without a key throws NoApiKeyError when toggle is off', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  assert.throws(
    () =>
      resolveProvider({
        clerkUserId: 'other_user',
        decryptedKey: null,
        publicAiAccessEnabled: false,
      }),
    NoApiKeyError
  );
});
