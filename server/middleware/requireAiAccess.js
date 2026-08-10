import * as platformSettingsService from '../services/platformSettingsService.js';

export class NoApiKeyError extends Error {
  constructor() {
    super('AI features are temporarily unavailable. Please try again later.');
    this.status = 403;
    this.code = 'NO_API_KEY';
  }
}

// The single switch: owner households always pass; everyone else is gated by
// the platform-wide publicAiAccessEnabled toggle. Makes no DB call of its own —
// req.user.householdOwnerClerkId is populated once per request by clerkAuth,
// and isPublicAiAccessEnabled() is already 5s-cached.
export async function requireAiAccess(req, res, next) {
  const isOwnerHousehold =
    req.user.householdOwnerClerkId === process.env.OWNER_CLERK_ID;
  if (isOwnerHousehold) return next();

  const enabled = await platformSettingsService.isPublicAiAccessEnabled();
  if (!enabled) throw new NoApiKeyError();
  next();
}
