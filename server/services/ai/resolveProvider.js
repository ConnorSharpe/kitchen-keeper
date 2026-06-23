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
export function resolveProvider(clerkUserId, decryptedKey) {
  const isOwner = clerkUserId === process.env.OWNER_CLERK_ID;
  const key = isOwner ? process.env.OPENAI_API_KEY : decryptedKey;
  if (!key) throw new NoApiKeyError();
  return new OpenAIProvider(key);
}
