import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as recipeService from '../services/recipeService.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/recipes
// Phase 5: read-only endpoint used by the EatThisNow fallback when AI is unavailable.
// Phase 6 will expand this with full CRUD.
router.get('/', async (req, res) => {
  const recipes = recipeService.getAll(req.user.id);
  res.json({ recipes });
});

export default router;
