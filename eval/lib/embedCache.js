// TASK-069 §2.8: disk-backed embedding cache wrapped around a provider's embed().
import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Wraps ProviderClass.prototype.embed with a cache keyed by model + text hash.
 * Returns a control object: { enabled, stats, save(), uninstall() }.
 */
export function installEmbedCache(ProviderClass, { model, load = () => ({}), persist = () => {} }) {
  const original = ProviderClass.prototype.embed;
  const store = load();
  const key = (text) => `${model}:${sha256(text)}`;
  const control = {
    enabled: true,
    stats: { hits: 0, misses: 0, apiCalls: 0, apiTokens: 0 },
    save: () => persist(store),
    uninstall: () => {
      ProviderClass.prototype.embed = original;
    },
  };

  ProviderClass.prototype.embed = async function embed(texts, opts = {}) {
    const { stats } = control;
    if (control.enabled === false) {
      let tokens = 0;
      const result = await original.call(this, texts, { onUsage: (n) => (tokens = n) });
      stats.apiCalls += 1;
      stats.apiTokens += tokens;
      opts.onUsage?.(tokens);
      return result;
    }

    const missing = [...new Set(texts.filter((t) => !store[key(t)]))];
    stats.hits += texts.filter((t) => store[key(t)]).length;
    if (missing.length > 0) {
      let tokens = 0;
      const vectors = await original.call(this, missing, { onUsage: (n) => (tokens = n) });
      const totalLength = missing.reduce((sum, t) => sum + t.length, 0);
      missing.forEach((text, i) => {
        store[key(text)] = { v: vectors[i], t: (tokens * text.length) / totalLength };
      });
      stats.misses += missing.length;
      stats.apiCalls += 1;
      stats.apiTokens += tokens;
    }
    opts.onUsage?.(Math.round(texts.reduce((sum, t) => sum + store[key(t)].t, 0)));
    return texts.map((t) => store[key(t)].v);
  };

  return control;
}
