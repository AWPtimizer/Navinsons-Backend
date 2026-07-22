import { Router } from 'express';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { sendCustomerReminder } from '../utils/ledgerReminders.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deliberate pacing between WhatsApp sends. The loop below is already
// sequential (one customer fully finishes before the next starts, never
// concurrent), so this isn't needed to avoid a "burst" — it's an extra
// margin against Meta's per-second rate limits regardless of how many
// customers are due on a given day.
const DELAY_BETWEEN_SENDS_MS = 300;

// Hit once daily by an external free HTTP-cron pinger (e.g. cron-job.org) —
// see requireCronSecret for why this uses a shared secret instead of a user
// session. Groups due debits by customer so a customer with several overdue
// entries still only gets ONE WhatsApp message.
router.post(
  '/run',
  asyncHandler(async (_req, res) => {
    const dueEntries = await LedgerEntry.find({
      type: 'debit',
      isActive: true,
      reminderSent: false,
      reminderDueDate: { $ne: null, $lte: today() },
    }).lean();

    const byCustomer = new Map<string, typeof dueEntries>();
    for (const entry of dueEntries) {
      const list = byCustomer.get(entry.customerId) ?? [];
      list.push(entry);
      byCustomer.set(entry.customerId, list);
    }

    const results: { customerId: string; sent: boolean; outstanding: number; error?: string }[] = [];

    for (const [customerId, entries] of byCustomer) {
      const entryIds = entries.map((e) => e._id);

      // Isolated per customer: this is the actual "retry queue" — nothing
      // fancy needed, since any entry that isn't marked reminderSent here
      // simply gets picked up again by tomorrow's run automatically. A
      // failure (or a genuinely unexpected error, e.g. a DB hiccup) for one
      // customer must not stop everyone else in today's batch from being checked.
      try {
        const result = await sendCustomerReminder(customerId);

        if (result.sent || result.outstanding <= 0) {
          // Either the reminder went out, or the debt is already cleared —
          // either way there's nothing left to remind this customer about,
          // so these entries shouldn't keep coming up in tomorrow's query.
          await LedgerEntry.updateMany(
            { _id: { $in: entryIds } },
            { reminderSent: true, reminderSentAt: new Date(), reminderSendError: null, updatedAt: new Date() }
          );
        } else {
          // Real failure (no contact number on file, WhatsApp API error) —
          // leave reminderSent false so it retries tomorrow, but record why.
          await LedgerEntry.updateMany(
            { _id: { $in: entryIds } },
            { reminderSendError: result.error, updatedAt: new Date() }
          );
        }

        results.push({ customerId, sent: result.sent, outstanding: result.outstanding, error: result.error });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ledger-reminders] Failed processing customer ${customerId}:`, err);
        await LedgerEntry.updateMany({ _id: { $in: entryIds } }, { reminderSendError: message, updatedAt: new Date() });
        results.push({ customerId, sent: false, outstanding: 0, error: message });
      }

      await sleep(DELAY_BETWEEN_SENDS_MS);
    }

    res.json({ processed: results.length, results });
  })
);

export default router;
