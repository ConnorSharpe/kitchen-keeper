import { useEffect, useRef, useState } from 'react';

// iOS standalone PWA: SpeechRecognition API is present but silently fails.
// navigator.standalone is iOS-only; undefined (falsy) on Android and desktop.
const isIosPwa =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  window.navigator.standalone === true;

// Options:
//   lang     — BCP 47 language tag. Defaults to navigator.language.
//   onResult — called with final transcript string when speech ends.
//   onError  — called with error code string for actionable errors.
//              Codes: 'not-allowed', 'audio-capture' (mic unavailable/denied).
//              Silent codes (no-speech, aborted) are not forwarded.
//
// Returns: { supported, iosPwaCaveat, listening, toggle }
export function useSpeechInput({ lang = navigator.language, onResult, onError } = {}) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // Evaluated once — JS-level gate so supported is always false on desktop.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = isTouch && !!SpeechRecognitionAPI && !isIosPwa;

  useEffect(() => {
    if (!SpeechRecognitionAPI || !isTouch || isIosPwa) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;      // one phrase per tap
    recognition.interimResults = false;  // final transcript only
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
          onError?.(event.error);
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

    // Explicitly null all handlers before aborting to prevent callbacks
    // firing against an unmounted component during browser edge cases.
    // Also runs when lang changes — active session is aborted before new instance is created.
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return { supported, iosPwaCaveat: isIosPwa, listening, toggle };
}
