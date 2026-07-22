import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from './errorHandler.js';

// Guards the ledger-reminders cron trigger — there's no logged-in user to
// check a session against here (an external daily pinger calls this, not a
// browser), so it checks a shared secret instead. Read from a header, not a
// query param, so it never ends up sitting in server access logs.
export const requireCronSecret = (req: Request, _res: Response, next: NextFunction) => {
  const provided = req.headers['x-cron-secret'];
  const expected = env.cronSecret;

  if (typeof provided !== 'string' || !expected) {
    throw new HttpError(401, 'Missing or invalid cron secret');
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const matches = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);

  if (!matches) {
    throw new HttpError(401, 'Missing or invalid cron secret');
  }

  next();
};
