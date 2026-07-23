import { createRateLimiter } from './createRateLimiter.js';

// Keyed by req.user.id (the Clerk user), not householdId — a successful
// join changes the caller's household mid-request, so a household-keyed
// limiter would be measuring the wrong thing across attempts.
export const joinRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many join attempts. Please wait a few minutes and try again.',
});
