import { Router } from 'express';
import { z } from 'zod';
import { Customer } from '../models/Customer.js';
import { nextCount } from '../models/Counter.js';
import { generateSearchKeywords } from '../utils/searchKeywords.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';

const router = Router();

const customerInput = z.object({
  customerName: z.string().min(1),
  contactNo: z.string().min(1),
  alternateNo: z.string().optional(),
  address: z.string().optional(),
  pincode: z.string().optional(),
  gstNo: z.string().optional(),
  branchId: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = customerInput.parse(req.body);

    const duplicate = await Customer.findOne({ contactNo: data.contactNo, isActive: true }).lean();
    if (duplicate) {
      throw new HttpError(409, `This contact number is already used by ${duplicate.customerName} (${duplicate.customerId}).`);
    }

    const n = await nextCount('customers');
    const customerId = `NS-${String(n).padStart(3, '0')}`;
    const nameLower = data.customerName.trim().toLowerCase();

    const doc = await Customer.create({
      ...data,
      customerId,
      _customerName: nameLower,
      _searchKeywords: generateSearchKeywords(nameLower),
      createdBy: req.user?.id,
    });

    res.status(201).json({ id: doc._id, customerId, message: 'Customer record created successfully' });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const isAdmin = req.query.admin === 'true';
    const branchId = req.query.branchId as string | undefined;

    const filter: Record<string, unknown> = { isActive: true };
    // Matches by name (via the prefix-keyword index) OR by Customer ID
    // (e.g. "NS-137" or just "137") — searching by ID wasn't possible before.
    if (search) {
      filter.$or = [{ _searchKeywords: search }, { customerId: { $regex: search, $options: 'i' } }];
    }
    if (!isAdmin && branchId) filter.branchId = branchId;

    // Matches the old app exactly: searching sorts alphabetically, the
    // plain list sorts by most-recently-updated first.
    const sort: Record<string, 1 | -1> = search ? { _customerName: 1 } : { updatedAt: -1 };
    const result = await paginate(Customer, filter, page, size, sort);
    res.json(result);
  })
);

// Type-ahead dropdown source. Empty query -> default browsable page instead
// of erroring, so the dropdown always shows something on open (not just
// after the user starts typing) — same fix we already validated on the old app.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.query as string | undefined)?.trim().toLowerCase();
    const filter: Record<string, unknown> = { isActive: true };
    // Same name-or-ID matching as the main list endpoint (e.g. "NS-137" or
    // just "137") — this typeahead only searched by name before, so picking
    // a customer by ID from the Challan/Outward "Customer" dropdown didn't work.
    if (query) {
      filter.$or = [{ _searchKeywords: query }, { customerId: { $regex: query, $options: 'i' } }];
    }
    const docs = await Customer.find(filter).sort({ _customerName: 1 }).limit(50).lean();
    res.json(docs);
  })
);

router.get(
  '/download',
  asyncHandler(async (_req, res) => {
    const docs = await Customer.find({ isActive: true }).sort({ customerName: 1 }).lean();
    await sendExcel(
      res,
      'Customers Report',
      [
        { header: 'Customer Name', key: 'customerName', width: 60 },
        { header: 'Customer ID', key: 'customerId', width: 15 },
        { header: 'Contact No.', key: 'contactNo', width: 15 },
        { header: 'Alternate No.', key: 'alternateNo', width: 15 },
        { header: 'Address', key: 'address', width: 100 },
        { header: 'Pincode', key: 'pincode', width: 10 },
        { header: 'GST No.', key: 'gstNo', width: 20 },
      ],
      docs,
      `customers_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Customer.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Customer not found');
    res.json(doc);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = customerInput.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data, updatedBy: req.user?.id, updatedAt: new Date() };
    if (data.customerName) {
      update._customerName = data.customerName.trim().toLowerCase();
      update._searchKeywords = generateSearchKeywords(data.customerName.trim().toLowerCase());
    }
    const doc = await Customer.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) throw new HttpError(404, 'Customer not found');
    res.json({ message: 'Customer record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    // Soft delete: marks isActive false rather than removing the document.
    // Filtered out of list/search/download views, recoverable in the
    // database if needed later.
    const doc = await Customer.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Customer not found');
    res.json({ message: 'Customer record deleted successfully' });
  })
);

export default router;
