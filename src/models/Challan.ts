import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface IChallan {
  _id: string;
  challanNo: string;
  _challanKeywords: string[];
  customerId: string;
  transporterId?: string;
  transporterName?: string;
  // branchId/noOfParcel are optional, not a modeling mistake: ~16% of real
  // production challans predate the app adding multi-branch support at all
  // and genuinely have no branchId on file. Requiring these would silently
  // drop real historical records during migration — see
  // 02-implementation-decisions.md "Migration reality check".
  branchId?: string;
  noOfParcel?: string;
  date: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const challanSchema = new Schema<IChallan>({
  _id: { type: String, default: generateId },
  challanNo: { type: String, required: true },
  _challanKeywords: { type: [String], default: [] },
  customerId: { type: String, required: true },
  transporterId: { type: String },
  transporterName: { type: String },
  branchId: { type: String },
  noOfParcel: { type: String },
  date: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

challanSchema.index({ isActive: 1 });
challanSchema.index({ _challanKeywords: 1 });
challanSchema.index({ challanNo: 1 });
challanSchema.index({ customerId: 1 });
challanSchema.index({ createdAt: -1 });
// Covers the plain (non-search) list and GET /download's isActive filter +
// sort({ createdAt: -1 }) in one index pass instead of an isActive-only
// lookup followed by an in-memory sort of thousands of records.
challanSchema.index({ isActive: 1, createdAt: -1 });

export const Challan = model<IChallan>('Challan', challanSchema);
