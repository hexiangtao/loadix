import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ProgressBarProps {
  /** Whether the engine is currently running. */
  running: boolean;
  /** Total configured duration in seconds. */
  durationSec: number;
}

/**
 * Slim progress bar + countdown shown above the verdict card while a run is
 * in flight. Tracks wall-clock time from when `running` flipped to true, so
 * the visual matches the engine's own duration timer without needing any new
 * message from the SW.
 *
 * The fill is driven by `requestAnimationFrame` writing `transform: scaleX()`
 * directly to the DOM. This is GPU-composited (no layout / paint per frame)
 * and runs at the display's refresh rate, so even on a 30-second test the
 * bar moves every frame instead of "jumping" a few times per second like a
 * `setInterval` + `width` transition would. A subtle shimmer overlay
 * reinforces the "alive" perception for users on slow displays.
 *
 * Stays visible for 800 ms after `running` flips back to false so the user
 * can clearly see the 100% state before it disappears.
 */
export function ProgressBar({ running, durationSec }: ProgressBarProps) {
  const { t } = useTranslation();
  // We track elapsed time in a ref + force a single state update per second
  // for the percentage / countdown text. The bar itself is updated by rAF
  // writing to a DOM node ref, bypassing React reconciliation entirely.
  const barRef = useRef<HTMLDivElement | null>(null);
  const startTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // `display` is the React-driven visibility: kept true briefly after the
  // run ends so the user sees the 100% state. `running` is the engine's truth.
  const [display, setDisplay] = useState(false);
  const [pct, setPct] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);

  useEffect(() => {
    if (running) {
      startTsRef.current = Date.now();
      setDisplay(true);
      setPct(0);
      setRemainingSec(Math.max(0, durationSec));

      const tick = () => {
        const start = startTsRef.current;
        if (start === null) return;
        const total = Math.max(1, durationSec) * 1000;
        const elapsed = Date.now() - start;
        const ratio = Math.min(1, elapsed / total);
        // Direct DOM write: GPU-composited, no React re-render.
        if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`;
        if (ratio >= 1) {
          setPct(100);
          setRemainingSec(0);
          return;
        }
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);

      // Throttle text re-renders — bar is smooth via rAF, but the numeric
      // readout only needs ~4Hz to feel live without flickering digits.
      const textId = window.setInterval(() => {
        const start = startTsRef.current;
        if (start === null) return;
        const total = Math.max(1, durationSec) * 1000;
        const elapsed = Date.now() - start;
        const ratio = Math.min(1, elapsed / total);
        setPct(Math.floor(ratio * 100));
        setRemainingSec(Math.max(0, Math.ceil((total - elapsed) / 1000)));
      }, 250);

      return () => {
        if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
        window.clearInterval(textId);
      };
    }
    // Engine just stopped. Pin the bar to 100% for a beat, then fade out.
    if (barRef.current) barRef.current.style.transform = 'scaleX(1)';
    setPct(100);
    setRemainingSec(0);
    const id = window.setTimeout(() => setDisplay(false), 800);
    startTsRef.current = null;
    return () => window.clearTimeout(id);
  }, [running, durationSec]);

  if (!display) return null;

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-panel px-3 py-2 transition-colors duration-200 ${
        running ? 'border-primary/30' : 'border-line'
      }`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
        {/* transform-origin left so the bar fills left-to-right */}
        <div
          ref={barRef}
          className="absolute inset-0 origin-left rounded-full bg-primary"
          style={{ transform: 'scaleX(0)' }}
        />
        {/* Shimmer overlay — only while running. Sells the "alive" feel on
            long tests where the per-frame delta is too small to notice. */}
        {running && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              animation: 'progressbar-shimmer 1.6s linear infinite',
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
              transform: 'translateX(-100%)',
            }}
          />
        )}
      </div>
      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-ink">
        {pct}%
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
        {fmt(remainingSec)} / {fmt(durationSec)}
      </span>
      <span className="sr-only">{t('results.running')}</span>
      {/* Local keyframes — single-use, no need to pollute the global sheet. */}
      <style>{`@keyframes progressbar-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }`}</style>
    </div>
  );
}
