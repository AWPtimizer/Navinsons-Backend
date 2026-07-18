// One-time backfill: sets isActive: true on every existing document across
// all six collections. Needed because they were migrated from Firestore
// before the isActive field existed — without this, the new "only show
// isActive: true" filter on every list/search/download route would make
// all pre-existing data disappear from the app entirely.
// Safe to re-run — it's idempotent (only touches docs missing the field).
import mongoose from 'mongoose';
import { env, assertRuntimeEnv } from '../config/env.js';
import { Customer } from '../models/Customer.js';
import { Vendor } from '../models/Vendor.js';
import { Transporter } from '../models/Transporter.js';
import { Challan } from '../models/Challan.js';
import { Inward } from '../models/Inward.js';
import { Transport } from '../models/Transport.js';

const run = async () => {
  assertRuntimeEnv();
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to Mongo (${mongoose.connection.name})\n`);

  const models: [string, mongoose.Model<any>][] = [
    ['customers', Customer],
    ['vendors', Vendor],
    ['transporters', Transporter],
    ['challans', Challan],
    ['inwards', Inward],
    ['transports', Transport],
  ];

  for (const [name, model] of models) {
    const result = await model.updateMany(
      { isActive: { $exists: false } },
      { $set: { isActive: true } }
    );
    console.log(`  ${name.padEnd(14)} -> ${result.modifiedCount} documents backfilled`);
  }

  console.log('\nDone.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
