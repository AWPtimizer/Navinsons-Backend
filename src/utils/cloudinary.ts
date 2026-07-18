import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

// Uploads a Buffer (from multer's memory storage — nothing touches disk)
// straight to Cloudinary via its streaming API, returns the public URL to
// store on the record. Images live in Cloudinary's free tier (25GB), not
// in Mongo — Atlas's 512MB total quota would be gone in days otherwise.
export const uploadImageBuffer = (buffer: Buffer, folder: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload returned no result'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
