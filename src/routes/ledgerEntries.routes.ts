import { Router } from 'express';
import { z } from 'zod';
import type { PipelineStage } from 'mongoose';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Customer } from '../models/Customer.js';
import { BankAccount } from '../models/BankAccount.js';
import { Challan } from '../models/Challan.js';
import { sendExcel } from '../utils/excel.js';
import { sendCustomerReminder } from '../utils/ledgerReminders.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';

const router = Router();

const addDays = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

// The per-customer rollup (totals + status) that both /summary and
// /download need — /summary shows it directly, /download uses it to figure
// out which customers match an active search/status filter before exporting
// their raw entries, so the two can never classify a customer differently.
const buildCustomerStatusPipeline = (entryMatch: Record<string, unknown>): PipelineStage[] => [
  { $match: entryMatch },
  {
    $group: {
      _id: '$customerId',
      totalDebit: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
      totalPayment: { $sum: { $cond: [{ $eq: ['$type', 'payment'] }, '$amount', 0] } },
      hasOverdue: {
        $max: {
          $cond: [
            {
              $and: [
                { $eq: ['$type', 'debit'] },
                { $eq: ['$reminderSent', false] },
                { $ne: ['$reminderDueDate', null] },
                { $lte: ['$reminderDueDate', today()] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },
  },
  { $addFields: { netOutstanding: { $subtract: ['$totalDebit', '$totalPayment'] } } },
  // A debit can be past its reminder date yet already fully paid off (by a
  // payment unrelated to that specific entry) — only worth flagging as
  // Overdue if the customer's overall outstanding balance is still > 0.
  { $addFields: { hasOverdue: { $and: ['$hasOverdue', { $gt: ['$netOutstanding', 0] }] } } },
  // One status per customer, mutually exclusive, checked in priority order —
  // same categories the "status" filter dropdown offers, so the badge shown
  // per row always matches what filtering by it would find.
  {
    $addFields: {
      status: {
        $switch: {
          branches: [
            { case: '$hasOverdue', then: 'overdue' },
            { case: { $lte: ['$netOutstanding', 0] }, then: 'settled' },
            { case: { $and: [{ $eq: ['$totalPayment', 0] }, { $gt: ['$netOutstanding', 0] }] }, then: 'pending' },
          ],
          // Some payment has come in, but not enough to clear the balance,
          // and it's not overdue yet — a normal in-progress state.
          default: 'partial',
        },
      },
    },
  },
  { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
  { $unwind: '$customer' },
];

const baseFields = {
  customerId: z.string().min(1),
  branchId: z.string().optional(),
  amount: z.number().positive(),
  date: z.string().min(1),
  referenceNo: z.string().min(1),
  // Optional link to the shipment this transaction relates to — same
  // "link an existing challan or create one inline" pattern as Outwards.
  challanId: z.string().optional(),
};

const createLedgerEntryInput = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('debit'),
      ...baseFields,
      reminderPeriodDays: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal('payment'),
      ...baseFields,
      modeOfPayment: z.enum(['cash', 'bank']),
      bankAccountId: z.string().optional(),
    }),
  ])
  .refine((data) => data.type !== 'payment' || data.modeOfPayment !== 'bank' || !!data.bankAccountId, {
    message: 'Bank account is required when mode of payment is bank',
    path: ['bankAccountId'],
  });

const updateLedgerEntryInput = z.object({
  customerId: z.string().min(1).optional(),
  branchId: z.string().optional(),
  amount: z.number().positive().optional(),
  date: z.string().min(1).optional(),
  referenceNo: z.string().min(1).optional(),
  reminderPeriodDays: z.number().int().positive().optional(),
  modeOfPayment: z.enum(['cash', 'bank']).optional(),
  bankAccountId: z.string().optional(),
  challanId: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = createLedgerEntryInput.parse(req.body);

    const doc: Record<string, unknown> = {
      type: data.type,
      customerId: data.customerId,
      branchId: data.branchId,
      amount: data.amount,
      date: data.date,
      referenceNo: data.referenceNo,
      challanId: data.challanId,
      createdBy: req.user?.id,
    };

    if (data.type === 'debit') {
      if (data.reminderPeriodDays) {
        doc.reminderPeriodDays = data.reminderPeriodDays;
        doc.reminderDueDate = addDays(data.date, data.reminderPeriodDays);
      }
    } else {
      doc.modeOfPayment = data.modeOfPayment;
      if (data.modeOfPayment === 'bank') doc.bankAccountId = data.bankAccountId;
    }

    const created = await LedgerEntry.create(doc);
    res.status(201).json({ id: created._id, message: 'Ledger entry created successfully' });
  })
);

// Per-customer summary — grouped by customerId via aggregation rather than
// paginate() (which only supports a flat find+count, not a grouped rollup).
// grandTotal* is computed over the ENTIRE filtered set, not just the visible
// page, so it stays correct regardless of which page the user is viewing.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const isAdmin = req.query.admin === 'true';
    const branchId = req.query.branchId as string | undefined;
    // 'overdue' | 'settled' | 'pending' | undefined ('all', no filter)
    const status = req.query.status as string | undefined;

    const entryMatch: Record<string, unknown> = { isActive: true };
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, string> = {};
      if (dateFrom) dateFilter.$gte = dateFrom;
      if (dateTo) dateFilter.$lte = dateTo;
      entryMatch.date = dateFilter;
    }
    if (!isAdmin && branchId) entryMatch.branchId = branchId;

    const basePipeline = buildCustomerStatusPipeline(entryMatch);

    if (status && status !== 'all') {
      basePipeline.push({ $match: { status } });
    }

    if (search) {
      basePipeline.push({
        $match: {
          $or: [
            { 'customer._searchKeywords': search },
            { 'customer.customerId': { $regex: search, $options: 'i' } },
            { 'customer.contactNo': { $regex: search, $options: 'i' } },
          ],
        },
      });
    }

    const countPipeline: PipelineStage[] = [...basePipeline, { $count: 'total' }];
    const grandTotalPipeline: PipelineStage[] = [
      ...basePipeline,
      {
        $group: {
          _id: null,
          grandTotalDebit: { $sum: '$totalDebit' },
          grandTotalPayment: { $sum: '$totalPayment' },
          grandTotalOutstanding: { $sum: '$netOutstanding' },
        },
      },
    ];
    const dataPipeline: PipelineStage[] = [
      ...basePipeline,
      { $sort: { 'customer._customerName': 1 } },
      { $skip: (page - 1) * size },
      { $limit: size },
      {
        $project: {
          _id: 0,
          customerId: '$_id',
          customerName: '$customer.customerName',
          customerCode: '$customer.customerId',
          customerContactNo: '$customer.contactNo',
          totalDebit: 1,
          totalPayment: 1,
          netOutstanding: 1,
          hasOverdue: 1,
          status: 1,
        },
      },
    ];

    const [records, countResult, grandTotalResult] = await Promise.all([
      LedgerEntry.aggregate(dataPipeline),
      LedgerEntry.aggregate(countPipeline),
      LedgerEntry.aggregate(grandTotalPipeline),
    ]);

    const totalRecords = countResult[0]?.total ?? 0;
    const grand = grandTotalResult[0] ?? {
      grandTotalDebit: 0,
      grandTotalPayment: 0,
      grandTotalOutstanding: 0,
    };

    res.json({
      records,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / size)),
      currentPage: page,
      grandTotalDebit: grand.grandTotalDebit,
      grandTotalPayment: grand.grandTotalPayment,
      grandTotalOutstanding: grand.grandTotalOutstanding,
    });
  })
);

// A customer's full chronological ledger. Totals (and the running balance)
// are computed purely from whatever the current date filter shows — same
// convention as the summary listing's Grand Total row — rather than an
// accounting-style Opening Balance carried in from before the filter, which
// tested as more confusing than useful for non-accounting staff.
router.get(
  '/customer/:customerId',
  asyncHandler(async (req, res) => {
    const { customerId } = req.params;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const customer = await Customer.findOne({ _id: customerId, isActive: true }).lean();
    if (!customer) throw new HttpError(404, 'Customer not found');

    const entryFilter: Record<string, unknown> = { customerId, isActive: true };
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, string> = {};
      if (dateFrom) dateFilter.$gte = dateFrom;
      if (dateTo) dateFilter.$lte = dateTo;
      entryFilter.date = dateFilter;
    }

    const entries = await LedgerEntry.find(entryFilter).sort({ date: 1, createdAt: 1 }).lean();

    const bankAccountIds = [...new Set(entries.map((e) => e.bankAccountId).filter(Boolean))] as string[];
    const bankAccounts = await BankAccount.find({ _id: { $in: bankAccountIds } }).lean();
    const bankMap = new Map(bankAccounts.map((b) => [b._id, b.accountLabel]));

    const challanIds = [...new Set(entries.map((e) => e.challanId).filter(Boolean))] as string[];
    const challans = await Challan.find({ _id: { $in: challanIds } }).lean();
    const challanMap = new Map(challans.map((c) => [c._id, c.challanNo]));

    let running = 0;
    let totalDebit = 0;
    let totalPayment = 0;
    const rows = entries.map((entry) => {
      if (entry.type === 'debit') {
        running += entry.amount;
        totalDebit += entry.amount;
      } else {
        running -= entry.amount;
        totalPayment += entry.amount;
      }
      return {
        ...entry,
        bankAccountLabel: entry.bankAccountId ? bankMap.get(entry.bankAccountId) : undefined,
        challanNo: entry.challanId ? challanMap.get(entry.challanId) : undefined,
        runningBalance: running,
      };
    });

    res.json({
      customer,
      totalDebit,
      totalPayment,
      netOutstanding: totalDebit - totalPayment,
      entries: rows,
    });
  })
);

router.post(
  '/customer/:customerId/send-reminder',
  asyncHandler(async (req, res) => {
    const result = await sendCustomerReminder(req.params.customerId);
    if (!result.sent) {
      throw new HttpError(400, result.error ?? 'Could not send reminder');
    }
    res.json({ message: 'Reminder sent successfully', outstanding: result.outstanding });
  })
);

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const status = req.query.status as string | undefined;

    const dateFilter: Record<string, string> = {};
    if (dateFrom) dateFilter.$gte = dateFrom;
    if (dateTo) dateFilter.$lte = dateTo;

    const filter: Record<string, unknown> = { isActive: true };
    if (customerId) filter.customerId = customerId;
    if (dateFrom || dateTo) filter.date = dateFilter;

    // search/status are per-customer classifications (same as the summary
    // listing), not a property of a single entry — resolve which customers
    // match first, using the identical rollup logic /summary uses, then
    // constrain the entries export to just those customers' rows.
    if (search || (status && status !== 'all')) {
      const entryMatch: Record<string, unknown> = { isActive: true };
      if (dateFrom || dateTo) entryMatch.date = dateFilter;

      const pipeline = buildCustomerStatusPipeline(entryMatch);
      if (status && status !== 'all') pipeline.push({ $match: { status } });
      if (search) {
        pipeline.push({
          $match: {
            $or: [
              { 'customer._searchKeywords': search },
              { 'customer.customerId': { $regex: search, $options: 'i' } },
              { 'customer.contactNo': { $regex: search, $options: 'i' } },
            ],
          },
        });
      }
      pipeline.push({ $project: { _id: 0, customerId: '$_id' } });

      const matches: { customerId: string }[] = await LedgerEntry.aggregate(pipeline);
      filter.customerId = customerId ?? { $in: matches.map((m) => m.customerId) };
    }

    const entries = await LedgerEntry.find(filter).sort({ customerId: 1, date: 1 }).lean();

    const customerIds = [...new Set(entries.map((e) => e.customerId))];
    const customers = await Customer.find({ _id: { $in: customerIds } }).lean();
    const customerMap = new Map(customers.map((c) => [c._id, c]));

    const bankAccountIds = [...new Set(entries.map((e) => e.bankAccountId).filter(Boolean))] as string[];
    const bankAccounts = await BankAccount.find({ _id: { $in: bankAccountIds } }).lean();
    const bankMap = new Map(bankAccounts.map((b) => [b._id, b]));

    const challanIds = [...new Set(entries.map((e) => e.challanId).filter(Boolean))] as string[];
    const challans = await Challan.find({ _id: { $in: challanIds } }).lean();
    const challanMap = new Map(challans.map((c) => [c._id, c.challanNo]));

    const rows = entries.map((e) => ({
      customerName: customerMap.get(e.customerId)?.customerName ?? '',
      customerCode: customerMap.get(e.customerId)?.customerId ?? '',
      type: e.type === 'debit' ? 'Credit Given' : 'Payment Received',
      amount: e.amount,
      date: e.date,
      referenceNo: e.referenceNo,
      challanNo: e.challanId ? (challanMap.get(e.challanId) ?? '') : '',
      modeOfPayment: e.modeOfPayment
        ? e.modeOfPayment === 'bank'
          ? (bankMap.get(e.bankAccountId ?? '')?.accountLabel ?? 'Bank')
          : 'Cash'
        : '',
    }));

    await sendExcel(
      res,
      'Ledger Entries',
      [
        { header: 'Customer Name', key: 'customerName', width: 40 },
        { header: 'Customer ID', key: 'customerCode', width: 15 },
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Reference No.', key: 'referenceNo', width: 20 },
        { header: 'Challan No.', key: 'challanNo', width: 20 },
        { header: 'Mode of Payment', key: 'modeOfPayment', width: 20 },
      ],
      rows,
      `ledger_entries_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await LedgerEntry.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Ledger entry not found');
    res.json(doc);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await LedgerEntry.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!existing) throw new HttpError(404, 'Ledger entry not found');

    const data = updateLedgerEntryInput.parse(req.body);

    if (existing.type === 'payment' && data.modeOfPayment === 'bank' && !data.bankAccountId && !existing.bankAccountId) {
      throw new HttpError(400, 'Bank account is required when mode of payment is bank');
    }

    const update: Record<string, unknown> = { ...data, updatedBy: req.user?.id, updatedAt: new Date() };

    if (existing.type === 'debit') {
      const newDate = data.date ?? existing.date;
      const newPeriod = data.reminderPeriodDays ?? existing.reminderPeriodDays;
      if (newPeriod) {
        update.reminderDueDate = addDays(newDate, newPeriod);
        // Date or period changed -> the old one-time trigger no longer
        // reflects reality, so let it fire again against the new due date.
        if (data.date !== undefined || data.reminderPeriodDays !== undefined) {
          update.reminderSent = false;
          update.reminderSentAt = null;
        }
      } else {
        update.reminderDueDate = null;
      }
    }

    await LedgerEntry.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ message: 'Ledger entry updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await LedgerEntry.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Ledger entry not found');
    res.json({ message: 'Ledger entry deleted successfully' });
  })
);

export default router;
