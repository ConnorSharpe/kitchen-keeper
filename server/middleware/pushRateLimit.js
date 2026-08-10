import { createRateLimiter } from './createRateLimiter.js';

// Keyed by req.user.id — same reasoning as joinRateLimit.js/inviteRateLimit.js.
export const pushRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many requests. Please wait a few minutes and try again.',
});
