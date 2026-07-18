import { Router } from 'express';
import { z } from 'zod';
import { Transporter } from '../models/Transporter.js';
import { nextCount } from '../models/Counter.js';
import { generateSearchKeywords } from '../utils/searchKeywords.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

const transporterInput = z.object({
  transporterName: z.string().min(1),
  contactNo: z.string().min(1),
  alternateNo: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = transporterInput.parse(req.body);
    await nextCount('transporters');
    const nameLower = data.transporterName.trim().toLowerCase();

    const doc = await Transporter.create({
      ...data,
      _transporterName: nameLower,
      _searchKeywords: generateSearchKeywords(nameLower),
    });

    res.status(201).json({ id: doc._id, message: 'Transporter record created successfully' });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();

    const filter: Record<string, unknown> = { isActive: true };
    if (search) filter._searchKeywords = search;

    // Matches the old app: searching sorts alphabetically, the plain list
    // sorts by most-recently-updated first.
    const sort: Record<string, 1 | -1> = search ? { _transporterName: 1 } : { updatedAt: -1 };
    const result = await paginate(Transporter, filter, page, size, sort);
    res.json(result);
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.query as string | undefined)?.trim().toLowerCase();
    const filter = query ? { isActive: true, _searchKeywords: query } : { isActive: true };
    const docs = await Transporter.find(filter).sort({ _transporterName: 1 }).limit(50).lean();
    res.json(docs);
  })
);

router.get(
  '/download',
  asyncHandler(async (_req, res) => {
    const docs = await Transporter.find({ isActive: true }).sort({ transporterName: 1 }).lean();
    await sendExcel(
      res,
      'Transporters Report',
      [
        { header: 'Transporter Name', key: 'transporterName', width: 40 },
        { header: 'Contact No.', key: 'contactNo', width: 15 },
        { header: 'Alternate No.', key: 'alternateNo', width: 15 },
      ],
      docs,
      `transporters_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Transporter.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Transporter not found');
    res.json(doc);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = transporterInput.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.transporterName) {
      update._transporterName = data.transporterName.trim().toLowerCase();
      update._searchKeywords = generateSearchKeywords(data.transporterName.trim().toLowerCase());
    }
    const doc = await Transporter.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) throw new HttpError(404, 'Transporter not found');
    res.json({ message: 'Transporter record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Transporter.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Transporter not found');
    res.json({ message: 'Transporter record deleted successfully' });
  })
);

export default router;
