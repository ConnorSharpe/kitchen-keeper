import { createRateLimiter } from './createRateLimiter.js';

// Keyed by req.user.id (the inviting member), not householdId — deters one
// abusive actor without throttling a whole household's legitimate use
// (same reasoning as joinRateLimit.js).
export const inviteRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many invite emails sent. Please wait a while and try again.',
});
