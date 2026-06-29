import { useEffect, useRef, useState } from 'react';

const PREFERRED_MIME = 'audio/mp4';
const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(PREFERRED_MIME)
  ? PREFERRED_MIME
  : '';

export function useWhisperInput({ lang = navigator.language, onResult, onError } = {}) {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'recording' | 'processing'
  const listening = phase === 'recording';

  const mediaStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const abortControllerRef = useRef(null);
  const autoStopTimerRef = useRef(null);

  function stopStream() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }

  async function sendToWhisper(blob, recorderMimeType) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
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
        onError?.(res.status === 403 ? 'no-api-key' : 'server-error');
      } else {
        const { transcript } = await res.json();
        if (transcript?.trim()) onResult?.(transcript.trim());
      }
    } catch (err) {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
      if (err.name === 'AbortError') return;
      console.warn('[useWhisperInput] network error:', err.message);
      onError?.('network');
    } finally {
      setPhase('idle');
    }
  }

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
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        sendToWhisper(blob, recorder.mimeType);
      };

      recorder.start();
      setPhase('recording');

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
    // Set 'processing' BEFORE recorder.stop() to close the idle→processing race window.
    setPhase('processing');
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
  }

  function toggle() {
    if (phase === 'idle') startRecording();
    else if (phase === 'recording') stopRecording();
    // 'processing' → no-op
  }

  useEffect(() => {
    return () => {
      clearTimeout(autoStopTimerRef.current);
      try { recorderRef.current?.stop(); } catch { /* ignore */ }
      stopStream();
      abortControllerRef.current?.abort();
    };
  }, []);

  return { supported: true, iosPwaCaveat: false, listening, toggle };
}
