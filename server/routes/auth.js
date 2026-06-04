import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import * as householdService from '../services/householdService.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const BCRYPT_COST = 12;

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

const registerSchema = z.object({
  email:         z.string().email('Invalid email address'),
  password:      z.string().min(8, 'Password must be at least 8 characters'),
  name:          z.string().min(1, 'Name is required').max(100),
  inviteCode:    z.string().trim().optional(),
  householdCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const loginLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             10,
  message:         'Too many login attempts — please try again later',
  standardHeaders: true,
  legacyHeaders:   false,
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, householdId: user.householdId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, householdId: user.householdId };
}

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, name, inviteCode, householdCode } = req.body;

  const envCode = (process.env.INVITE_CODE ?? '').trim();
  if (envCode) {
    const submitted = (inviteCode ?? '').trim();
    if (submitted !== envCode) {
      const err = new Error('Invalid invite code');
      err.status = 400;
      throw err;
    }
  }

  // Resolve household: join existing or create new
  let householdId;
  if (householdCode?.trim()) {
    const existing = await householdService.getByJoinCode(householdCode);
    if (!existing) {
      const err = new Error('Invalid household code');
      err.status = 400;
      throw err;
    }
    householdId = existing.id;
  } else {
    const newHousehold = await householdService.create(name);
    householdId = newHousehold.id;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user;
  try {
    [user] = await db.insert(users).values({ email, passwordHash, name, householdId }).returning();
  } catch (err) {
    if (err.code === '23505') {
      const conflict = new Error('An account with this email already exists');
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }

  const token = signToken(user);
  res.cookie('token', token, cookieOpts);
  res.status(201).json({ user: safeUser(user) });
});

// POST /api/auth/login
router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const [user] = await db.select().from(users).where(eq(users.email, email));

  // Constant-time compare even on "not found" to prevent user enumeration
  const hash = user?.passwordHash ?? '$2b$12$invalidhashpadding000000000000000000000000000000000000000';
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  const token = signToken(user);
  res.cookie('token', token, cookieOpts);
  res.json({ user: safeUser(user) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
