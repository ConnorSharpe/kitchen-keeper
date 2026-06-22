import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

// Resolves the provider adapter from an explicit stored value — never inferred from key prefix.
// provider: 'anthropic' | null
// key: decrypted API key string | null
export function resolveProvider(provider, key) {
  if (provider === 'anthropic' && key) {
    return new AnthropicProvider(key);
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to Vercel environment variables.');
  }
  return new OpenAIProvider(openaiKey);
}
