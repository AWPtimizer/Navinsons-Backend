import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from './errorHandler.js';

export interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

// Every protected route runs this. This is the check the OLD backend had
// commented out entirely (any valid-looking request could hit any endpoint
// unauthenticated) — here it's mandatory, not optional, from day one.
export const requireAuth = (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const bearer = req.headers.authorization?.split('Bearer ')[1];
  const cookieToken = req.cookies?.token;
  const token = bearer || cookieToken;

  if (!token) {
    throw new HttpError(401, 'Not authenticated');
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { id: string; email: string };
    req.user = decoded;
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired session');
  }
};
