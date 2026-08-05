import { OpenAIProvider } from './openaiProvider.js';

// Access is gated upstream by requireAiAccess middleware — by the time this
// runs, the request has already been authorized to use the platform key.
export function resolveProvider() {
  return new OpenAIProvider(process.env.OPENAI_API_KEY);
}
