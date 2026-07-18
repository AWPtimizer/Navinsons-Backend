// Step 3 of the migration (01-migration-plan.md §6): reads the JSON files
// produced by the OLD backend's export-for-migration.js and bulk-inserts
// them into MongoDB, preserving the original Firestore document IDs as
// Mongo's _id so every customerId/transporterId/vendorId cross-reference
// keeps resolving with zero remapping.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { env, assertRuntimeEnv } from '../config/env.js';
import { Customer } from '../models/Customer.js';
import { Vendor } from '../models/Vendor.js';
import { Transporter } from '../models/Transporter.js';
import { Challan } from '../models/Challan.js';
import { Inward } from '../models/Inward.js';
import { Transport } from '../models/Transport.js';
import { Counter } from '../models/Counter.js';

const DATA_DIR = path.join(process.cwd(), 'migration-data');

const BRANCH_PREFIX: Record<string, string> = { bhuleshwar: 'BH', 'masjid-bunder': 'MB' };

// Recursively turns any ISO date string produced by the export step back
// into a real JS Date, so Mongo stores it natively instead of as a string.
const reviveDates = (value: unknown): unknown => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return new Date(value);
  }
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveDates(v);
    return out;
  }
  return value;
};

const loadCollection = (name: string): Record<string, unknown>[] => {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`  (skipping ${name} — ${file} not found. Run export-for-migration.js first.)`);
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
  return raw.map((doc) => reviveDates(doc) as Record<string, unknown>);
};

const importCollection = async (
  name: string,
  model: mongoose.Model<any>
): Promise<Record<string, unknown>[]> => {
  const docs = loadCollection(name);
  if (docs.length === 0) return docs;

  await model.deleteMany({}); // safe: only ever runs against staging/target Mongo, source Firestore untouched
  await model.insertMany(docs, { ordered: false });
  console.log(`  ${name.padEnd(14)} -> ${docs.length} documents imported`);
  return docs;
};

const run = async () => {
  assertRuntimeEnv();
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to Mongo (${mongoose.connection.name})\n`);

  const customers = await importCollection('customers', Customer);
  await importCollection('vendors', Vendor);
  await importCollection('transporters', Transporter);
  const challans = await importCollection('challans', Challan);
  await importCollection('inwards', Inward);
  await importCollection('transports', Transport);

  // Rebuild counters so new records created after cutover don't collide with
  // migrated IDs/numbers.
  const maxCustomerNum = Math.max(
    0,
    ...customers.map((c) => Number(String(c.customerId ?? '').replace(/\D/g, '')) || 0)
  );
  await Counter.findByIdAndUpdate('customers', { count: maxCustomerNum }, { upsert: true });

  const branchMax: Record<string, number> = {};
  for (const c of challans) {
    const branchId = String(c.branchId ?? '');
    const prefix = BRANCH_PREFIX[branchId] ?? branchId.slice(0, 2).toUpperCase();
    const num = Number(String(c.challanNo ?? '').replace(prefix, '')) || 0;
    branchMax[branchId] = Math.max(branchMax[branchId] ?? 0, num);
  }
  for (const [branchId, count] of Object.entries(branchMax)) {
    await Counter.findByIdAndUpdate(
      `challan:${branchId}`,
      { count, prefix: BRANCH_PREFIX[branchId] ?? branchId.slice(0, 2).toUpperCase() },
      { upsert: true }
    );
  }

  console.log('\nDone. Run `npm run migrate:verify` next to confirm counts match.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
