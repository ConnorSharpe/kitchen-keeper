import rateLimit from 'express-rate-limit';

export function createRateLimiter({ windowMs, limit, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { error: message },
  });
}
