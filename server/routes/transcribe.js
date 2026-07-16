import express from 'express';
import multer from 'multer';
import { toFile } from 'openai';
import { clerkAuth } from '../middleware/clerkAuth.js';
import * as householdService from '../services/householdService.js';
import { resolveProvider } from '../services/ai/resolveProvider.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ALLOWED_MIME_TYPES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
]);

router.post('/', clerkAuth, upload.single('audio'), async (req, res) => {
  const requestStart = Date.now();

  if (!req.file)
    return res.status(400).json({ error: 'No audio file uploaded.' });

  // Client-supplied MIME — compatibility guard, not a security boundary.
  if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Unsupported audio format.' });
  }

  try {
    const aiConfig = await householdService.getAiConfig(req.user.householdId);
    const provider = resolveProvider(aiConfig.provider, aiConfig.decryptedKey);

    const language =
      typeof req.body.language === 'string'
        ? req.body.language.slice(0, 10)
        : undefined;

    const result = await provider.client.audio.transcriptions.create({
      file: await toFile(req.file.buffer, req.file.originalname, {
        type: req.file.mimetype,
      }),
      model: 'whisper-1',
      ...(language ? { language } : {}),
    });

    const processingMs = Date.now() - requestStart;
    console.log(
      `[transcribe] householdId=${req.user.householdId} mime=${req.file.mimetype} size=${req.file.size}B duration=${processingMs}ms`
    );
    res.json({ transcript: result.text });
  } catch (err) {
    if (err.code === 'NO_API_KEY')
      return res.status(403).json({ error: err.message });
    console.error(
      `[transcribe] error householdId=${req.user.householdId}:`,
      err.message
    );
    res.status(500).json({ error: 'Transcription failed.' });
  }
});

export default router;
