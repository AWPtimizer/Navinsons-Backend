// One-time fix: the BH/MB branch prefixes challans.routes.ts used at launch
// were placeholders that were never actually confirmed against the old
// app's real numbering — the true historical sequence continues "NS-####"
// for bhuleshwar and "LLP-###" for masjid-bunder. This reseeds each
// branch's counter to the real max in-use number under its correct prefix,
// so the next challan created continues the real sequence instead of
// restarting under the wrong one. Safe to re-run.
import mongoose from 'mongoose';
import { env, assertRuntimeEnv } from '../config/env.js';
import { Counter } from '../models/Counter.js';
import { Challan } from '../models/Challan.js';

const BRANCH_PREFIX: Record<string, string> = { bhuleshwar: 'NS', 'masjid-bunder': 'LLP' };

const run = async () => {
  assertRuntimeEnv();
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to Mongo (${mongoose.connection.name})\n`);

  for (const [branchId, prefix] of Object.entries(BRANCH_PREFIX)) {
    const challans = await Challan.find({ branchId, challanNo: { $regex: `^${prefix}-?\\d+$` } })
      .select('challanNo')
      .lean();

    let max = 0;
    for (const c of challans) {
      const m = new RegExp(`^${prefix}-?(\\d+)$`).exec(c.challanNo ?? '');
      if (m) max = Math.max(max, Number(m[1]));
    }

    await Counter.findByIdAndUpdate(`challan:${branchId}`, { $set: { count: max, prefix } }, { upsert: true });
    console.log(`challan:${branchId} -> reset to count=${max}, prefix=${prefix} (next will be ${prefix}-${max + 1})`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
