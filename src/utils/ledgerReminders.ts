import { Customer } from '../models/Customer.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { sendPaymentReminderWhatsAppMessage } from './whatsapp.js';

// A customer's current lifetime outstanding balance (all active entries, no
// date filter) — deliberately NOT the original debit amount, since that may
// have been partially offset by payments unrelated to any one entry.
export const computeCustomerOutstanding = async (customerId: string): Promise<number> => {
  const [result] = await LedgerEntry.aggregate([
    { $match: { customerId, isActive: true } },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
        totalPayment: { $sum: { $cond: [{ $eq: ['$type', 'payment'] }, '$amount', 0] } },
      },
    },
  ]);
  if (!result) return 0;
  return result.totalDebit - result.totalPayment;
};

interface ReminderResult {
  sent: boolean;
  outstanding: number;
  error?: string;
}

// Single source of truth for "compute outstanding + send a WhatsApp reminder",
// shared by the manual "Send Reminder" button (ledgerEntries.routes.ts) and
// the daily automatic cron trigger (ledgerReminders.routes.ts) — so the two
// paths can never drift on what counts as "still owes money."
export const sendCustomerReminder = async (customerId: string): Promise<ReminderResult> => {
  const customer = await Customer.findOne({ _id: customerId, isActive: true }).lean();
  if (!customer) {
    return { sent: false, outstanding: 0, error: 'Customer not found' };
  }
  if (!customer.contactNo) {
    return { sent: false, outstanding: 0, error: 'Customer has no contact number on file' };
  }

  const outstanding = await computeCustomerOutstanding(customerId);
  if (outstanding <= 0) {
    return { sent: false, outstanding, error: 'No outstanding balance to remind about' };
  }

  // postWhatsAppTemplate (called under the hood) never throws — it returns
  // { error } on failure — so check the response shape rather than try/catch.
  const result = await sendPaymentReminderWhatsAppMessage(
    {
      phoneNo: customer.contactNo,
      customerName: customer.customerName ?? 'Customer',
      outstandingAmount: outstanding.toFixed(2),
    },
    customer.branchId ?? 'bhuleshwar'
  );

  if (result?.error) {
    return { sent: false, outstanding, error: result.error };
  }
  return { sent: true, outstanding };
};
