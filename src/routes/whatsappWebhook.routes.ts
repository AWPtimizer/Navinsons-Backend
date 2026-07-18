import { Router } from 'express';
import { Transport } from '../models/Transport.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Deliberately UNPROTECTED — Meta calls this directly, there's no user
// session to check. Must stay mounted before the requireAuth-gated
// /api/transports router in app.ts, otherwise this gets rejected as
// unauthenticated the moment Meta actually tries to use it.

router.get('/', (req, res) => {
  const VERIFY_TOKEN = 'NS_WHATSAPP_TOKEN';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { entry } = req.body ?? {};
    if (!entry) return res.status(400).json({ error: 'Invalid webhook payload' });

    for (const event of entry) {
      for (const change of event.changes ?? []) {
        if (change.field !== 'statuses') continue;
        for (const statusUpdate of change.value?.statuses ?? []) {
          await Transport.updateMany(
            { whatsappMessageId: statusUpdate.id },
            { whatsappStatus: statusUpdate.status }
          );
        }
      }
    }
    return res.json({ message: 'Webhook processed successfully' });
  })
);

export default router;
