import { OpenAIProvider } from './openaiProvider.js';

export class NoApiKeyError extends Error {
  constructor() {
    super('Please add your OpenAI API key in Settings to use AI features.');
    this.status = 403;
    this.code = 'NO_API_KEY';
  }
}

// clerkUserId: the requesting household's Clerk user ID (used to identify the owner)
// decryptedKey: the household's stored OpenAI key (null if not set)
// publicAiAccessEnabled: platform-wide toggle (server/services/platformSettingsService.js).
// When true, non-owner households without their own key fall back to the platform key.
// BYOK always takes precedence over the toggle when a household has its own key set.
export function resolveProvider({
  clerkUserId,
  decryptedKey,
  publicAiAccessEnabled = false,
}) {
  const isOwner = clerkUserId === process.env.OWNER_CLERK_ID;
  const key = isOwner
    ? process.env.OPENAI_API_KEY
    : (decryptedKey ??
      (publicAiAccessEnabled ? process.env.OPENAI_API_KEY : null));
  if (!key) throw new NoApiKeyError();
  return new OpenAIProvider(key);
}
