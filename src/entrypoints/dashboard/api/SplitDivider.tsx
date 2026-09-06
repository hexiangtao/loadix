/**
 * Draggable split divider between the request editor and the response view.
 *
 * A 6px hit area with a hairline visual line: drag to lock the editor's
 * height in pixels, double-click to return it to its natural (auto) size.
 * The divider measures its parent flex column at drag start and clamps the
 * editor height so both panes keep a usable minimum.
 *
 * Tracking uses window-level pointer listeners (not setPointerCapture) so
 * the drag keeps following the cursor even if it leaves the thin strip or
 * capture is unavailable.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const MIN_EDITOR_PX = 180;
const MIN_RESPONSE_PX = 180;

interface SplitDividerProps {
  /** Called while dragging, with the new editor height in px. */
  onResize: (px: number) => void;
  /** Double-click — restore the editor's natural height. */
  onReset: () => void;
}

export function SplitDivider({ onResize, onReset }: SplitDividerProps) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const bounds = useRef<DOMRect | null>(null);
  const handleHeight = useRef(0);

  // The pointerdown handler re-registers fresh closures so the drag reads
  // the latest onResize without stale state.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !bounds.current) return;
      const px = e.clientY - bounds.current.top - handleHeight.current / 2;
      const max = bounds.current.height - MIN_RESPONSE_PX;
      onResize(Math.min(Math.max(px, MIN_EDITOR_PX), max));
    };
    const onUp = () => {
      dragging.current = false;
      bounds.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onResize]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const column = e.currentTarget.parentElement;
    if (!column) return;
    dragging.current = true;
    bounds.current = column.getBoundingClientRect();
    handleHeight.current = e.currentTarget.offsetHeight;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      title={t('api.resizeSplit')}
      className="group relative z-10 flex h-1.5 shrink-0 cursor-row-resize items-center justify-center"
    >
      <div className="absolute inset-x-0 h-px bg-line transition-colors duration-150 group-hover:bg-primary/40 group-active:bg-primary/60" />
      <div className="relative hidden size-3.5 items-center justify-center rounded-sm border border-line bg-panel shadow-sm transition-colors duration-150 group-hover:flex group-hover:border-primary/40 group-active:flex">
        <div className="flex items-center gap-px">
          <span className="size-px rounded-full bg-muted" />
          <span className="size-px rounded-full bg-muted" />
          <span className="size-px rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}