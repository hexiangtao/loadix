/**
 * Area / element picker — content script injected into the target tab on demand.
 *
 * Lives at document.body so its UI overlays the actual page. Two modes:
 *
 *  - "region": user drags a rectangle; we send the geometry back to the SW
 *              and dismiss the overlay.
 *  - "element": user hovers, an outline tracks the element under the cursor;
 *              click picks it. We resolve a unique CSS selector for it.
 *
 * The overlay is closed on Escape, on successful pick, and on a `PICK_CANCELLED`
 * reply.
 */
import { defineContentScript } from 'wxt/sandbox';
import type { PickedElement, PickedRegion, PickedCancelled } from '@/shared/capture';

type Mode = 'region' | 'element';

const HOST_ID = '__loadix_capture_overlay__';

function ensureOverlay(): HTMLDivElement {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (host) return host;
  host = document.createElement('div');
  host.id = HOST_ID;
  // We sit at the top of every stacking context and ignore pointer events on
  // the wrapper itself so the page underneath stays clickable.
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  document.documentElement.appendChild(host);
  return host;
}

function dismiss() {
  document.getElementById(HOST_ID)?.remove();
  document.removeEventListener('keydown', onKey, true);
  document.documentElement.style.cursor = '';
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    send({ type: 'PICK_CANCELLED' } satisfies PickedCancelled);
    dismiss();
  }
}

function send(msg: unknown) {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* service worker may have gone away — ignore */
  });
}

/* ------------------------------------------------------------------ */
/* Region mode                                                         */
/* ------------------------------------------------------------------ */

function startRegionMode() {
  const host = ensureOverlay();
  document.documentElement.style.cursor = 'crosshair';
  document.addEventListener('keydown', onKey, true);

  // The hint badge (top centre).
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 12px',
    background: 'rgba(20,20,22,0.92)',
    color: '#fff',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.01em',
    pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
  });
  hint.textContent = 'Drag to select a region · Esc to cancel';
  host.appendChild(hint);

  // Backdrop dimmer.
  const dim = document.createElement('div');
  Object.assign(dim.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(10,12,18,0.18)',
    backdropFilter: 'blur(1px)',
    WebkitBackdropFilter: 'blur(1px)',
    pointerEvents: 'auto',
  });
  host.appendChild(dim);

  // Selection box.
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    border: '1.5px solid #0a84ff',
    background: 'rgba(10,132,255,0.12)',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.6) inset, 0 0 0 9999px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
    display: 'none',
  });
  host.appendChild(box);

  // Size label that follows the cursor.
  const sizeLabel = document.createElement('div');
  Object.assign(sizeLabel.style, {
    position: 'fixed',
    padding: '2px 6px',
    background: '#0a84ff',
    color: '#fff',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    pointerEvents: 'none',
    display: 'none',
  });
  host.appendChild(sizeLabel);

  let startX = 0;
  let startY = 0;

  const onMove = (e: MouseEvent) => {
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    box.style.display = w > 2 && h > 2 ? 'block' : 'none';
    sizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    sizeLabel.style.left = `${e.clientX + 12}px`;
    sizeLabel.style.top = `${e.clientY + 14}px`;
    sizeLabel.style.display = 'block';
  };

  const onUp = (e: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp, true);
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 4 || h < 4) {
      // Treat as a click — cancel the selection.
      send({ type: 'PICK_CANCELLED' } satisfies PickedCancelled);
      dismiss();
      return;
    }
    const payload: PickedRegion = {
      type: 'PICKED_REGION',
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      devicePixelRatio: window.devicePixelRatio,
    };
    send(payload);
    dismiss();
  };

  const onDown = (e: MouseEvent) => {
    // Ignore right-clicks.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, true);
  };

  // Use capture so the page's own handlers don't get the events first.
  dim.addEventListener('mousedown', onDown, true);
}

/* ------------------------------------------------------------------ */
/* Element mode                                                        */
/* ------------------------------------------------------------------ */

function startElementMode() {
  const host = ensureOverlay();
  document.documentElement.style.cursor = 'crosshair';
  document.addEventListener('keydown', onKey, true);

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 12px',
    background: 'rgba(20,20,22,0.92)',
    color: '#fff',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '600',
    pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
  });
  hint.textContent = 'Click any element to capture it · Esc to cancel';
  host.appendChild(hint);

  const outline = document.createElement('div');
  Object.assign(outline.style, {
    position: 'fixed',
    border: '1.5px solid #0a84ff',
    background: 'rgba(10,132,255,0.10)',
    pointerEvents: 'none',
    display: 'none',
    transition: 'all 60ms linear',
  });
  host.appendChild(outline);

  const tag = document.createElement('div');
  Object.assign(tag.style, {
    position: 'fixed',
    padding: '2px 6px',
    background: '#0a84ff',
    color: '#fff',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    pointerEvents: 'none',
    display: 'none',
  });
  host.appendChild(tag);

  /** Walk the DOM and return a unique-enough CSS selector for `el`. */
  function selectorFor(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 5) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      let part = tag;
      if (parent) {
        const siblings: Element[] = [];
        for (const child of Array.from(parent.children)) {
          if (child.tagName === cur.tagName) siblings.push(child);
        }
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  const onMove = (e: MouseEvent) => {
    // Hide overlay so we get the actual element under the cursor.
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    host.style.pointerEvents = '';
    if (!el || el === document.documentElement || el === document.body) {
      outline.style.display = 'none';
      tag.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    outline.style.left = `${r.left}px`;
    outline.style.top = `${r.top}px`;
    outline.style.width = `${r.width}px`;
    outline.style.height = `${r.height}px`;
    outline.style.display = 'block';
    tag.textContent = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '');
    tag.style.left = `${r.left}px`;
    tag.style.top = `${r.top - 22}px`;
    tag.style.display = 'block';
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    host.style.pointerEvents = '';
    if (!el || el === document.documentElement || el === document.body) {
      send({ type: 'PICK_CANCELLED' } satisfies PickedCancelled);
      dismiss();
      return;
    }
    const r = el.getBoundingClientRect();
    const payload: PickedElement = {
      type: 'PICKED_ELEMENT',
      selector: selectorFor(el),
      rect: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      devicePixelRatio: window.devicePixelRatio,
    };
    send(payload);
    dismiss();
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
}

/* ------------------------------------------------------------------ */
/* Wire-up: listen for PICK_REGION / PICK_ELEMENT from the SW.         */
/* ------------------------------------------------------------------ */

export default defineContentScript({
  matches: ['<all_urls>'],
  // Don't run at document_idle; we want the listener installed as early as
  // possible so messages from the SW are never dropped.
  runAt: 'document_start',
  // Don't add a declarative content_scripts entry to the manifest — we
  // inject this script on demand via chrome.scripting.executeScript from
  // the service worker, so a runtime registration is enough.
  registration: 'runtime',
  main() {
    chrome.runtime.onMessage.addListener((msg: { type: string }) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PICK_REGION') startRegionMode();
      if (msg.type === 'PICK_ELEMENT') startElementMode();
      // Always clean up any stale overlay if we get a generic ping.
      if (msg.type === 'PICK_CANCELLED') dismiss();
    });
  },
});
