// drizzle-orm 0.44+ wraps driver errors in DrizzleQueryError, moving the pg fields (code,
// constraint) to err.cause. This checks err and up to 5 nested causes (TASK-071 §7), matching
// on each object before reading its cause. Never throws: a throwing getter returns false.
const MAX_CAUSE_DEPTH = 5;

export function isUniqueViolation(err, constraintName) {
  try {
    let cur = err;
    for (let depth = 0; ; depth++) {
      if (typeof cur !== 'object' || cur === null) return false;
      if (cur.code === '23505' && cur.constraint === constraintName) return true;
      if (depth === MAX_CAUSE_DEPTH) return false;
      cur = cur.cause;
    }
  } catch {
    return false;
  }
}
