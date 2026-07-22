import { Router } from 'express';
import { z } from 'zod';
import { Inward } from '../models/Inward.js';
import { Vendor } from '../models/Vendor.js';
import { Transporter } from '../models/Transporter.js';
import { nextCount } from '../models/Counter.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

const inwardInput = z.object({
  lrNo: z.string().min(1),
  vendorId: z.string().min(1),
  transporterId: z.string().min(1),
  branchId: z.string().optional(),
  noOfParcel: z.string().min(1),
  transportCharges: z.string().optional(),
  date: z.string().min(1),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = inwardInput.parse(req.body);
    await nextCount('inwards');
    const doc = await Inward.create(data);
    res.status(201).json({ id: doc._id, message: 'Inward record created successfully' });
  })
);

// Shared by the list and download endpoints so a filter can never drift
// between what's shown on screen and what gets exported.
const buildListFilter = async (req: { query: Record<string, unknown> }) => {
  const isAdmin = req.query.admin === 'true';
  const branchId = req.query.branchId as string | undefined;
  const search = (req.query.search as string | undefined)?.trim().toLowerCase();
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const transporterId = req.query.transporterId as string | undefined;

  const filter: Record<string, unknown> = { isActive: true };

  // Search by Vendor name OR Transporter name (the old app never had this
  // at all — added per request, not a parity fix).
  if (search) {
    const [matchingVendors, matchingTransporters] = await Promise.all([
      Vendor.find({ isActive: true, _searchKeywords: search }).select('_id').lean(),
      Transporter.find({ isActive: true, _searchKeywords: search }).select('_id').lean(),
    ]);
    const vendorIds = matchingVendors.map((v) => v._id);
    const transporterIds = matchingTransporters.map((t) => t._id);
    filter.$or = [{ vendorId: { $in: vendorIds } }, { transporterId: { $in: transporterIds } }];
  }

  if (!isAdmin && branchId) filter.branchId = branchId;
  if (transporterId) filter.transporterId = transporterId;
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

    const filter = await buildListFilter(req);
    const { records, totalRecords, totalPages, currentPage } = await paginate(
      Inward,
      filter,
      page,
      size,
      { createdAt: -1 }
    );

    const vendorIds = [...new Set(records.map((r) => r.vendorId))];
    const transporterIds = [...new Set(records.map((r) => r.transporterId))];
    const [vendors, transporters] = await Promise.all([
      Vendor.find({ _id: { $in: vendorIds } }).lean(),
      Transporter.find({ _id: { $in: transporterIds } }).lean(),
    ]);
    const vendorMap = new Map(vendors.map((v) => [v._id, v.vendorName]));
    const transporterMap = new Map(transporters.map((t) => [t._id, t.transporterName]));

    res.json({
      records: records.map((r) => ({
        ...r,
        vendorName: vendorMap.get(r.vendorId) ?? 'Unknown',
        transporterName: transporterMap.get(r.transporterId) ?? 'Unknown',
      })),
      totalRecords,
      totalPages,
      currentPage,
    });
  })
);

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    const filter = await buildListFilter(req);
    const docs = await Inward.find(filter).sort({ createdAt: -1 }).lean();
    const vendorIds = [...new Set(docs.map((d) => d.vendorId))];
    const transporterIds = [...new Set(docs.map((d) => d.transporterId))];
    const [vendors, transporters] = await Promise.all([
      Vendor.find({ _id: { $in: vendorIds } }).lean(),
      Transporter.find({ _id: { $in: transporterIds } }).lean(),
    ]);
    const vendorMap = new Map(vendors.map((v) => [v._id, v.vendorName]));
    const transporterMap = new Map(transporters.map((t) => [t._id, t.transporterName]));

    const rows = docs.map((d) => ({
      ...d,
      vendorName: vendorMap.get(d.vendorId) ?? 'Unknown',
      transporterName: transporterMap.get(d.transporterId) ?? 'Unknown',
    }));

    await sendExcel(
      res,
      'Inwards Report',
      [
        { header: 'LR No.', key: 'lrNo', width: 15 },
        { header: 'Vendor Name', key: 'vendorName', width: 30 },
        { header: 'Transporter Name', key: 'transporterName', width: 30 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'No. of Parcel', key: 'noOfParcel', width: 15 },
        { header: 'Transport Charges', key: 'transportCharges', width: 20 },
      ],
      rows,
      `inwards_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Inward.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Inward not found');

    const [vendor, transporter] = await Promise.all([
      Vendor.findById(doc.vendorId).lean(),
      Transporter.findById(doc.transporterId).lean(),
    ]);

    res.json({
      ...doc,
      vendorName: vendor?.vendorName ?? 'Unknown',
      transporterName: transporter?.transporterName ?? 'Unknown',
    });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = inwardInput.partial().parse(req.body);
    const doc = await Inward.findByIdAndUpdate(
      req.params.id,
      { ...data, updatedAt: new Date() },
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Inward not found');
    res.json({ message: 'Inward record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Inward.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Inward not found');
    res.json({ message: 'Inward record deleted successfully' });
  })
);

export default router;
