/**
 * Portal popover pinned to an anchor element. Shared by the Requests module
 * (sidebar row menus, variables / paste-cURL popovers) and the load-test
 * preset menu — anywhere a floating list must never be clipped by an
 * `overflow: hidden` ancestor (the bug that used to cut the preset list in
 * half inside the scrollable sidebar).
 *
 * Placement: opens below-left of the anchor, flips above when short on
 * space, and shifts horizontally to stay on screen. Closes on outside
 * click, Escape, and scroll of any ancestor scroller (so it never detaches
 * from its anchor mid-scroll).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Popover({
  anchor,
  onClose,
  children,
  width = 'w-56',
  /** Match the portal's box to the anchor's width (used by select-like menus). */
  matchAnchorWidth = false,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  matchAnchorWidth?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      const menuW = menuRef.current?.offsetWidth ?? 0;
      const width = matchAnchorWidth ? Math.round(rect.width) : undefined;
      const w = width ?? menuW;
      let top = rect.bottom + 4;
      if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - 4);
      // Right-align to the anchor, then clamp inside the viewport.
      let left = rect.right - w;
      if (left < 8) left = 8;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, children, matchAnchorWidth]);

  // Close on outside mousedown, Escape, and any scroll outside the menu —
  // scrolling an ancestor would otherwise leave the menu floating away
  // from its anchor.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return; // anchor toggles itself
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true); // capture: ancestor scrollers
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden' }}
      className={`anim-pop fixed z-50 ${matchAnchorWidth ? '' : width} origin-top-right overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-2xl`}
    >
      {children}
    </div>,
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
