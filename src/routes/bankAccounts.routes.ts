import { Router } from 'express';
import { z } from 'zod';
import { BankAccount } from '../models/BankAccount.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

const bankAccountInput = z.object({
  bankName: z.string().min(1),
  accountLabel: z.string().min(1),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = bankAccountInput.parse(req.body);
    const doc = await BankAccount.create(data);
    res.status(201).json({ id: doc._id, message: 'Bank account created successfully' });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim();

    const filter: Record<string, unknown> = { isActive: true };
    if (search) {
      filter.$or = [
        { accountLabel: { $regex: search, $options: 'i' } },
        { bankName: { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginate(BankAccount, filter, page, size, { updatedAt: -1 });
    res.json(result);
  })
);

// Typeahead source for the Ledger's Mode of Payment -> Bank Account picker.
// Plain regex match (not a _searchKeywords index) since this list is small
// by nature — a business has a handful of bank accounts, not thousands.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.query as string | undefined)?.trim();
    const filter: Record<string, unknown> = { isActive: true };
    if (query) {
      filter.$or = [
        { accountLabel: { $regex: query, $options: 'i' } },
        { bankName: { $regex: query, $options: 'i' } },
      ];
    }
    const docs = await BankAccount.find(filter).sort({ accountLabel: 1 }).limit(50).lean();
    res.json(docs);
  })
);

router.get(
  '/download',
  asyncHandler(async (_req, res) => {
    const docs = await BankAccount.find({ isActive: true }).sort({ accountLabel: 1 }).lean();
    await sendExcel(
      res,
      'Bank Accounts',
      [
        { header: 'Account Label', key: 'accountLabel', width: 30 },
        { header: 'Bank Name', key: 'bankName', width: 30 },
        { header: 'Account No.', key: 'accountNumber', width: 20 },
        { header: 'IFSC Code', key: 'ifscCode', width: 15 },
      ],
      docs,
      `bank_accounts_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await BankAccount.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Bank account not found');
    res.json(doc);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = bankAccountInput.partial().parse(req.body);
    const doc = await BankAccount.findByIdAndUpdate(req.params.id, { ...data, updatedAt: new Date() }, { new: true });
    if (!doc) throw new HttpError(404, 'Bank account not found');
    res.json({ message: 'Bank account updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await BankAccount.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Bank account not found');
    res.json({ message: 'Bank account deleted successfully' });
  })
);

export default router;
