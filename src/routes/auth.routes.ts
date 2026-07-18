import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

const isProd = env.nodeEnv === 'production';

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new HttpError(401, 'Incorrect email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new HttpError(401, 'Incorrect email or password');
    }

    const token = jwt.sign({ id: user._id, email: user.email }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn,
    } as jwt.SignOptions);

    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token,
      user: { id: user._id, email: user.email, displayName: user.displayName, branchId: user.branchId },
    });
  })
);

router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await User.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'User not found');

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) throw new HttpError(401, 'Current password is incorrect');

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password changed successfully' });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ id: user._id, email: user.email, displayName: user.displayName, branchId: user.branchId });
  })
);

export default router;
