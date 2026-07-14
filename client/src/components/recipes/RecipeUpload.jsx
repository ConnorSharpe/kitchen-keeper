import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';

// Reads EXIF orientation tag from a JPEG ArrayBuffer.
function readExifOrientation(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return 1;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) {
        const exifStart = offset + 4;
        if (view.getUint32(exifStart) !== 0x45786966) return 1; // "Exif"
        const tiff = exifStart + 6;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd = tiff + view.getUint32(tiff + 4, little);
        const entries = view.getUint16(ifd, little);
        for (let i = 0; i < entries; i++) {
          if (view.getUint16(ifd + 2 + i * 12, little) === 0x0112) {
            return view.getUint16(ifd + 2 + i * 12 + 8, little);
          }
        }
        return 1;
      } else if (marker === 0xFFDA) {
        break;
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch { /* ignore */ }
  return 1;
}

// Applies EXIF orientation via canvas transform before drawing.
function applyOrientationTransform(ctx, orientation, sw, sh) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0,  1,  sw,  0); break;
    case 3: ctx.transform(-1, 0, 0, -1,  sw, sh); break;
    case 4: ctx.transform( 1, 0, 0, -1,   0, sh); break;
    case 5: ctx.transform( 0, 1, 1,  0,   0,  0); break;
    case 6: ctx.transform( 0, 1,-1,  0,  sh,  0); break;
    case 7: ctx.transform( 0,-1,-1,  0,  sh, sw); break;
    case 8: ctx.transform( 0,-1, 1,  0,   0, sw); break;
    default: break;
  }
}

async function resizeImage(file, maxPx = 1568, quality = 0.85) {
  const arrayBuffer = await file.arrayBuffer();

  // Primary path: createImageBitmap honors EXIF on Chrome 84+ / Safari 15+
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const { width: sw, height: sh } = bitmap;
      const scale = Math.min(1, maxPx / Math.max(sw, sh));
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      const canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, dw, dh);
      bitmap.close();
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    } catch { /* fall through to fallback */ }
  }

  // Fallback: Image element + manual EXIF rotation
  const orientation = readExifOrientation(arrayBuffer);
  const rotated = orientation >= 5 && orientation <= 8; // 90° or 270°
  const url = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  URL.revokeObjectURL(url);

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const logicalW = rotated ? sh : sw;
  const logicalH = rotated ? sw : sh;
  const scale = Math.min(1, maxPx / Math.max(logicalW, logicalH));
  const dw = Math.round(logicalW * scale);
  const dh = Math.round(logicalH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.save();
  applyOrientationTransform(ctx, orientation, dw, dh);
  ctx.drawImage(img, 0, 0, rotated ? dh : dw, rotated ? dw : dh);
  ctx.restore();
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export default function RecipeUpload({ onExtracted, onClose }) {
  // phases: 'idle' | 'resizing' | 'uploading' | 'error'
  const [phase, setPhase] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function uploadFile(file) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (JPEG, PNG, WebP, or HEIC).');
      return;
    }
    if (file.type === 'image/heic' || file.type === 'image/heif') {
      toast.error('HEIC files from share-sheet are not supported. Please take a new photo or select a JPEG/PNG.');
      return;
    }

    setPhase('resizing');
    setErrorMsg('');

    let resized;
    try {
      resized = await resizeImage(file);
    } catch {
      setErrorMsg('Could not process image. Please try a different photo.');
      setPhase('error');
      return;
    }

    setPhase('uploading');
    const controller = new AbortController();
    abortRef.current = controller;

    const formData = new FormData();
    formData.append('recipe', resized, file.name.replace(/\.[^.]+$/, '.jpg'));

    try {
      const res = await fetch('/api/ai/parse-recipe-image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
        signal: AbortSignal.any
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(45000)])
          : controller.signal,
      });

      if (res.status === 401) { window.location.href = '/login'; return; }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      onExtracted(data.recipe, resized);
    } catch (err) {
      if (err.name === 'AbortError') return; // user closed modal
      setErrorMsg(err.message || 'Failed to parse recipe image');
      setPhase('error');
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleRetry() {
    setPhase('idle');
    setErrorMsg('');
  }

  const busy = phase === 'resizing' || phase === 'uploading';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) { abortRef.current?.abort(); onClose(); } }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload a Recipe Image</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Photo of a recipe card, cookbook page, or hand-written recipe
            </p>
          </div>
          <button
            onClick={() => { abortRef.current?.abort(); onClose(); }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Phase: idle */}
        {phase === 'idle' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-orange-400 bg-orange-50'
                : 'border-gray-300 hover:border-orange-300 hover:bg-gray-50'
            }`}
          >
            <p className="text-5xl mb-4">📸</p>
            <p className="text-sm font-medium text-gray-700">
              Take a photo or upload a recipe image
            </p>
            <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP or HEIC — max 10 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Phase: resizing or uploading */}
        {busy && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-5" />
            <p className="text-sm font-medium text-gray-700">
              {phase === 'resizing' ? 'Preparing image…' : 'Reading recipe with AI…'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {phase === 'resizing' ? 'Resizing for upload' : 'This takes about 10 seconds'}
            </p>
          </div>
        )}

        {/* Phase: error */}
        {phase === 'error' && (
          <div className="text-center py-8">
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-sm text-red-600 font-medium">{errorMsg}</p>
            <p className="text-xs text-gray-400 mt-1">
              Try a clearer photo with better lighting
            </p>
            <div className="flex gap-3 justify-center mt-5">
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-orange-500 text-white text-sm rounded-md hover:bg-orange-600 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
