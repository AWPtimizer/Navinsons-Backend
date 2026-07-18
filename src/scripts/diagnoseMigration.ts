// Diagnostic-only: finds out WHY some documents failed validation during
// import, instead of guessing. Doesn't write anything.
import fs from 'fs';
import path from 'path';
import { Customer } from '../models/Customer.js';
import { Transporter } from '../models/Transporter.js';
import { Challan } from '../models/Challan.js';
import { Transport } from '../models/Transport.js';

const DATA_DIR = path.join(process.cwd(), 'migration-data');

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

const check = (name: string, model: any) => {
  const docs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8')).map(reviveDates);
  const fieldCounts: Record<string, number> = {};
  let failCount = 0;

  for (const raw of docs) {
    const doc = new model(raw);
    const err = doc.validateSync();
    if (err) {
      failCount++;
      for (const field of Object.keys(err.errors)) {
        fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
      }
    }
  }

  console.log(`\n${name}: ${failCount} of ${docs.length} fail validation`);
  for (const [field, count] of Object.entries(fieldCounts)) {
    console.log(`  missing/invalid "${field}": ${count} documents`);
  }
};

check('customers', Customer);
check('transporters', Transporter);
check('challans', Challan);
check('transports', Transport);

process.exit(0);
