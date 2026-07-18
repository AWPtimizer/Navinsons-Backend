import { randomUUID } from 'crypto';

// All documents use a plain string _id (not Mongo's default ObjectId).
// This matters for the migration: Firestore document IDs get carried over
// as-is into _id, so every customerId/transporterId/vendorId reference in
// migrated data keeps resolving correctly with zero remapping. New documents
// created after the rewrite just get a fresh UUID here instead.
export const generateId = (): string => randomUUID();
