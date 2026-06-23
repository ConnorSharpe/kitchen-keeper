/* DEPRECATED — replaced by clerkAuth.js (TASK-016B). Kept for rollback only. Delete after Clerk is stable in production. */
import jwt from 'jsonwebtoken';

// Synchronous middleware — uses next(err) rather than throw since express-async-errors only patches async functions.
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    const err = new Error('Authentication required');
    err.status = 401;
    return next(err);
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, name: payload.name, householdId: payload.householdId };
    next();
  } catch {
    const err = new Error('Invalid or expired session');
    err.status = 401;
    next(err);
  }
}
