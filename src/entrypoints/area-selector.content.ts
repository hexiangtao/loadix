/**
 * Area / element picker + floating result card — content script injected into
 * the target tab on demand.
 *
 * Modes (started by the SW with PICK_REGION / PICK_ELEMENT):
 *  - "region": user drags a rectangle; we send the geometry back to the SW
 *              and dismiss the overlay.
 *  - "element": user hovers, an outline tracks the element under the cursor;
 *              click picks it. We resolve a unique CSS selector for it.
 *
 * After the SW has cropped the capture it sends PICKER_RESULT, which renders a
 * small floating card (thumbnail + copy / save) over the captured page — the
 * WeChat/Snipaste-style "result right where you took it" experience.
 *
 * The overlay is closed on Escape, on successful pick, and on PICK_CANCELLED.
 *
 * Note on re-injection: the SW re-executes this file before every pick (it has
 * no reliable "is it already there?" check), so main() installs its message
 * listener exactly once per document via a window flag.
 */
import { defineContentScript } from 'wxt/sandbox';
import type { PickedElement, PickedRegion, PickedCancelled, PickerResult } from '@/shared/capture';

type Mode = 'region' | 'element';

const HOST_ID = '__loadix_capture_overlay__';
const CARD_ID = '__loadix_capture_result__';

/** Minimal UI copy; picks Chinese when the page is, otherwise English. */
const zh = navigator.language.toLowerCase().startsWith('zh');
const UI = {
  regionHint: zh ? '拖拽框选要截取的区域 · Esc 取消' : 'Drag to select a region · Esc to cancel',
  elementHint: zh ? '点击任意元素进行截图 · Esc 取消' : 'Click any element to capture it · Esc to cancel',
  copy: zh ? '复制' : 'Copy',
  copied: zh ? '✓ 已复制' : '✓ Copied',
  save: zh ? '保存' : 'Save',
  close: zh ? '关闭' : 'Done',
};

/** Document-level listeners registered by the active mode, so dismiss() can
 *  always remove every trace of the overlay (fixes stale click/mousemove
 *  handlers hijacking the page after an Esc cancel). */
const cleanupFns: Array<() => void> = [];

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

function clearModeListeners() {
  while (cleanupFns.length) cleanupFns.pop()?.();
}

function dismiss() {
  clearModeListeners();
  document.getElementById(HOST_ID)?.remove();
  document.documentElement.style.cursor = '';
}

function send(msg: unknown) {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* service worker may have gone away — ignore */
  });
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    send({ type: 'PICK_CANCELLED' } satisfies PickedCancelled);
    dismiss();
  }
}

function makeHint(text: string): HTMLDivElement {
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
  hint.textContent = text;
  return hint;
}

/* ------------------------------------------------------------------ */
/* Region mode                                                         */
/* ------------------------------------------------------------------ */

function startRegionMode() {
  dismiss();
  const host = ensureOverlay();
  document.documentElement.style.cursor = 'crosshair';

  const onKeyCleanup = () => document.removeEventListener('keydown', onKey, true);
  cleanupFns.push(onKeyCleanup);
  document.addEventListener('keydown', onKey, true);
  host.appendChild(makeHint(UI.regionHint));

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

  const finish = (e: MouseEvent) => {
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 4 || h < 4) {
      // Treat as a click — cancel the selection.
      send({ type: 'PICK_CANCELLED' } satisfies PickedCancelled);
    } else {
      const payload: PickedRegion = {
        type: 'PICKED_REGION',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
        devicePixelRatio: window.devicePixelRatio,
      };
      send(payload);
    }
    dismiss();
  };

  const onUp = (e: MouseEvent) => {
    finish(e);
  };

  const onDown = (e: MouseEvent) => {
    // Ignore right-clicks.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    // mousemove is not captured on purpose so we track the pointer freely.
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, true);
    cleanupFns.push(() => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp, true);
    });
  };

  // Use capture so the page's own handlers don't get the events first.
  dim.addEventListener('mousedown', onDown, true);
  cleanupFns.push(() => dim.removeEventListener('mousedown', onDown, true));
}

/* ------------------------------------------------------------------ */
/* Element mode                                                        */
/* ------------------------------------------------------------------ */

function startElementMode() {
  dismiss();
  const host = ensureOverlay();
  document.documentElement.style.cursor = 'crosshair';

  const onKeyCleanup = () => document.removeEventListener('keydown', onKey, true);
  cleanupFns.push(onKeyCleanup);
  document.addEventListener('keydown', onKey, true);
  host.appendChild(makeHint(UI.elementHint));

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
  cleanupFns.push(() => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
  });
}

/* ------------------------------------------------------------------ */
/* Result card                                                         */
/* ------------------------------------------------------------------ */

/** Best-effort image copy straight to the clipboard; falls back silently so
 *  the explicit Copy button on the card always remains available. */
async function copyImage(dataUrl: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).ClipboardItem as undefined | typeof ClipboardItem;
    if (!Ctor) return false;
    const blob = await fetch(dataUrl).then((r) => r.blob());
    await navigator.clipboard.write([new Ctor({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadImage(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function showResultCard(result: PickerResult) {
  if (!result.ok || !result.dataUrl) return;
  document.getElementById(CARD_ID)?.remove();

  const host = ensureOverlay();
  const card = document.createElement('div');
  card.id = CARD_ID;
  Object.assign(card.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '240px',
    padding: '10px',
    background: 'rgba(24,24,28,0.96)',
    color: '#fff',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
    fontSize: '12px',
  });
  host.appendChild(card);

  const img = document.createElement('img');
  img.src = result.dataUrl;
  img.alt = 'captured region';
  Object.assign(img.style, {
    width: '100%',
    maxHeight: '180px',
    objectFit: 'contain',
    borderRadius: '6px',
    background: '#fff',
    display: 'block',
  });
  card.appendChild(img);

  const meta = document.createElement('div');
  meta.textContent = `${result.width ?? 0} × ${result.height ?? 0}px`;
  Object.assign(meta.style, {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '11px',
  });
  card.appendChild(meta);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '6px',
  });

  const btnBase: Partial<CSSStyleDeclaration> = {
    flex: '1',
    padding: '5px 0',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    color: '#fff',
  };

  const copyBtn = document.createElement('button');
  Object.assign(copyBtn.style, btnBase, { background: '#0a84ff' });
  copyBtn.textContent = UI.copy;
  copyBtn.addEventListener('click', async () => {
    const ok = await copyImage(result.dataUrl!);
    copyBtn.textContent = ok ? UI.copied : UI.copy;
    copyBtn.style.background = ok ? '#1e8e3e' : '#0a84ff';
  });

  const saveBtn = document.createElement('button');
  Object.assign(saveBtn.style, btnBase, { background: 'rgba(255,255,255,0.16)' });
  saveBtn.textContent = UI.save;
  saveBtn.addEventListener('click', () => {
    downloadImage(result.dataUrl!, result.filename || 'loadix-capture.png');
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = UI.close;
  Object.assign(closeBtn.style, {
    padding: '5px 8px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '12px',
    cursor: 'pointer',
  });
  closeBtn.addEventListener('click', () => card.remove());

  actions.appendChild(copyBtn);
  actions.appendChild(saveBtn);
  actions.appendChild(closeBtn);
  card.appendChild(actions);

  // Auto-copy on arrival — most screenshot tools put the image on the
  // clipboard the instant you finish selecting. Content scripts need a user
  // gesture for this; when it is denied the Copy button above is the path.
  if (document.hasFocus()) {
    void copyImage(result.dataUrl).then((ok) => {
      if (ok) {
        copyBtn.textContent = UI.copied;
        copyBtn.style.background = '#1e8e3e';
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Wire-up: listen for pick requests + results from the SW.            */
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
    // The SW may execute this file several times against the same document
    // (once per pick). Only the first execution should bind the listener.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__loadixCaptureBound) return;
    w.__loadixCaptureBound = true;

    chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PICK_REGION') startRegionMode();
      else if (msg.type === 'PICK_ELEMENT') startElementMode();
      else if (msg.type === 'PICKER_RESULT') showResultCard(msg as PickerResult);
      else if (msg.type === 'PICK_CANCELLED') dismiss();
    });
  },
});
