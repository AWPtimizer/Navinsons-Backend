import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface IInward {
  _id: string;
  lrNo: string;
  vendorId: string;
  transporterId: string;
  branchId?: string;
  noOfParcel: string;
  transportCharges?: string;
  date: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const inwardSchema = new Schema<IInward>({
  _id: { type: String, default: generateId },
  lrNo: { type: String, required: true },
  vendorId: { type: String, required: true },
  transporterId: { type: String, required: true },
  branchId: { type: String },
  noOfParcel: { type: String, required: true },
  transportCharges: { type: String },
  date: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

inwardSchema.index({ isActive: 1 });
inwardSchema.index({ vendorId: 1 });
inwardSchema.index({ transporterId: 1 });
inwardSchema.index({ createdAt: -1 });
// Covers the plain list and GET /download's isActive filter +
// sort({ createdAt: -1 }) in one index pass.
inwardSchema.index({ isActive: 1, createdAt: -1 });

export const Inward = model<IInward>('Inward', inwardSchema);
