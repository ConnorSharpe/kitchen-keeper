# TASK-022 — Voice-to-Text Input on Mobile (Chat Page)

Version: DRAFT-3 (post-architect review, round 2 — APPROVED FOR IMPLEMENTATION)

---

## Goal

Add a microphone button to the chat input bar in `ChatPage.jsx` that is **visible on mobile devices only**. Tapping it records the user's voice and transcribes it into the text input field. The user can review and edit the transcript before sending.

---

## Current Behavior

`ChatPage.jsx` renders a textarea + Send button. Input is keyboard-only. No voice option exists.

---

## Proposed UX

1. A microphone icon button appears to the **left of the textarea** on touch/mobile devices only (`md:hidden` Tailwind class + `pointer: coarse` feature detection — see Mobile Detection).
2. Tapping the button starts recording (toggles via `toggle()`).
3. While recording, the button shows a red pulsing indicator.
4. On speech end (user stops talking), the transcript is appended to the textarea. The user can then edit or press Send.
5. Tapping the button again while recording stops it early and discards the in-progress phrase — no transcript is added.
6. If the browser does not support the Web Speech API, the button is hidden entirely (feature detection).
7. If the app is installed as a standalone PWA on iOS (where the API is broken), the mic button is rendered as disabled/muted. Tapping it shows a toast: "Voice input isn't available when Kitchen Keeper is installed as an app." No permanent inline text is added to the input bar.

---

## Technology Choice: Web Speech API (No Library)

**Decision:** Use the native `window.SpeechRecognition` / `window.webkitSpeechRecognition` API directly. Do not add `react-speech-recognition` or any other library.

**Rationale:**
- The use case is simple: one-shot dictation into a text field. No command recognition, no continuous mode needed.
- The native API is supported on Chrome for Android (primary mobile target) and Safari on iOS 14.5+ (in-browser, not PWA standalone).
- A ~50-line hook does not justify a library dependency.

**Browser support (as of 2026):**
- Chrome Android: full support.
- Safari iOS in-browser: generally supported via `webkitSpeechRecognition`; reliability varies by iOS version, locale, and device. Recommend testing on a real device.
- Safari iOS PWA standalone (home screen install): API is present but silently fails — detect and show disabled state.
- Firefox: not supported. Feature detection hides the button.
- Chrome desktop: supported but button is hidden via `md:hidden` + `pointer: coarse` guard.

---

## Mobile Detection

Two guards are used in combination:

**CSS guard:** `md:hidden` — hides the button at Tailwind's `md` breakpoint (≥768px). This means tablets wider than 768px will not show the button via CSS alone. The `pointer: coarse` JS guard (below) independently controls visibility for touch devices regardless of viewport width, but the CSS class still applies. In practice, the target is phone-sized screens; tablet support is out of scope for v1.

**JS guard:** `window.matchMedia('(pointer: coarse)').matches` — evaluated once at hook initialization. Returns `true` on touch screens (phones, tablets), `false` on mouse-driven devices. Used as the JS-level gate so that `supported` is always `false` on desktop regardless of API availability.

```js
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const supported = isTouch && !!SpeechRecognition && !isIosPwa;
```

---

## Implementation: `useSpeechInput` Hook

**New file:** `client/src/hooks/useSpeechInput.js`

### Hook signature

```js
// Options:
//   lang     — BCP 47 language tag. Defaults to navigator.language.
//   onResult — called with final transcript string when speech ends.
//   onError  — called with error code string for actionable errors.
//              Codes: 'not-allowed', 'audio-capture' (mic unavailable/denied).
//              Silent codes (no-speech, aborted) are not forwarded.
//
// Returns: { supported, iosPwaCaveat, listening, toggle }
export function useSpeechInput({ lang = navigator.language, onResult, onError } = {}) { ... }
```

### iOS PWA detection (module-level constant)

```js
const isIosPwa =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  window.navigator.standalone === true;
```

`window.navigator.standalone` is only defined on iOS. On Android PWA it is `undefined`, which is falsy — no false positives.

### Recognition instance lifecycle

The `SpeechRecognition` instance is created **once** on mount inside a `useEffect`, stored in a `useRef`, and torn down on unmount. It is never created on every render.

```js
const recognitionRef = useRef(null);
const [listening, setListening] = useState(false);

useEffect(() => {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI || !isTouch || isIosPwa) return;

  const recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;      // one phrase per tap
  recognition.interimResults = false;  // final transcript only — no interim noise
  recognition.lang = lang;

  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript ?? '';
    if (transcript) onResult?.(transcript);
    setListening(false);
  };

  recognition.onerror = (event) => {
    switch (event.error) {
      case 'no-speech':
      case 'aborted':
        break; // silent reset — expected, not an error
      case 'not-allowed':
      case 'audio-capture':
        console.warn('[useSpeechInput] mic unavailable:', event.error);
        onError?.(event.error); // ChatPage shows a toast for these
        break;
      default:
        console.warn('[useSpeechInput] recognition error:', event.error);
    }
    setListening(false);
  };

  recognition.onend = () => {
    setListening(false);
  };

  recognitionRef.current = recognition;

  // Cleanup: explicitly null all handlers before aborting to prevent callbacks
  // from firing against an unmounted component during browser edge cases.
  // This also runs when `lang` changes — any active session is aborted before
  // a new instance is created with the updated language.
  return () => {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognitionRef.current = null;
  };
}, [lang]); // re-create instance if lang changes; cleanup aborts active session first
```

### `toggle()` — single exposed action

Instead of exposing separate `start` and `stop`, the hook exposes a single `toggle()`. This keeps the start/stop conditional out of the JSX and inside the hook where the state lives.

```js
function toggle() {
  const recognition = recognitionRef.current;
  if (!recognition) return;

  if (listening) {
    try { recognition.abort(); } catch { /* ignore — may already be stopping */ }
    setListening(false);
  } else {
    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      // start() throws InvalidStateError on rapid taps or race conditions.
      console.warn('[useSpeechInput] start() failed:', e?.message);
      setListening(false);
    }
  }
}
```

Both `abort()` and `start()` are wrapped in `try/catch`. `recognition.start()` can throw `InvalidStateError` not only on rapid taps but also during permission dialogs and browser race conditions.

### Return value

```js
return { supported, iosPwaCaveat: isIosPwa, listening, toggle };
```

`supported` is `true` only when: touch device AND API available AND not iOS PWA. The iOS PWA case is returned separately via `iosPwaCaveat` so ChatPage can render the disabled-button state.

---

## ChatPage Integration

**File:** `client/src/pages/ChatPage.jsx`

### No new state needed

Do **not** add a `voiceTranscript` state. The hook calls `onResult`, which calls `setInput` directly. No intermediate state.

### Hook usage

```js
const { supported, iosPwaCaveat, listening, toggle } = useSpeechInput({
  lang: navigator.language,
  onResult: (transcript) =>
    setInput((prev) => {
      const base = prev.trimEnd();
      return base ? `${base} ${transcript.trim()}` : transcript.trim();
    }),
  onError: (errorCode) => {
    if (errorCode === 'not-allowed' || errorCode === 'audio-capture') {
      toast.error('Microphone permission denied. Check your browser settings.');
    }
  },
});
```

Transcript is trimmed on both sides before appending. If the textarea already has content, a single space is inserted between the existing text and the new transcript. Multiple dictation presses accumulate cleanly.

### Button JSX

```jsx
{/* Mic button — mobile only via md:hidden; also feature-detected via supported */}
{(supported || iosPwaCaveat) && (
  <button
    type="button"
    onClick={iosPwaCaveat
      ? () => toast('Voice input isn\'t available when Kitchen Keeper is installed as an app.')
      : toggle
    }
    disabled={!iosPwaCaveat && loading}
    className={`md:hidden flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg transition-colors
      ${iosPwaCaveat
        ? 'border-gray-100 text-gray-300 cursor-default'
        : 'border-gray-200 disabled:opacity-50'
      }`}
    aria-label={listening ? 'Stop recording' : 'Voice input'}
  >
    {listening ? (
      <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" aria-hidden />
    ) : (
      <span aria-hidden>🎙️</span>
    )}
  </button>
)}
```

**iOS PWA caveat UX:** The button is rendered but visually muted (gray, `cursor-default`). Tapping it fires a toast — no permanent inline text is added to the input bar. This gives the user feedback without cluttering the layout.

**Layout:** The mic button sits to the **left of the textarea** in the existing `flex gap-3` form row. It uses `flex-shrink-0` consistent with the Send button.

---

## Allowed Files

- `client/src/hooks/useSpeechInput.js` (new file)
- `client/src/pages/ChatPage.jsx`

## Forbidden Files

- `client/src/components/` (any existing component)
- `server/` (no backend changes needed)
- `ai/tasks/archive/`

---

## Constraints

- No new npm dependencies.
- No backend changes.
- `continuous: false` — one-shot recognition per tap. No persistent microphone session.
- The transcript populates the textarea; it does NOT auto-send.
- The `SpeechRecognition` instance is created once on mount and stored in a `useRef`. Never recreated on every render.
- `abort()` and `start()` are always wrapped in `try/catch`.
- `onresult`, `onerror`, and `onend` handlers are always cleaned up on unmount via `abort()` + `recognitionRef.current = null`.
- No `voiceTranscript` state in ChatPage — the hook's `onResult` callback writes directly to `input` state via `setInput`.
- `no-speech` and `aborted` errors are silently reset. `not-allowed` and `audio-capture` emit `console.warn` and invoke `onError`.

---

## Acceptance Criteria

1. On a mobile browser (Chrome Android or Safari iOS in-browser), a mic button is visible in the chat input bar.
2. On desktop (≥768px), the mic button is not visible.
3. Tapping the button shows a red pulsing indicator while recording.
4. After the user speaks, the transcript is appended to the textarea (trimmed, space-separated from any existing content).
5. The user can edit the transcript and press Send — normal send flow is unchanged.
6. On a browser without SpeechRecognition support, the button does not appear.
7. On iOS in PWA standalone mode, a muted mic icon is shown. Tapping it shows a toast explaining why voice is unavailable.
8. Tapping the mic button while the chat is loading (awaiting AI reply) does nothing (button disabled).
9. **Cancellation:** Tapping the mic to start, then tapping again to stop — no transcript is added to the textarea, state resets to idle.
10. **Multiple dictations:** Speaking "hello", stopping, then speaking "world" — textarea contains "hello world" (correctly space-separated, no double-spaces).
11. **Component unmount during recording:** Navigating away from ChatPage while recording produces no React warnings, no console errors, and no memory leaks (recognition is aborted, ref cleared).
12. **Permission denied:** If mic permission is denied, a toast appears ("Microphone permission denied…") and the button returns to idle state.
13. **Rapid taps:** Tapping start/stop multiple times in quick succession does not crash or produce an unrecoverable state.

---

## Verification Steps

1. Load ChatPage on a mobile browser (or DevTools mobile emulation with audio enabled).
2. Confirm mic button visibility at mobile width; confirm absence at ≥768px.
3. Grant microphone permission. Tap button. Speak a phrase. Confirm transcript appended to textarea.
4. Confirm Send works normally after voice input.
5. Speak a second phrase without clearing the textarea. Confirm correct space-separated append.
6. Tap button to start, then tap again immediately. Confirm no transcript is added.
7. Simulate no SpeechRecognition support (`delete window.SpeechRecognition; delete window.webkitSpeechRecognition`) and confirm button is hidden.
8. Deny microphone permission. Confirm toast appears and button resets to idle.
9. Start recording, navigate away (e.g. to PantryPage), confirm no React warnings in console.

---

## Known Risks

- **Safari iOS reliability:** Even in-browser (non-PWA), Safari's SpeechRecognition implementation has known quirks (WICG issue #96). Behaviour varies by iOS version, locale, and device. Test on a real device — not the iOS Simulator.
- **iOS PWA detection scope:** `navigator.standalone === true` is iOS-only. On Android PWA this is `undefined` (falsy) — no false positives. On desktop `window.navigator.standalone` is also `undefined`.
- **Microphone permission prompt:** The first `recognition.start()` triggers the browser permission dialog. This is expected. The `not-allowed` error handler covers the denied case.

## Intentional Limitations

- **Language hardcoded to `navigator.language` in v1.** The hook already accepts a `lang` option, so switching to a user-profile preference in v2 requires no API change.
- **No interim results.** `interimResults: false` means no live transcription while the user is speaking — only the final result is delivered. This keeps state management simple and avoids partial-result flicker.
