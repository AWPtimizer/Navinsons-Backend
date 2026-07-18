import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface ICustomer {
  _id: string;
  customerId: string;
  // customerName/contactNo are optional at the schema level, not on the
  // create form: a couple of very old production records genuinely have
  // these blank. Making them required here would have silently dropped
  // those real records during migration — other records may still
  // reference this customer's _id, so keeping a thin record beats losing
  // it. See 02-implementation-decisions.md "Migration reality check".
  customerName?: string;
  _customerName?: string;
  _searchKeywords: string[];
  contactNo?: string;
  alternateNo?: string;
  address?: string;
  pincode?: string;
  gstNo?: string;
  branchId?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>({
  _id: { type: String, default: generateId },
  customerId: { type: String, required: true },
  customerName: { type: String },
  _customerName: { type: String },
  _searchKeywords: { type: [String], default: [] },
  contactNo: { type: String },
  alternateNo: { type: String },
  address: { type: String },
  pincode: { type: String },
  gstNo: { type: String },
  branchId: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: String },
  updatedBy: { type: String },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

customerSchema.index({ isActive: 1 });
customerSchema.index({ _searchKeywords: 1 });
customerSchema.index({ contactNo: 1 });
customerSchema.index({ alternateNo: 1 });
customerSchema.index({ _customerName: 1 });
// Covers GET /download's isActive filter + sort({ customerName: 1 }) in one
// index pass instead of an isActive-only lookup followed by an in-memory
// sort of every active record (customerName itself had no index at all).
customerSchema.index({ isActive: 1, customerName: 1 });

export const Customer = model<ICustomer>('Customer', customerSchema);
