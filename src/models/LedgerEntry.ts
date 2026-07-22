import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

// A single credit/debit transaction against a Customer. "debit" = business
// extends credit to the customer (their outstanding balance goes up);
// "payment" = customer pays back (balance goes down). Running/closing
// balance is deliberately NOT stored here — it's computed on read from the
// full chronological set of a customer's entries (see ledgerEntries.routes.ts).
// Storing it would require recomputing every downstream entry whenever an
// earlier one is edited or soft-deleted, which every module in this app
// allows on historical records — computing fresh avoids that bug class
// entirely at negligible query cost for this data volume.
export interface ILedgerEntry {
  _id: string;
  type: 'debit' | 'payment';
  customerId: string;
  branchId?: string;
  amount: number; // always a positive magnitude; `type` carries the direction
  date: string; // 'YYYY-MM-DD', same lexicographic-sort convention as Challan.date
  referenceNo: string; // manually typed by staff, not auto-generated
  challanId?: string; // optional link to the shipment this transaction relates to
  modeOfPayment?: 'cash' | 'bank'; // only set when type === 'payment'
  bankAccountId?: string; // required only when modeOfPayment === 'bank'
  reminderPeriodDays?: number; // only meaningful when type === 'debit'
  reminderDueDate?: string; // precomputed = date + reminderPeriodDays
  reminderSent: boolean; // tracks the ONE-TIME automatic cron trigger only —
  // the manual "Send Reminder" button is independent and doesn't touch this
  reminderSentAt?: Date;
  reminderSendError?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerEntrySchema = new Schema<ILedgerEntry>({
  _id: { type: String, default: generateId },
  type: { type: String, required: true, enum: ['debit', 'payment'] },
  customerId: { type: String, required: true },
  branchId: { type: String },
  amount: { type: Number, required: true },
  date: { type: String, required: true },
  referenceNo: { type: String, required: true },
  challanId: { type: String },
  modeOfPayment: { type: String, enum: ['cash', 'bank'] },
  bankAccountId: { type: String },
  reminderPeriodDays: { type: Number },
  reminderDueDate: { type: String },
  reminderSent: { type: Boolean, default: false },
  reminderSentAt: { type: Date },
  reminderSendError: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: String },
  updatedBy: { type: String },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

// Covers per-customer ledger reads (find by customerId, sorted by date).
ledgerEntrySchema.index({ customerId: 1, date: 1 });
ledgerEntrySchema.index({ isActive: 1, branchId: 1 });
// The daily cron's exact query shape: find debits whose reminder is due and
// hasn't fired yet.
ledgerEntrySchema.index({ type: 1, isActive: 1, reminderSent: 1, reminderDueDate: 1 });

export const LedgerEntry = model<ILedgerEntry>('LedgerEntry', ledgerEntrySchema);
