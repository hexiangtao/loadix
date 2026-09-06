/**
 * Portal popover pinned to an anchor element (flips above when short on
 * space) plus the shared menu-item row style. Used by the Requests sidebar
 * row menus and the editor's floating popovers (variables, paste-cURL).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Popover({
  anchor,
  onClose,
  children,
  width = 'w-56',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      const menuW = menuRef.current?.offsetWidth ?? 0;
      let top = rect.bottom + 4;
      if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - 4);
      let right = Math.max(8, window.innerWidth - rect.right);
      // Never hang off the left edge either.
      const left = window.innerWidth - right - menuW;
      if (left < 8) right = window.innerWidth - menuW - 8;
      setPos({ top, right });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, children]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        ref={menuRef}
        style={pos ?? { visibility: 'hidden' }}
        className={`fixed z-50 ${width} overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-2xl`}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({
  danger,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}