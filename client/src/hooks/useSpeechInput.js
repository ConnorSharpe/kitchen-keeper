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
