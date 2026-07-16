// Keyed by householdId (set by clerkAuth, which always runs before this
// middleware) rather than IP — a household's members share one limit
// regardless of network. req.ip is only a defensive fallback for the case
// where this middleware is ever reordered ahead of clerkAuth.
export function aiRateLimitKeyGenerator(req) {
  return req.user?.householdId?.toString() ?? req.ip;
}
