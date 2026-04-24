// Factory that returns an Express middleware validating req.body against a Zod schema.
// Replaces req.body with the coerced, stripped result so routes always see clean data.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    const err = new Error(message);
    err.status = 400;
    return next(err);
  }
  req.body = result.data;
  next();
};
