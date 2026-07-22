import { Router } from 'express';
import { z } from 'zod';
import { Vendor } from '../models/Vendor.js';
import { nextCount } from '../models/Counter.js';
import { generateSearchKeywords } from '../utils/searchKeywords.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

const vendorInput = z.object({
  vendorName: z.string().min(1),
  contactNo: z.string().min(1),
  alternateNo: z.string().optional(),
  address: z.string().optional(),
  gstNo: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = vendorInput.parse(req.body);
    await nextCount('vendors'); // kept for parity with the old sequence counter, even though vendorId isn't surfaced in the UI
    const nameLower = data.vendorName.trim().toLowerCase();

    const doc = await Vendor.create({
      ...data,
      _vendorName: nameLower,
      _searchKeywords: generateSearchKeywords(nameLower),
    });

    res.status(201).json({ id: doc._id, message: 'Vendor record created successfully' });
  })
);

// Shared by the list and download endpoints so a filter can never drift
// between what's shown on screen and what gets exported.
const buildListFilter = (req: { query: Record<string, unknown> }) => {
  const search = (req.query.search as string | undefined)?.trim().toLowerCase();
  const filter: Record<string, unknown> = { isActive: true };
  if (search) filter._searchKeywords = search;
  return filter;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim();

    const filter = buildListFilter(req);
    // Matches the old app: searching sorts alphabetically, the plain list
    // sorts by most-recently-updated first.
    const sort: Record<string, 1 | -1> = search ? { _vendorName: 1 } : { updatedAt: -1 };
    const result = await paginate(Vendor, filter, page, size, sort);
    res.json(result);
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.query as string | undefined)?.trim().toLowerCase();
    const filter = query ? { isActive: true, _searchKeywords: query } : { isActive: true };
    const docs = await Vendor.find(filter).sort({ _vendorName: 1 }).limit(50).lean();
    res.json(docs);
  })
);

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    const filter = buildListFilter(req);
    const docs = await Vendor.find(filter).sort({ vendorName: 1 }).lean();
    await sendExcel(
      res,
      'Vendors Report',
      [
        { header: 'Vendor Name', key: 'vendorName', width: 40 },
        { header: 'Contact No.', key: 'contactNo', width: 15 },
        { header: 'Alternate No.', key: 'alternateNo', width: 15 },
        { header: 'Address', key: 'address', width: 80 },
        { header: 'GST No.', key: 'gstNo', width: 20 },
      ],
      docs,
      `vendors_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Vendor.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Vendor not found');
    res.json(doc);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = vendorInput.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.vendorName) {
      update._vendorName = data.vendorName.trim().toLowerCase();
      update._searchKeywords = generateSearchKeywords(data.vendorName.trim().toLowerCase());
    }
    const doc = await Vendor.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) throw new HttpError(404, 'Vendor not found');
    res.json({ message: 'Vendor record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Vendor.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Vendor not found');
    res.json({ message: 'Vendor record deleted successfully' });
  })
);

export default router;
