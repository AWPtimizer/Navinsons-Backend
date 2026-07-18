# Navin & Sons — Backend

Express + TypeScript + MongoDB API for Navin & Sons' internal transport/trading business admin app (Challans, Customers, Vendors, Transporters, Inwards, Outwards). Replaces the client's original Firebase/Firestore backend.

## Tech stack

- **Runtime:** Node.js 20+, TypeScript (ESM, `tsx` for dev)
- **Framework:** Express 4
- **Database:** MongoDB (Atlas) via Mongoose
- **Auth:** JWT in an httpOnly cookie (`jsonwebtoken` + `bcrypt`), no third-party auth provider
- **File uploads:** Cloudinary (via `multer` memory storage)
- **Excel export:** `exceljs`
- **WhatsApp:** Meta Graph API (`axios`) for the Outward dispatch notification
- **Address autocomplete:** Google Places API (New), with a free OpenStreetMap Nominatim fallback if no API key is configured
- **Validation:** `zod` on every write endpoint

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` — see the comments in `.env.example` for where each value comes from. At minimum you need `MONGODB_URI` and `JWT_SECRET` to start the server; everything else (WhatsApp, Cloudinary, Google Places) degrades gracefully or is only needed for that specific feature.

## Running

```bash
npm run dev      # tsx watch — auto-restarts on file changes, http://localhost:4000
npm run build    # tsc -> dist/
npm start        # node dist/server.js (run build first)
npm run lint
```

On startup you should see `[db] connected to MongoDB (...)` then `[server] listening on http://localhost:4000`. If it doesn't connect, `MONGODB_URI` is the first thing to check.

## Project structure

```
src/
  app.ts                 # Express app assembly — middleware + route mounting
  server.ts               # Entry point — connects DB, starts listening
  config/                 # env.ts (typed env vars), db.ts (mongoose connect)
  middleware/              # requireAuth, asyncHandler, errorHandler (HttpError)
  models/                  # Mongoose schemas — one per collection
  routes/                  # One file per resource, mounted in app.ts
  utils/                   # paginate, excel export, search keywords, id gen, whatsapp, cloudinary
  scripts/                 # One-off/maintenance scripts, run via `tsx src/scripts/<name>.ts`
```

## Data model

Six main collections, all following the same pattern:

| Collection | Model | Notes |
|---|---|---|
| Customers | `Customer` | `customerId` like `NS-1702`, sequential per `Counter` |
| Vendors | `Vendor` | Inward-side counterpart to Customers |
| Transporters | `Transporter` | Shared by Challans, Inwards, and Outwards |
| Challans | `Challan` | `challanNo` continues the real historical sequence per branch — `NS-####` for `bhuleshwar`, `LLP-###` for `masjid-bunder` (see `BRANCH_PREFIX` in `routes/challans.routes.ts`) |
| Inwards | `Inward` | Vendor → business, via a Transporter |
| Outwards | `Transport` (internally named to match the old app/DB) | Business → Customer, via a Transporter. Optionally links to a `Challan` (`challanId`) and triggers an automatic WhatsApp send on create |

Other collections: `User` (login accounts), `Counter` (atomic sequence generator behind `nextCount()` — powers `customerId`, `challanNo`, etc.).

**Soft delete:** nothing is ever hard-deleted. Every collection has `isActive: boolean`; `DELETE` routes just flip it to `false`. List/search/download endpoints filter to `isActive: true`, but a record referenced by another (e.g. a Transporter used on old Challans) still resolves correctly for historical display even after being "deleted" — only new-record dropdowns stop offering it.

**IDs:** all `_id` fields are strings (`utils/id.ts`), not ObjectIds — this was required to preserve the original Firestore document IDs 1:1 during migration, so historical references never needed remapping.

## Scripts

```bash
npm run migrate:firestore-to-mongo   # one-time: import migration-data/*.json into Mongo
npm run migrate:verify               # confirms migrated counts match the source exactly
npm run seed:admin-user -- <email> <password> "<Display Name>" <branchId>
npm run backfill:is-active           # one-time: sets isActive:true on pre-migration docs
```

`src/scripts/fixChallanCounters.ts` and `src/scripts/diagnoseMigration.ts` are ad-hoc fixes from the migration/launch period, kept for reference — not part of the normal setup flow.

## Auth

Login (`POST /api/auth/login`) sets an httpOnly session cookie — no bearer token is ever returned in a response body, so nothing client-side needs to store or attach one manually; the browser just needs to send requests with credentials included. `requireAuth` middleware guards every route except `/api/auth/*` and the WhatsApp webhook (which Meta calls with no session, and must be mounted before the `requireAuth`-gated `/api/transports` router since Express matches by registration order).

## API surface

Each resource under `/api/<resource>` follows the same shape: `GET /` (paginated list, search, branch filter), `GET /search` (typeahead), `GET /:id` (detail), `POST /`, `PUT /:id`, `DELETE /:id` (soft), `GET /download` (Excel export). Module-specific extras:

- `POST /api/transports/send-whatsapp-message/:transportId/:branchId` — manual resend
- `GET /api/geocode/search`, `GET /api/geocode/place/:placeId` — address autocomplete proxy
- `POST /api/uploads/image` — Cloudinary upload, used by the Outward parcel photo
