import rateLimit from 'express-rate-limit';
import { getPlatformSettings } from '../services/platformSettingsService.js';
import { aiRateLimitKeyGenerator } from './aiRateLimitKeyGenerator.js';

// windowMs stays a fixed code constant (express-rate-limit's window
// bucketing isn't designed to change at runtime). `limit` is dynamic —
// confirmed supported by the installed express-rate-limit@7.5.1 types
// (`(request, response) => number | Promise<number>`) — so the per-household
// cap can be tuned from the admin UI without a redeploy.
//
// Abuse deterrence, not spend protection — see Known Risks.
export const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: async () => {
    const { aiRateLimitMax } = await getPlatformSettings();
    return aiRateLimitMax;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: aiRateLimitKeyGenerator,
  message: {
    error: 'Too many AI requests. Please wait a few minutes and try again.',
  },
});
