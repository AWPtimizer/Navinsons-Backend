import { Router } from 'express';
import multer from 'multer';
import { uploadImageBuffer } from '../utils/cloudinary.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';

const router = Router();

// Memory storage — the file never touches disk, just gets streamed straight
// through to Cloudinary. 8MB cap is generous for a phone photo while still
// guarding against someone uploading something absurd.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// Generic, reusable image upload — not tied to a specific module. The
// caller uploads first, gets a URL back, then includes that URL in the
// normal create/update JSON payload for whichever record it belongs to.
router.post(
  '/image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No image file provided');
    const url = await uploadImageBuffer(req.file.buffer, 'navin-sons');
    res.status(201).json({ url });
  })
);

export default router;
