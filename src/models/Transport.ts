import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

// "Transport" = Outward in the UI. Kept the internal name "transport" to
// match the old codebase's own naming (transports collection, /transports
// route) since that's what the field reference and migration plan use.
export interface ITransport {
  _id: string;
  lrNo: string;
  customerId: string;
  transporterId: string;
  // Optional, not a modeling mistake: ~20% of real production Outward
  // records predate the app adding multi-branch support and genuinely have
  // no branchId on file. See 02-implementation-decisions.md "Migration
  // reality check" — requiring this would have silently dropped ~682 real
  // historical records during migration.
  branchId?: string;
  noOfParcel: string;
  date: string;
  // Optional photo attached to the record (e.g. the goods, or a physical
  // challan) — stored on Cloudinary, only the URL lives here.
  imageUrl?: string;
  // Links this outward shipment to the Challan it was dispatched with.
  // Optional — most historical records predate this and have none.
  challanId?: string;
  whatsappStatus?: 'pending' | 'delivered' | 'read' | 'failed';
  whatsappMessageId?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
}

const transportSchema = new Schema<ITransport>({
  _id: { type: String, default: generateId },
  lrNo: { type: String, required: true },
  customerId: { type: String, required: true },
  transporterId: { type: String, required: true },
  branchId: { type: String },
  noOfParcel: { type: String, required: true },
  date: { type: String, required: true },
  imageUrl: { type: String },
  challanId: { type: String },
  whatsappStatus: { type: String },
  whatsappMessageId: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: String },
  updatedBy: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

transportSchema.index({ isActive: 1 });
transportSchema.index({ customerId: 1 });
transportSchema.index({ transporterId: 1 });
transportSchema.index({ branchId: 1 });
transportSchema.index({ createdAt: -1 });
transportSchema.index({ whatsappMessageId: 1 });

export const Transport = model<ITransport>('Transport', transportSchema);
