/**
 * Shared in-app confirm dialog — the styled replacement for window.confirm.
 *
 * Used by the Requests module (delete request / collection, clear history)
 * and the Markdown module (delete forever / empty trash / delete folder).
 * Portal-rendered so no ancestor overflow can clip it, with the app's
 * entrance animation, Escape-to-cancel, and backdrop click-to-cancel.
 *
 * `confirmLabel`/`cancelLabel` come from the caller's i18n; the destructive
 * button is always rendered in the danger color, autoFocus sits on Cancel so
 * an accidental Enter doesn't destroy data.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Escape cancels — the safe default for destructive dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="anim-pop w-[min(380px,92vw)] rounded-xl border border-line bg-panel p-4 shadow-2xl"
      >
        <h3 className="text-[14px] font-bold">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="ghost-btn" onClick={onClose} autoFocus>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="cursor-pointer rounded-lg bg-danger px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-danger/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
