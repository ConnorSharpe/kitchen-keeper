import { useEffect, useRef, useState } from 'react';
import { isDebugEnabled, setDebugEnabled, getLog, clearLog } from '../lib/debugLog.js';

const TAP_COUNT = 5;
const TAP_WINDOW_MS = 3000;

// TASK-063: diagnostic-only. No address bar in the installed iOS PWA, so there's no way to
// visit a `?debug=1` URL from inside it — a tap gesture is the only way to reach this without
// a Mac for remote Safari inspection. Tap the top-left corner 5x within 3s to toggle logging;
// once enabled, a small badge appears showing the captured event count.
export default function DebugPanel() {
  const [enabled, setEnabled] = useState(() => isDebugEnabled());
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(() => getLog().length);
  const tapTimes = useRef([]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setCount(getLog().length), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  function handleCornerTap() {
    const now = Date.now();
    tapTimes.current = [...tapTimes.current, now].filter(
      (t) => now - t < TAP_WINDOW_MS
    );
    if (tapTimes.current.length >= TAP_COUNT) {
      tapTimes.current = [];
      const next = !isDebugEnabled();
      setDebugEnabled(next);
      setEnabled(next);
      setCount(getLog().length);
    }
  }

  return (
    <>
      <div
        onClick={handleCornerTap}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 44,
          height: 44,
          zIndex: 9998,
        }}
      />
      {enabled && !open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            zIndex: 9998,
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #888',
            background: '#222',
            color: '#0f0',
            opacity: 0.85,
          }}
        >
          debug ({count})
        </button>
      )}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#111',
            color: '#0f0',
            overflow: 'auto',
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={() => setOpen(false)}>Close</button>
            <button
              onClick={() => {
                clearLog();
                setCount(0);
              }}
            >
              Clear
            </button>
          </div>
          <pre
            style={{
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          >
            {JSON.stringify(getLog(), null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
