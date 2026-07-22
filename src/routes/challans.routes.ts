import { Router } from 'express';
import { z } from 'zod';
import { Challan } from '../models/Challan.js';
import { Customer } from '../models/Customer.js';
import { Transporter } from '../models/Transporter.js';
import { nextCount } from '../models/Counter.js';
import { generateSearchKeywords } from '../utils/searchKeywords.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

// Real prefixes, confirmed against actual historical data: bhuleshwar
// continues "NS-####" (matches up to NS-2669), masjid-bunder continues
// "LLP-###" (matches up to LLP-672). The BH/MB placeholders this held
// before were never actually confirmed and produced numbers that didn't
// continue the real sequence.
const BRANCH_PREFIX: Record<string, string> = { bhuleshwar: 'NS', 'masjid-bunder': 'LLP' };

const challanInput = z.object({
  customerId: z.string().min(1),
  transporterId: z.string().optional(),
  transporterName: z.string().optional(),
  branchId: z.string().min(1),
  noOfParcel: z.string().min(1),
  date: z.string().min(1),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = challanInput.parse(req.body);
    const prefix = BRANCH_PREFIX[data.branchId] ?? data.branchId.slice(0, 2).toUpperCase();
    const n = await nextCount(`challan:${data.branchId}`, prefix);
    const challanNo = `${prefix}-${String(n).padStart(3, '0')}`;

    const doc = await Challan.create({
      ...data,
      challanNo,
      _challanKeywords: generateSearchKeywords(challanNo),
    });

    res.status(201).json({ id: doc._id, challanNo, message: 'Challan record created successfully' });
  })
);

// Shared by the list and download endpoints so a filter can never drift
// between what's shown on screen and what gets exported.
const buildListFilter = async (req: { query: Record<string, unknown> }) => {
  const search = (req.query.search as string | undefined)?.trim().toLowerCase();
  const isAdmin = req.query.admin === 'true';
  const branchId = req.query.branchId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const transporterId = req.query.transporterId as string | undefined;

  const filter: Record<string, unknown> = { isActive: true };

  // The old app resolves the search term against Customers first (same
  // pattern as Outwards), falling back to a challan-number match only if
  // no customer matched.
  if (search) {
    const matchingCustomers = await Customer.find({ isActive: true, _searchKeywords: search })
      .select('_id')
      .lean();
    if (matchingCustomers.length > 0) {
      filter.customerId = { $in: matchingCustomers.map((c) => c._id) };
    } else {
      filter._challanKeywords = search;
    }
  }

  if (!isAdmin && branchId) filter.branchId = branchId;
  if (transporterId) filter.transporterId = transporterId;
  // date is stored as a plain 'YYYY-MM-DD' string, so lexicographic
  // comparison already matches chronological order.
  if (dateFrom || dateTo) {
    filter.date = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }

  return filter;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim();

    const filter = await buildListFilter(req);
    // Matches the old app: searching sorts by challan number, the plain
    // list sorts by most-recently-created first.
    const sort: Record<string, 1 | -1> = search ? { challanNo: 1 } : { createdAt: -1 };
    const { records, totalRecords, totalPages, currentPage } = await paginate(
      Challan,
      filter,
      page,
      size,
      sort
    );

    const customerIds = [...new Set(records.map((r) => r.customerId))];
    const transporterIds = [...new Set(records.map((r) => r.transporterId).filter(Boolean))] as string[];
    const [customers, transporters] = await Promise.all([
      Customer.find({ _id: { $in: customerIds } }).lean(),
      Transporter.find({ _id: { $in: transporterIds } }).lean(),
    ]);
    const customerMap = new Map(customers.map((c) => [c._id, c]));
    const transporterMap = new Map(transporters.map((t) => [t._id, t.transporterName]));

    res.json({
      records: records.map((r) => ({
        ...r,
        customerName: customerMap.get(r.customerId)?.customerName ?? 'Unknown',
        customerContactNo: customerMap.get(r.customerId)?.contactNo ?? '-',
        transporterName: r.transporterName ?? transporterMap.get(r.transporterId ?? '') ?? 'Unknown',
      })),
      totalRecords,
      totalPages,
      currentPage,
    });
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.query as string | undefined)?.trim().toLowerCase();
    const customerId = req.query.customerId as string | undefined;

    const filter: Record<string, unknown> = { isActive: true };
    if (query) filter._challanKeywords = query;
    // Used by the Outward form to find/offer this customer's existing
    // challans to link, instead of the usual global challan-number search.
    if (customerId) filter.customerId = customerId;

    const sort: Record<string, 1 | -1> = query ? {} : { createdAt: -1 };
    const docs = await Challan.find(filter).sort(sort).limit(customerId ? 20 : 10).lean();
    res.json(docs);
  })
);

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    const filter = await buildListFilter(req);
    const docs = await Challan.find(filter).sort({ createdAt: -1 }).lean();
    const customerIds = [...new Set(docs.map((d) => d.customerId))];
    const customers = await Customer.find({ _id: { $in: customerIds } }).lean();
    const customerMap = new Map(customers.map((c) => [c._id, c]));

    const rows = docs.map((d) => ({
      ...d,
      customerName: customerMap.get(d.customerId)?.customerName ?? 'Unknown',
      customerContactNo: customerMap.get(d.customerId)?.contactNo ?? '-',
      customerAlternateNo: customerMap.get(d.customerId)?.alternateNo ?? '-',
    }));

    await sendExcel(
      res,
      'Challans Report',
      [
        { header: 'Challan No.', key: 'challanNo', width: 15 },
        { header: 'Customer Name', key: 'customerName', width: 30 },
        { header: 'Contact No.', key: 'customerContactNo', width: 20 },
        { header: 'Alternate No.', key: 'customerAlternateNo', width: 20 },
        { header: 'Date', key: 'date', width: 15 },
      ],
      rows,
      `challans_${Date.now()}.xlsx`
    );
  })
);

// Single-record detail with full customer/transporter info — used by the
// print view, which needs address/contact fields the list view doesn't.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Challan.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Challan not found');

    const [customer, transporter] = await Promise.all([
      Customer.findById(doc.customerId).lean(),
      doc.transporterId ? Transporter.findById(doc.transporterId).lean() : Promise.resolve(null),
    ]);

    res.json({
      ...doc,
      customerName: customer?.customerName ?? 'Unknown',
      customerContactNo: customer?.contactNo ?? '-',
      customerAlternateNo: customer?.alternateNo ?? '',
      customerAddress: customer?.address ?? '-',
      customerPincode: customer?.pincode ?? '-',
      transporterName: doc.transporterName ?? transporter?.transporterName ?? 'Unknown',
      transporterContactNo: transporter?.contactNo ?? '-',
    });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = challanInput.partial().parse(req.body);
    const doc = await Challan.findByIdAndUpdate(
      req.params.id,
      { ...data, updatedAt: new Date() },
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Challan not found');
    res.json({ message: 'Challan record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Challan.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Challan not found');
    res.json({ message: 'Challan record deleted successfully' });
  })
);

export default router;
