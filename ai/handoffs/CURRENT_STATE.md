# Task
TASK-023 — iOS PWA Voice Input via MediaRecorder + Whisper

# Current Status
Spec approved (DRAFT-3). Ready for implementation. TASK-021 + TASK-022 are complete and merged to main.

# Next Implementation Target

## TASK-023 — iOS PWA Voice Input via MediaRecorder + Whisper (spec: `ai/tasks/TASK-023-spec.md`)

Replace the disabled mic button on iOS PWA installs with a working `MediaRecorder` + Whisper transcription flow.

**New files:**
- `client/src/hooks/useWhisperInput.js` — MediaRecorder + Whisper hook (iOS PWA path)
- `client/src/hooks/useBrowserSpeechInput.js` — extracted SpeechRecognition hook (non-iOS path, verbatim from current useSpeechInput.js)
- `server/routes/transcribe.js` — POST /api/ai/transcribe route

**Modified files:**
- `client/src/hooks/useSpeechInput.js` — replace with thin dispatcher over useWhisperInput + useBrowserSpeechInput
- `server/app.js` — mount transcribe route

**Key constraints:**
- `useWhisperInput` and `useBrowserSpeechInput` both called unconditionally at top of dispatcher (Rules of Hooks)
- 3-state phase model: `idle | recording | processing` — `toggle()` during processing is no-op
- `setPhase('processing')` in `stopRecording()` BEFORE `recorder.stop()` — eliminates idle→processing race
- `AbortController` on fetch; 30s timeout; cancelled on unmount; `AbortError` caught silently
- 90s auto-stop timer calls `stopRecording()` — same path as user pressing Stop
- Server uses `clerkAuth` middleware + `householdService.getAiConfig` + `resolveProvider` — same pattern as ai.js:581
- `provider.client.audio.transcriptions.create()` — do not instantiate a new OpenAI client
- MIME allowlist is a compatibility guard, not a security boundary (multer doesn't inspect bytes)
- `toFile` imported from `'openai'` (not `'openai/uploads'`)
- ChatPage JSX unchanged — hook public API unchanged

**Read-only dependencies:**
- `server/services/householdService.js` — `getAiConfig(householdId)`
- `server/services/ai/resolveProvider.js`
- `server/middleware/clerkAuth.js`

**Forbidden files:**
- `client/src/pages/ChatPage.jsx`
- `client/src/components/`
- `server/services/ai/resolveProvider.js`

---

## Previously completed targets (for reference)

### TASK-021 — Pantry-Aware Ingredient Highlighting (spec: `ai/tasks/TASK-021-spec.md`)
Replace binary `unmatchedIngredients` pattern on AI recipe suggestion cards with per-ingredient
pantry status: green (have), red (missing), red + "(need to buy N unit)" (partial).

**Files to touch:**
- `server/routes/ai.js` — post-scoring annotation step (step 12); build `pantryMap` once, annotate DTO
- `client/src/pages/ChatPage.jsx` — replace `unmatchedSet` rendering with status-driven rendering

**Read-only dependencies:**
- `server/utils/foodNormalization.js` — import `normalizeFood`, `stripIngredientPrefix`, `normalizeUnit`
- `server/utils/recipeScorer.js` — do not modify, do not re-export from

**Key constraints:**
- Scorer output is immutable — annotation builds new DTOs
- `pantryMap` built once (O(1) lookup), not `find()` in a loop
- `needToBuy` only present when `pantryStatus === 'partial'` AND delta > 0; never null/0
- `no-speech`/`aborted` are silent; `try/catch` wraps annotation per ingredient
- Remove `unmatchedIngredients` from response and all frontend references

## TASK-022 — Voice-to-Text Input on Mobile (spec: `ai/tasks/TASK-022-spec.md`)
Add a mic button (mobile only) to the ChatPage input bar. Tapping records speech and appends
the transcript to the textarea for user review before sending.

**Files to touch:**
- `client/src/hooks/useSpeechInput.js` — new file; Web Speech API hook
- `client/src/pages/ChatPage.jsx` — add mic button, wire hook

**Key constraints:**
- No new npm dependencies; no backend changes
- `SpeechRecognition` instance created once in `useEffect`, stored in `useRef`
- Handlers explicitly nulled before `abort()` on cleanup/unmount
- `toggle()` is the single exposed action (not separate start/stop)
- `continuous: false`, `interimResults: false`
- iOS PWA caveat: disabled muted button + toast on tap (not inline text)
- `not-allowed`/`audio-capture` errors → `onError` callback → toast in ChatPage
- `no-speech`/`aborted` → silent reset only
- No `voiceTranscript` state in ChatPage — `onResult` writes directly to `setInput`

# Files Modified (completed tasks)

## TASK-021
- `server/routes/ai.js` — pantryMap annotation step; dropped unmatchedIngredients from DTO
- `client/src/pages/ChatPage.jsx` — status-driven ingredient rendering

## TASK-022
- `client/src/hooks/useSpeechInput.js` — Web Speech API hook (will be replaced by TASK-023 dispatcher)
- `client/src/pages/ChatPage.jsx` — mic button wired to hook

# Architecture Notes

## TASK-022 hook contract (preserved by TASK-023)
```
useSpeechInput({ lang, onResult, onError }) → { supported, iosPwaCaveat, listening, toggle }
```
TASK-023 replaces the implementation of `useSpeechInput.js` with a thin dispatcher but keeps this public API identical. ChatPage does not change.

# Decisions Made
- TASK-021 and TASK-022 can be implemented independently in either order
- TASK-021 uses `foodNormalization.js` directly (not via recipeScorer) as the normalization source of truth
- TASK-022 uses native Web Speech API — no library
- RecipeModal pantry highlighting deferred (no live pantry data available there)
- Unit conversion (oz↔cup etc.) deferred to v2

# Remaining Work
- TASK-023 — iOS PWA voice input via MediaRecorder + Whisper (spec: `ai/tasks/TASK-023-spec.md`) — READY TO IMPLEMENT
- TASK-017 Issue 3 — Switch to Clerk production keys (BLOCKED: requires custom domain)
- Members card with display names — deferred
- TASK-021 v2: fuzzy annotation (foodsMatch) to align with scorer's fuzzy match
- TASK-022 v2: use user-profile language preference instead of navigator.language
- RecipeModal pantry highlighting — deferred

# Known Risks
- Safari iOS SpeechRecognition reliability varies by device/locale — test on real device
- TASK-021 annotation uses exact name match only; scorer uses fuzzy fallback too — intentional v1 limitation (documented in spec)
- Spoonacular/TheMealDB pool exhaustion after several sessions (TASK-020 fallback handles this)

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
