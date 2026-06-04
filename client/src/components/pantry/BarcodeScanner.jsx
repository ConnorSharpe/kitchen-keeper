import { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.UPC_A,
];

export default function BarcodeScanner({ onDetected, onClose, onError }) {
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);

  const stopScanner = async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    await scannerRef.current?.stop().catch(() => {});
  };

  useEffect(() => {
    const scanner = new Html5Qrcode('barcode-scanner-region');
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 140 },
          formatsToSupport: SUPPORTED_FORMATS,
        },
        (decodedText) => {
          if (stoppedRef.current) return;
          stopScanner().then(() => onDetected(decodedText));
        },
        () => {},
      )
      .catch((err) => {
        stoppedRef.current = true;
        onError(err);
      });

    return () => {
      stopScanner();
    };
  }, [onDetected, onClose, onError]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm">
        <div id="barcode-scanner-region" className="w-full rounded-lg overflow-hidden" />
        <p className="text-white text-sm text-center mt-4 opacity-75">
          Point at a barcode to scan
        </p>
      </div>
      <button
        onClick={() => { stopScanner(); onClose(); }}
        className="mt-6 px-5 py-2 bg-white text-gray-900 text-sm font-medium rounded-md"
      >
        Cancel
      </button>
    </div>
  );
}
