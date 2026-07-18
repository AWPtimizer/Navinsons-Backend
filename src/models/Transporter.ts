import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface ITransporter {
  _id: string;
  transporterName: string;
  _transporterName: string;
  _searchKeywords: string[];
  // Optional at the schema level: 7 real production transporter records
  // genuinely have no contactNo on file. See 02-implementation-decisions.md
  // "Migration reality check".
  contactNo?: string;
  alternateNo?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const transporterSchema = new Schema<ITransporter>({
  _id: { type: String, default: generateId },
  transporterName: { type: String, required: true },
  _transporterName: { type: String, required: true },
  _searchKeywords: { type: [String], default: [] },
  contactNo: { type: String },
  alternateNo: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

transporterSchema.index({ isActive: 1 });
transporterSchema.index({ _searchKeywords: 1 });
transporterSchema.index({ _transporterName: 1 });

export const Transporter = model<ITransporter>('Transporter', transporterSchema);
