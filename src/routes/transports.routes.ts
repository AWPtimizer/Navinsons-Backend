import { Router } from 'express';
import { z } from 'zod';
import { Transport } from '../models/Transport.js';
import { Customer } from '../models/Customer.js';
import { Transporter } from '../models/Transporter.js';
import { Challan } from '../models/Challan.js';
import { nextCount } from '../models/Counter.js';
import { paginate } from '../utils/paginate.js';
import { sendExcel } from '../utils/excel.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';

const router = Router();

const transportInput = z.object({
  lrNo: z.string().min(1),
  customerId: z.string().min(1),
  transporterId: z.string().min(1),
  branchId: z.string().min(1),
  noOfParcel: z.string().min(1),
  date: z.string().min(1),
  imageUrl: z.string().optional(),
  challanId: z.string().optional(),
});

// Trigger #1 of #2 — auto-sends WhatsApp on every create, same as the old
// backend. No confirmation step, matching original behavior exactly
// (01-migration-plan.md §7 / field reference "Known Quirks").
router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = transportInput.parse(req.body);
    await nextCount('transports');

    const doc = await Transport.create({ ...data, createdBy: req.user?.id });

    try {
      const [customer, transporter] = await Promise.all([
        Customer.findById(data.customerId).lean(),
        Transporter.findById(data.transporterId).lean(),
      ]);
      if (customer?.contactNo && transporter?.contactNo) {
        let transportPhoneNo = transporter.contactNo;
        if (transporter.alternateNo) transportPhoneNo += `, ${transporter.alternateNo}`;
        await sendWhatsAppMessage(
          { phoneNo: customer.contactNo, lrNo: data.lrNo, transportName: transporter.transporterName, transportPhoneNo },
          data.branchId
        );
      } else {
        console.log(`Skipped WhatsApp send for transport ${doc._id} — customer or transporter has no contactNo on file.`);
      }
    } catch (err) {
      console.error('WhatsApp auto-send failed (transport record still saved):', err);
    }

    res.status(201).json({ id: doc._id, message: 'Transport record created successfully' });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 10);
    const isAdmin = req.query.admin === 'true';
    const branchId = req.query.branchId as string | undefined;
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const transporterId = req.query.transporterId as string | undefined;

    const filter: Record<string, unknown> = { isActive: true };

    // Outward records have no name of their own to search — the old app
    // resolves the search term against Customers first, then Transporters,
    // and filters transports by whichever one matched. Ported as-is.
    if (search) {
      const matchingCustomers = await Customer.find({ isActive: true, _searchKeywords: search })
        .select('_id')
        .lean();
      if (matchingCustomers.length > 0) {
        filter.customerId = { $in: matchingCustomers.map((c) => c._id) };
      } else {
        const matchingTransporters = await Transporter.find({ isActive: true, _searchKeywords: search })
          .select('_id')
          .lean();
        filter.transporterId =
          matchingTransporters.length > 0 ? { $in: matchingTransporters.map((t) => t._id) } : null;
      }
    }

    if (!isAdmin && branchId) filter.branchId = branchId;
    // Explicit filter dropdown takes priority over whatever the search box
    // may have derived for transporterId above.
    if (transporterId) filter.transporterId = transporterId;
    if (dateFrom || dateTo) {
      filter.date = {
        ...(dateFrom ? { $gte: dateFrom } : {}),
        ...(dateTo ? { $lte: dateTo } : {}),
      };
    }

    const { records, totalRecords, totalPages, currentPage } = await paginate(
      Transport,
      filter,
      page,
      size,
      { createdAt: -1 }
    );

    const customerIds = [...new Set(records.map((r) => r.customerId))];
    const transporterIds = [...new Set(records.map((r) => r.transporterId))];
    const [customers, transporters] = await Promise.all([
      Customer.find({ _id: { $in: customerIds } }).lean(),
      Transporter.find({ _id: { $in: transporterIds } }).lean(),
    ]);
    const customerMap = new Map(customers.map((c) => [c._id, c.customerName]));
    const transporterMap = new Map(transporters.map((t) => [t._id, t.transporterName]));

    res.json({
      records: records.map((r) => ({
        ...r,
        customerName: customerMap.get(r.customerId) ?? 'Unknown',
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
  asyncHandler(async (_req, res) => {
    const docs = await Transport.find({ isActive: true }).sort({ date: -1 }).lean();
    const customerIds = [...new Set(docs.map((d) => d.customerId))];
    const transporterIds = [...new Set(docs.map((d) => d.transporterId))];
    const [customers, transporters] = await Promise.all([
      Customer.find({ _id: { $in: customerIds } }).lean(),
      Transporter.find({ _id: { $in: transporterIds } }).lean(),
    ]);
    const customerMap = new Map(customers.map((c) => [c._id, c.customerName]));
    const transporterMap = new Map(transporters.map((t) => [t._id, t.transporterName]));

    const rows = docs.map((d) => ({
      ...d,
      customerName: customerMap.get(d.customerId) ?? 'Unknown',
      transporterName: transporterMap.get(d.transporterId) ?? 'Unknown',
    }));

    await sendExcel(
      res,
      'Outwards',
      [
        { header: 'LR No.', key: 'lrNo', width: 15 },
        { header: 'Customer Name', key: 'customerName', width: 30 },
        { header: 'Transporter Name', key: 'transporterName', width: 30 },
        { header: 'Transport Date', key: 'date', width: 20 },
        { header: 'No. of Parcel', key: 'noOfParcel', width: 20 },
      ],
      rows,
      `outwards_${Date.now()}.xlsx`
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Transport.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!doc) throw new HttpError(404, 'Transport record not found');

    const [customer, transporter, challan] = await Promise.all([
      Customer.findById(doc.customerId).lean(),
      Transporter.findById(doc.transporterId).lean(),
      doc.challanId ? Challan.findById(doc.challanId).lean() : Promise.resolve(null),
    ]);

    res.json({
      ...doc,
      customerName: customer?.customerName ?? 'Unknown',
      transporterName: transporter?.transporterName ?? 'Unknown',
      challanNo: challan?.challanNo,
    });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = transportInput.partial().parse(req.body);
    const doc = await Transport.findByIdAndUpdate(
      req.params.id,
      { ...data, updatedBy: req.user?.id },
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Transport record not found');
    res.json({ message: 'Transport record updated successfully' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Transport.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!doc) throw new HttpError(404, 'Transport record not found');
    res.json({ message: 'Transport record deleted successfully' });
  })
);

// Trigger #2 of #2 — manual (re)send for one existing record.
router.post(
  '/send-whatsapp-message/:transportId/:branchId',
  asyncHandler(async (req, res) => {
    const { transportId, branchId } = req.params;

    const transport = await Transport.findById(transportId).lean();
    if (!transport) throw new HttpError(404, 'Transport record not found');

    const [customer, transporter] = await Promise.all([
      Customer.findById(transport.customerId).lean(),
      Transporter.findById(transport.transporterId).lean(),
    ]);
    if (!transporter) throw new HttpError(404, 'Transporter record not found');
    if (!customer) throw new HttpError(404, 'Customer record not found');
    if (!customer.contactNo) throw new HttpError(400, 'Customer contact number is missing.');
    if (!transporter.contactNo) throw new HttpError(400, 'Transporter contact number is missing.');

    const whatsappResponse = await sendWhatsAppMessage(
      {
        phoneNo: customer.contactNo,
        lrNo: transport.lrNo,
        transportName: transporter.transporterName,
        transportPhoneNo: transporter.contactNo,
      },
      branchId
    );

    const messageId = whatsappResponse?.messages?.[0]?.id;
    await Transport.findByIdAndUpdate(transportId, {
      whatsappStatus: messageId ? 'pending' : 'failed',
      whatsappMessageId: messageId || undefined,
    });

    res.json({
      message: 'WhatsApp message sent successfully.',
      whatsappStatus: messageId ? 'pending' : 'failed',
      whatsappMessageId: messageId || null,
    });
  })
);

// Webhook handlers live in whatsappWebhook.routes.ts instead of here — they
// must stay unprotected (Meta calls them with no user session), so they
// can't share this router once requireAuth gets applied to the whole
// /api/transports mount in app.ts.

export default router;
