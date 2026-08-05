import { getAuth } from '@clerk/express';
import * as householdService from '../services/householdService.js';

export async function clerkAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) {
    const err = new Error('Authentication required');
    err.status = 401;
    return next(err);
  }
  try {
    const household = await householdService.getOrCreate(userId);
    req.user = {
      id: userId,
      householdId: household.id,
      householdOwnerClerkId: household.clerkUserId,
    };
    next();
  } catch (err) {
    next(err);
  }
}
