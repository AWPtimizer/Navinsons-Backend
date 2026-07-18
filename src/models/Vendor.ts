import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface IVendor {
  _id: string;
  vendorName: string;
  _vendorName: string;
  _searchKeywords: string[];
  contactNo: string;
  alternateNo?: string;
  address?: string;
  gstNo?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<IVendor>({
  _id: { type: String, default: generateId },
  vendorName: { type: String, required: true },
  _vendorName: { type: String, required: true },
  _searchKeywords: { type: [String], default: [] },
  contactNo: { type: String, required: true },
  alternateNo: { type: String },
  address: { type: String },
  gstNo: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

vendorSchema.index({ isActive: 1 });
vendorSchema.index({ _searchKeywords: 1 });
vendorSchema.index({ _vendorName: 1 });
// Covers GET /download's isActive filter + sort({ vendorName: 1 }) in one
// index pass — vendorName itself had no index at all before this.
vendorSchema.index({ isActive: 1, vendorName: 1 });

export const Vendor = model<IVendor>('Vendor', vendorSchema);
