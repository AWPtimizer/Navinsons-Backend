import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

// Simple lookup list for the Ledger's "Mode of Payment -> Bank" dropdown —
// no search-keyword/counter machinery needed, this is never typeahead-
// searched at scale like Customer/Vendor, just a short picklist.
export interface IBankAccount {
  _id: string;
  bankName: string;
  accountLabel: string; // dropdown display text, e.g. "HDFC Current - 1234"
  accountNumber?: string;
  ifscCode?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const bankAccountSchema = new Schema<IBankAccount>({
  _id: { type: String, default: generateId },
  bankName: { type: String, required: true },
  accountLabel: { type: String, required: true },
  accountNumber: { type: String },
  ifscCode: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

bankAccountSchema.index({ isActive: 1 });

export const BankAccount = model<IBankAccount>('BankAccount', bankAccountSchema);
