// Step 4 of the migration (01-migration-plan.md §6): count reconciliation.
// Compares what's actually in Mongo against the JSON snapshot that was
// imported, collection by collection. Run this right after
// migrateFirestoreToMongo.ts — if it reports anything but exact matches,
// do not treat the migration as complete.
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

const DATA_DIR = path.join(process.cwd(), 'migration-data');

const expectedCount = (name: string): number => {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return -1;
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[]).length;
};

const run = async () => {
  assertRuntimeEnv();
  await mongoose.connect(env.mongoUri);

  const checks: [string, mongoose.Model<any>][] = [
    ['customers', Customer],
    ['vendors', Vendor],
    ['transporters', Transporter],
    ['challans', Challan],
    ['inwards', Inward],
    ['transports', Transport],
  ];

  console.log('Collection'.padEnd(16) + 'Expected'.padEnd(12) + 'In Mongo'.padEnd(12) + 'Status');
  console.log('-'.repeat(50));

  let allMatch = true;
  for (const [name, model] of checks) {
    const expected = expectedCount(name);
    const actual = await model.countDocuments({});
    const ok = expected === actual;
    if (!ok) allMatch = false;
    console.log(
      name.padEnd(16) + String(expected).padEnd(12) + String(actual).padEnd(12) + (ok ? 'OK' : 'MISMATCH')
    );
  }

  console.log('\n' + (allMatch ? 'All counts match. Migration verified clean.' : 'MISMATCH FOUND — do not proceed to cutover until this is resolved.'));
  process.exit(allMatch ? 0 : 1);
};

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
