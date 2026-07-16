import { useEffect, useRef, useState } from 'react';

const isIosPwa =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  window.navigator.standalone === true;

export function useBrowserSpeechInput({
  lang = navigator.language,
  onResult,
  onError,
} = {}) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const SpeechRecognitionAPI =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = isTouch && !!SpeechRecognitionAPI && !isIosPwa;

  useEffect(() => {
    if (!SpeechRecognitionAPI || !isTouch || isIosPwa) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
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
          break;
        case 'not-allowed':
        case 'audio-capture':
          console.warn('[useBrowserSpeechInput] mic unavailable:', event.error);
          onError?.(event.error);
          break;
        default:
          console.warn(
            '[useBrowserSpeechInput] recognition error:',
            event.error
          );
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

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
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      setListening(false);
    } else {
      try {
        recognition.start();
        setListening(true);
      } catch (e) {
        console.warn('[useBrowserSpeechInput] start() failed:', e?.message);
        setListening(false);
      }
    }
  }

  return { supported, iosPwaCaveat: false, listening, toggle };
}
