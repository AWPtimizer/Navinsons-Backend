import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { requireCronSecret } from './middleware/requireCronSecret.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.routes.js';
import customersRoutes from './routes/customers.routes.js';
import vendorsRoutes from './routes/vendors.routes.js';
import transportersRoutes from './routes/transporters.routes.js';
import challansRoutes from './routes/challans.routes.js';
import inwardsRoutes from './routes/inwards.routes.js';
import transportsRoutes from './routes/transports.routes.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.routes.js';
import uploadsRoutes from './routes/uploads.routes.js';
import geocodeRoutes from './routes/geocode.routes.js';
import ledgerEntriesRoutes from './routes/ledgerEntries.routes.js';
import bankAccountsRoutes from './routes/bankAccounts.routes.js';
import ledgerRemindersRoutes from './routes/ledgerReminders.routes.js';

export const createApp = () => {
  const app = express();

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Auth routes and the WhatsApp webhook are the two deliberately unprotected
  // surfaces — the webhook must be registered BEFORE the requireAuth-gated
  // /api/transports mount below, since Express matches routes in
  // registration order and /api/transports/webhook/whatsapp is a sub-path
  // of /api/transports.
  app.use('/api/auth', authRoutes);
  app.use('/api/transports/webhook/whatsapp', whatsappWebhookRoutes);
  // The daily ledger-reminders cron trigger is the third deliberately
  // unprotected surface — there's no logged-in user for an external pinger
  // to authenticate as, so it's guarded by a shared secret instead (see
  // requireCronSecret), not requireAuth.
  app.use('/api/cron/ledger-reminders', requireCronSecret, ledgerRemindersRoutes);

  // Everything else requires a valid session — this is the check the OLD
  // backend had commented out. Here it's enforced centrally, once, for every
  // module, rather than something each controller has to remember to do.
  app.use('/api/customers', requireAuth, customersRoutes);
  app.use('/api/vendors', requireAuth, vendorsRoutes);
  app.use('/api/transporters', requireAuth, transportersRoutes);
  app.use('/api/challans', requireAuth, challansRoutes);
  app.use('/api/inwards', requireAuth, inwardsRoutes);
  app.use('/api/transports', requireAuth, transportsRoutes);
  app.use('/api/uploads', requireAuth, uploadsRoutes);
  app.use('/api/geocode', requireAuth, geocodeRoutes);
  app.use('/api/ledger-entries', requireAuth, ledgerEntriesRoutes);
  app.use('/api/bank-accounts', requireAuth, bankAccountsRoutes);

  app.use(errorHandler);

  return app;
};
