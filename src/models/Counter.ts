import { Schema, model } from 'mongoose';

// Replaces the old app's two separate concepts (records-count/{module} docs
// and branch-challan-sequence/{branchId} docs) with one generic counter.
// _id examples: "customers", "vendors", "challan:bhuleshwar"
interface ICounter {
  _id: string;
  count: number;
  prefix?: string;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  prefix: { type: String },
});

export const Counter = model<ICounter>('Counter', counterSchema);

// Atomically increments a counter and returns the NEW value — avoids the
// old app's read-then-write race (two people creating a customer at the same
// instant could have collided on the same sequence number).
export const nextCount = async (key: string, prefix?: string): Promise<number> => {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { count: 1 }, ...(prefix ? { $setOnInsert: { prefix } } : {}) },
    { upsert: true, new: true }
  );
  return doc!.count;
};
