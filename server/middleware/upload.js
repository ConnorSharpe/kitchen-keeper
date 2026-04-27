import multer from 'multer';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error(
      `Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, HEIC`
    );
    err.status = 400;
    cb(err, false);
  }
}

// Memory storage — files never touch disk.
// Receipts: buffer goes directly to Gemini, then discarded.
// Recipe images: buffer is uploaded to Vercel Blob in the route handler.
export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
