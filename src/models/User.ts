import { Schema, model } from 'mongoose';
import { generateId } from '../utils/id.js';

export interface IUser {
  _id: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  branchId?: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  _id: { type: String, default: generateId },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String },
  branchId: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

export const User = model<IUser>('User', userSchema);
