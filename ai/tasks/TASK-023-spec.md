# TASK-023 — iOS PWA Voice Input via MediaRecorder + Whisper

Version: DRAFT-3 (post-architect review, round 2 — APPROVED FOR IMPLEMENTATION)

---

## Goal

Replace the disabled/muted mic button shown to iOS PWA users (the `iosPwaCaveat` path from TASK-022) with a working voice input flow that uses `MediaRecorder` + OpenAI Whisper transcription. `MediaRecorder`/`getUserMedia` work in iOS standalone mode; `SpeechRecognition` does not — this is the root cause of the current caveat.

The UX contract is identical to the working SpeechRecognition path: tap mic → speak → tap again to stop → transcript appended to textarea for review before sending.

---

## Current Behavior

On iOS PWA (home screen install), `useSpeechInput` detects `isIosPwa === true` and returns `supported: false, iosPwaCaveat: true`. ChatPage renders a permanently disabled, muted mic button. Tapping it shows a toast explaining voice is unavailable.

---

## Proposed Change

`useSpeechInput` becomes a thin dispatcher over two implementation hooks:

```
useSpeechInput()
  ↓
  if isIosPwa → return useWhisperInput(...)
  else         → return useBrowserSpeechInput(...)
```

Both hooks are called unconditionally at the top of `useSpeechInput` (Rules of Hooks). The `if (isIosPwa) return` is only the return selection — not the hook call. This means both implementations always execute (refs, effects, capability detection) even though only one is ever used. That's a small overhead, accepted here to keep the dispatcher hook-compliant without a library. Splitting into separate files keeps each implementation clean and independently testable even if both are instantiated.

To ChatPage, the public API is unchanged: `{ supported, iosPwaCaveat, listening, toggle }`.

Transcription is performed server-side via a new `POST /api/ai/transcribe` route that forwards the audio blob to OpenAI's Whisper API (`/v1/audio/transcriptions`). The route uses the existing `householdService.getAiConfig` + `resolveProvider` pattern — transcription bills against the user's own key (or the owner's key for the owner), exactly like chat.

---

## Architecture

```
iOS PWA (standalone)
  └─ useSpeechInput → useWhisperInput
       ├─ getUserMedia({ audio: true })
       ├─ MediaRecorder (audio/mp4 on iOS), max 90s auto-stop
       ├─ ondataavailable → collect chunks
       ├─ onstop → POST /api/ai/transcribe (FormData: audio blob)
       │           AbortController (30s timeout, cancelled on unmount)
       └─ onResult(transcript) → setInput in ChatPage

Non-iOS-PWA
  └─ useSpeechInput → useBrowserSpeechInput (today's implementation, extracted unchanged)

Server
  └─ POST /api/ai/transcribe
       ├─ clerkAuth middleware (populates req.user.householdId)
       ├─ multer (memory storage, 10 MB limit)
       ├─ validate req.file exists + MIME allowlist
       ├─ householdService.getAiConfig(req.user.householdId)
       ├─ resolveProvider(aiConfig.provider, aiConfig.decryptedKey)
       ├─ provider.client.audio.transcriptions.create({ file, model: 'whisper-1' })
       └─ { transcript } JSON response
```

---

## Files to Touch

### New files
- `client/src/hooks/useWhisperInput.js` — MediaRecorder + Whisper hook (iOS PWA path)
- `client/src/hooks/useBrowserSpeechInput.js` — extracted SpeechRecognition hook (non-iOS path)
- `server/routes/transcribe.js` — Whisper transcription route

### Modified files
- `client/src/hooks/useSpeechInput.js` — thin dispatcher; import + call both hooks; return by platform
- `server/app.js` — mount `/api/ai/transcribe` route

### Read-only dependencies
- `server/services/householdService.js` — `getAiConfig(householdId)` (do not modify)
- `server/services/ai/resolveProvider.js` — key resolution (do not modify)
- `server/middleware/clerkAuth.js` — populates `req.user.householdId` (do not modify)
- `server/middleware/upload.js` — multer pattern reference (do not modify)

### Forbidden files
- `client/src/pages/ChatPage.jsx` — no changes needed; hook API is unchanged
- `client/src/components/`
- `server/services/ai/resolveProvider.js`
- `ai/tasks/archive/`

---

## Implementation: `useBrowserSpeechInput` (extracted)

**New file:** `client/src/hooks/useBrowserSpeechInput.js`

This is a straight extraction of today's `useSpeechInput.js` logic with no changes to behaviour.
Same signature, same return shape:

```js
export function useBrowserSpeechInput({ lang = navigator.language, onResult, onError } = {}) {
  // ... today's SpeechRecognition setup, toggle, cleanup — verbatim from useSpeechInput.js ...
  return { supported, iosPwaCaveat: false, listening, toggle };
}
```

No logic changes. Just a rename + new file. The full implementation detail is already documented in TASK-022-spec.md.

---

## Implementation: `useSpeechInput` Dispatcher

**File:** `client/src/hooks/useSpeechInput.js` (replace contents)

```js
import { useWhisperInput } from './useWhisperInput.js';
import { useBrowserSpeechInput } from './useBrowserSpeechInput.js';

const isIosPwa =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  window.navigator.standalone === true;

export function useSpeechInput(options = {}) {
  // Both hooks called unconditionally — Rules of Hooks.
  // Return selection happens below, not here.
  const whisper = useWhisperInput(options);
  const browser = useBrowserSpeechInput(options);

  return isIosPwa ? whisper : browser;
}
```

---

## Implementation: `useWhisperInput` Hook

**New file:** `client/src/hooks/useWhisperInput.js`

### Signature

```js
// Options match useSpeechInput for drop-in compatibility.
//   lang     — BCP 47 tag. Defaults to navigator.language.
//   onResult — called with final transcript string.
//   onError  — called with error code string:
//              'not-allowed'         mic permission denied
//              'audio-capture'       mic hardware unavailable
//              'no-api-key'          403 from server (user has no key in Settings)
//              'network'             fetch failed (offline, timeout)
//              'server-error'        500 from server
//              'transcription-failed' catch-all for unexpected failures
//
// Returns: { supported: true, iosPwaCaveat: false, listening, toggle }
export function useWhisperInput({ lang = navigator.language, onResult, onError } = {}) { ... }
```

### Internal state — 3-state model

Use `'idle' | 'recording' | 'processing'` instead of a boolean. This prevents overlapping uploads and gives the hook unambiguous state throughout the full record→transcribe cycle.

```js
const [phase, setPhase] = useState('idle'); // 'idle' | 'recording' | 'processing'
const listening = phase === 'recording'; // exposed to consumer
```

`toggle()` during `'processing'` is a no-op — silently ignored. The consumer (ChatPage) sees `listening === false` during processing, which is correct: the button is not in the "stop recording" state.

### iOS MIME type

```js
const PREFERRED_MIME = 'audio/mp4';
const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : '';
```

Do not use `audio/webm` — not supported on iOS Safari.

### MediaRecorder lifecycle

Created fresh on each `toggle()` start, torn down on stop. Do not reuse `MediaRecorder` instances on iOS.

```js
const mediaStreamRef = useRef(null);
const recorderRef = useRef(null);
const chunksRef = useRef([]);
const abortControllerRef = useRef(null);   // for in-flight fetch
const autoStopTimerRef = useRef(null);     // for max-duration enforcement

async function startRecording() {
  if (phase !== 'idle') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data?.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Note: recorderRef.current is already null here (cleared in stopRecording),
      // but the recorder object itself stays alive in this closure until onstop returns.
      stopStream();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      sendToWhisper(blob, recorder.mimeType);
    };

    recorder.start();
    setPhase('recording');

    // Auto-stop after 90 seconds. Calls stopRecording() — identical path to user pressing Stop.
    autoStopTimerRef.current = setTimeout(() => stopRecording(), 90_000);
  } catch (err) {
    const code = err.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture';
    onError?.(code);
    setPhase('idle');
  }
}

function stopRecording() {
  clearTimeout(autoStopTimerRef.current);
  autoStopTimerRef.current = null;
  // Transition to 'processing' BEFORE calling recorder.stop() to close the idle→processing
  // gap. Without this, a tap between setPhase('idle') and setPhase('processing') in
  // sendToWhisper would start a second recording over the first upload.
  setPhase('processing');
  try { recorderRef.current?.stop(); } catch { /* ignore */ }
  recorderRef.current = null;
}
```

### Whisper transcription request

```js
async function sendToWhisper(blob, recorderMimeType) {
  // Phase is already 'processing' — set by stopRecording() before recorder.stop().
  const uploadStart = Date.now();
  const controller = new AbortController();
  abortControllerRef.current = controller;

  // 30-second hard timeout — if Whisper hangs, don't leave the button in limbo.
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const form = new FormData();
    const ext = recorderMimeType.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', blob, `recording.${ext}`);
    form.append('language', lang.split('-')[0]);

    const res = await fetch('/api/ai/transcribe', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    abortControllerRef.current = null;

    if (!res.ok) {
      const code = res.status === 403 ? 'no-api-key' : 'server-error';
      onError?.(code);
    } else {
      const { transcript } = await res.json();
      if (transcript?.trim()) onResult?.(transcript.trim());
    }
  } catch (err) {
    clearTimeout(timeoutId);
    abortControllerRef.current = null;
    if (err.name === 'AbortError') {
      // Either the 30s timeout fired, or the component unmounted — either way, silent.
      return;
    }
    console.warn('[useWhisperInput] network error:', err.message);
    onError?.('network');
  } finally {
    setPhase('idle');
  }
}
```

### `toggle()` — single exposed action

```js
function toggle() {
  if (phase === 'idle') startRecording();
  else if (phase === 'recording') stopRecording();
  // 'processing' → no-op
}
```

### Cleanup on unmount

```js
useEffect(() => {
  return () => {
    clearTimeout(autoStopTimerRef.current);
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    stopStream();
    // Cancel any in-flight fetch. AbortError is caught silently in sendToWhisper.
    abortControllerRef.current?.abort();
  };
}, []);
```

### Helper

```js
function stopStream() {
  mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
  mediaStreamRef.current = null;
}
```

### Return value

```js
return { supported: true, iosPwaCaveat: false, listening, toggle };
```

---

## Implementation: Server Route

**New file:** `server/routes/transcribe.js`

```js
import express from 'express';
import multer from 'multer';
import { toFile } from 'openai';
import { clerkAuth } from '../middleware/clerkAuth.js';
import * as householdService from '../services/householdService.js';
import { resolveProvider } from '../services/ai/resolveProvider.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_MIME_TYPES = new Set(['audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav']);

router.post('/', clerkAuth, upload.single('audio'), async (req, res) => {
  const requestStart = Date.now();
  // Validate file presence.
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded.' });

  // Validate MIME type against allowlist to reject obviously unsupported formats.
  // Note: req.file.mimetype is client-supplied — multer does not inspect file bytes.
  // This is a compatibility guard, not a security boundary.
  if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Unsupported audio format.' });
  }

  try {
    const aiConfig = await householdService.getAiConfig(req.user.householdId);
    const provider = resolveProvider(aiConfig.provider, aiConfig.decryptedKey);
    // The resolved provider exposes an OpenAI-compatible client supporting audio.transcriptions.create().
    // In the current single-provider implementation, provider.client is the OpenAI SDK instance.

    const language = typeof req.body.language === 'string'
      ? req.body.language.slice(0, 10)
      : undefined;

    const result = await provider.client.audio.transcriptions.create({
      file: await toFile(req.file.buffer, req.file.originalname, { type: req.file.mimetype }),
      model: 'whisper-1',
      ...(language ? { language } : {}),
    });

    const processingMs = Date.now() - requestStart;
    console.log(`[transcribe] householdId=${req.user.householdId} mime=${req.file.mimetype} size=${req.file.size}B duration=${processingMs}ms`);
    res.json({ transcript: result.text });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(403).json({ error: err.message });
    console.error(`[transcribe] error householdId=${req.user.householdId}:`, err.message);
    res.status(500).json({ error: 'Transcription failed.' });
  }
});

export default router;
```

**Key implementation notes:**
- `clerkAuth` middleware is used (same as all other routes in this app) — it populates `req.user.householdId`. Not `requireAuth`.
- `householdService.getAiConfig(householdId)` returns `{ provider: clerkUserId, decryptedKey }` — this is the existing pattern from `ai.js:581`.
- `resolveProvider(aiConfig.provider, aiConfig.decryptedKey)` returns an `OpenAIProvider`. Its `.client` property is the raw OpenAI SDK instance — use it directly for `audio.transcriptions`. Do not `new OpenAI(...)` again.
- `toFile` is imported from `'openai'` directly (not `'openai/uploads'`) — verify the exact export path against the installed package version before implementation.
- Server logs householdId, MIME type, and file size for production debugging. Transcript text is never logged.

### Mount in `server/app.js`

```js
import transcribeRouter from './routes/transcribe.js';
// ...
app.use('/api/ai/transcribe', transcribeRouter);
```

---

## Constraints

- No new npm dependencies. `multer` and `openai` are already installed.
- `MediaRecorder` instance is created fresh per recording — not reused.
- `getUserMedia` stream tracks are stopped in `onstop` and on unmount — mic indicator clears promptly.
- All three hooks (`useWhisperInput`, `useBrowserSpeechInput`) are called unconditionally at the top of `useSpeechInput` (Rules of Hooks).
- In-flight `fetch` is cancelled on unmount via `AbortController.abort()`. `AbortError` is caught silently.
- Max recording duration: 90 seconds (auto-stop). Typical voice queries are 5–15 seconds; this protects against accidentally leaving the mic on.
- Fetch timeout: 30 seconds. If Whisper doesn't respond, the request is aborted and `onError('network')` fires.
- `toggle()` during `'processing'` phase is a silent no-op — prevents overlapping uploads.
- File size limit: 10 MB server-side (enforced by multer). Typical 30-second iOS recording is ~300–600 KB.
- MIME type validated against an allowlist server-side as a compatibility guard (not a security boundary — multer does not inspect file bytes).
- `language` body param sanitized to 10 chars before forwarding to Whisper.
- ChatPage JSX is not modified — the hook's public API is unchanged.

---

## Acceptance Criteria

1. On iOS installed as a PWA (standalone), the mic button is enabled (not muted/disabled).
2. Tapping the button requests microphone permission if not already granted.
3. While recording, the red pulsing indicator is shown (same as the non-PWA path).
4. Tapping the button again stops recording. After ~1–2 seconds, the transcript is appended to the textarea.
5. The transcript append logic is identical to TASK-022: trimmed, space-separated from existing content.
6. If microphone permission is denied, an error toast is shown ("Microphone permission denied. Check your browser settings.") and the button returns to idle.
7. If the user has no OpenAI key in Settings, an appropriate toast is shown (map `no-api-key` to message) and the button returns to idle.
8. If the Whisper API call fails (network error, server error), a toast is shown and the button returns to idle. No partial text is inserted.
9. The user's own OpenAI key is used for transcription (BYOK). The owner's server-side key is used for the owner — consistent with all other AI routes.
10. On non-iOS-PWA paths (Chrome Android, desktop, Safari in-browser), behaviour is unchanged from TASK-022.
11. Navigating away from ChatPage while recording stops the MediaRecorder, releases the mic stream, and cancels any in-flight fetch. No mic indicator persists in the browser chrome. No React state-update-after-unmount warning.
12. Starting a second recording while transcription is processing (phase === 'processing') does nothing — the button is non-responsive during this window.
13. Multiple sequential recordings append in correct order (no races).
14. Recording auto-stops after 90 seconds and submits whatever was captured.

---

## Error Code → Toast Mapping (ChatPage integration)

The hook calls `onError` with a code string. ChatPage should map them:

```js
onError: (code) => {
  const messages = {
    'not-allowed':          'Microphone permission denied. Check your browser settings.',
    'audio-capture':        'Microphone not available.',
    'no-api-key':           'Add your OpenAI key in Settings to use voice input.',
    'network':              "Voice transcription couldn't be completed. Please try again.",
    'server-error':         'Voice transcription failed. Please try again.',
    'transcription-failed': 'Voice transcription failed. Please try again.',
  };
  toast.error(messages[code] ?? 'Voice input error.');
},
```

---

## Known Risks

- **iOS `audio/mp4` codec availability:** `MediaRecorder.isTypeSupported('audio/mp4')` returns `true` on iOS 14.3+. Older iOS versions: behaviour unknown. The empty-string fallback (browser default) mitigates this.
- **`toFile` import path:** The exact import (`'openai'` vs `'openai/uploads'`) depends on the installed package version. Verify against the actual installed version before implementation — check `node_modules/openai/uploads.js` or the package exports map.
- **Latency expectation:** ~1–2 second round-trip after stopping. Inherent to the approach. No loading state on the mic button for v1.
- **No key, no transcription:** Family members without an OpenAI key in Settings get a 403. The `no-api-key` error code surfaces a specific toast message pointing them to Settings.
- **`recorder.onstop` closure:** `recorderRef.current` is set to `null` in `stopRecording()` before `onstop` fires — this is intentional. The closure holds a reference to the `recorder` object directly, so `onstop` still executes correctly. This subtlety is documented in the cleanup section above.

---

## Intentional Limitations (v1)

- No loading indicator on the mic button while Whisper is processing — button returns to idle.
- `language` derived from `navigator.language`. User-profile language preference deferred to v2 alongside the SpeechRecognition path.
- No audio playback / confirmation before transcribing — record → transcribe → insert is the full flow.
- Permission denied state is not cached across taps — each tap retriggers `getUserMedia` (and will immediately fire the `not-allowed` error again). Caching deferred to v2.
