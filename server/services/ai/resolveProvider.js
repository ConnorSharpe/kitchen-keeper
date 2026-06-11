import { GroqProvider } from './groqProvider.js';
import { GeminiProvider } from './geminiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

// Resolves the provider adapter from an explicit stored value — never inferred from key prefix.
// provider: 'groq' | 'anthropic' | null
// key: decrypted API key string | null
export function resolveProvider(provider, key) {
  if (provider === 'anthropic' && key) {
    return new AnthropicProvider(key);
  }
  if (provider === 'groq' && key) {
    return new GroqProvider(key);
  }
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error('GROQ_API_KEY is not set. Add it to Vercel environment variables.');
  }
  return new GroqProvider(groqKey);
}

// Re-export for fallback construction in aiService.js
export { GeminiProvider };
