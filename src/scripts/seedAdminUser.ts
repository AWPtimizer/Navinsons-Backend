// Creates a login account in the new in-house auth system. Firebase never
// exposes password hashes in a portable format (01-migration-plan.md §2),
// so the 2-3 real accounts need fresh passwords set here rather than an
// automated carry-over.
//
// Usage: npm run seed:admin-user -- <email> <password> [displayName] [branchId]
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { env, assertRuntimeEnv } from '../config/env.js';
import { User } from '../models/User.js';

const [, , email, password, displayName, branchId] = process.argv;

if (!email || !password) {
  console.error('Usage: npm run seed:admin-user -- <email> <password> [displayName] [branchId]');
  process.exit(1);
}

const run = async () => {
  assertRuntimeEnv();
  await mongoose.connect(env.mongoUri);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { email: email.toLowerCase(), passwordHash, displayName, branchId },
    { upsert: true, new: true }
  );

  console.log(`User ready: ${user.email} (id: ${user._id})`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Failed to seed user:', err);
  process.exit(1);
});
