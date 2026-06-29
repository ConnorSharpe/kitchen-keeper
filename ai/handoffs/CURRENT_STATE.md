# Task
TASK-023 — iOS PWA Voice Input via MediaRecorder + Whisper

# Current Status
COMPLETE. All five files written. Ready for commit and manual device test on iOS PWA.

# Files Modified

## TASK-023
- `client/src/hooks/useSpeechInput.js` — replaced with thin dispatcher over useWhisperInput + useBrowserSpeechInput
- `client/src/hooks/useWhisperInput.js` — NEW: MediaRecorder + Whisper hook (iOS PWA path)
- `client/src/hooks/useBrowserSpeechInput.js` — NEW: extracted SpeechRecognition hook (non-iOS path, verbatim from old useSpeechInput.js)
- `server/routes/transcribe.js` — NEW: POST /api/ai/transcribe route
- `server/app.js` — mounted transcribe route at /api/ai/transcribe

# Files Already Reviewed
- `server/services/householdService.js` — getAiConfig pattern confirmed
- `server/services/ai/resolveProvider.js` — provider.client pattern confirmed
- `server/middleware/clerkAuth.js` — clerkAuth middleware confirmed
- `server/node_modules/openai/index.js` — toFile exported from 'openai' directly (confirmed)

# Architecture Notes

## Hook public API (unchanged — ChatPage untouched)
```
useSpeechInput({ lang, onResult, onError }) → { supported, iosPwaCaveat, listening, toggle }
```

## Dispatcher pattern
Both `useWhisperInput` and `useBrowserSpeechInput` are called unconditionally at the top of `useSpeechInput` (Rules of Hooks). `isIosPwa` is evaluated at module load time; only the return value is selected at runtime.

## Phase model in useWhisperInput
`'idle' | 'recording' | 'processing'` — toggle() during processing is no-op. `setPhase('processing')` called in `stopRecording()` BEFORE `recorder.stop()` to close the race window.

## Server route
Follows exact same pattern as ai.js:581 — clerkAuth → householdService.getAiConfig → resolveProvider → provider.client.audio.transcriptions.create(). No new OpenAI client instantiated.

# Decisions Made
- `toFile` imported from `'openai'` (confirmed present in installed package)
- MIME allowlist is compatibility guard only; multer uses memory storage
- `audio/mp4` preferred MIME on iOS; empty-string fallback for older iOS
- No changes to ChatPage.jsx — hook API contract preserved

# Remaining Work
- Manual device test on iOS PWA (real device required — simulators do not expose MediaRecorder)
- TASK-017 Issue 3 — Switch to Clerk production keys (BLOCKED: requires custom domain)
- Members card with display names — deferred
- TASK-021 v2: fuzzy annotation (foodsMatch)
- TASK-022 v2: user-profile language preference
- RecipeModal pantry highlighting — deferred

# Known Risks
- iOS `audio/mp4` requires iOS 14.3+. Empty-string fallback mitigates older devices.
- `toFile` import path verified against installed package — confirmed `'openai'` direct export
- Family members without an OpenAI key get 403 → 'no-api-key' toast (by design)

# Forbidden Exploration
- `client/public/sw.js`
- `server/db/migrations/`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
