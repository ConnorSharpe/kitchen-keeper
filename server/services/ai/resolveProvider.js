import { GeminiProvider } from './geminiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

// Resolves the provider adapter from an explicit stored value — never inferred from key prefix.
// provider: 'gemini' | 'anthropic' | null
// key: decrypted API key string | null
export function resolveProvider(provider, key) {
  if (provider === 'anthropic' && key) {
    return new AnthropicProvider(key);
  }
  return new GeminiProvider(key ?? process.env.GEMINI_API_KEY);
}
