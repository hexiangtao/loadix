/**
 * CapturePopover — the always-on screenshot launcher in the top toolbar.
 *
 * Why: snapping anything on the page is something users do many times a day.
 * A dedicated button in the global header (next to the theme switcher) is
 * far more discoverable than burying it inside the 19-tool workbench.
 *
 * All modes capture the page the user was browsing before opening Loadix (the
 * SW remembers the last non-Loadix tab):
 *   - Visible   → the viewport of that page, exactly as the user saw it.
 *   - Full page → stitch together every scrolled tile of that page.
 *   - Region    → dim that page and drag a rectangle; we crop it.
 *   - Element   → hover/click an element on that page; we crop to it.
 *
 * Results: viewport captures return a thumbnail preview into this popover
 * (with auto-copy to the clipboard); region/element picks leave a floating
 * card with copy/save actions on the captured page itself — the WeChat/
 * Snipaste-style flow. Errors are surfaced inline (no alert()).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Copy, Download, Loader2, AlertTriangle, Eye, FileImage, Crop, MousePointer2, X } from 'lucide-react';
import type { CaptureMode, CaptureRequest, CaptureResult } from '@/shared/capture';

type Phase = 'idle' | 'picking' | 'capturing';

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => r.blob());
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function copyBlobToClipboard(blob: Blob): Promise<void> {
  // ClipboardItem is widely available in Chromium-based browsers.
  // The constructor throws in some test environments — fall back to a copy
  // of the data URL if that happens.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window as any).ClipboardItem as undefined | typeof ClipboardItem;
  if (!Ctor) throw new Error('Clipboard API not available');
  await navigator.clipboard.write([new Ctor({ 'image/png': blob })]);
}

export function CapturePopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset transient state when the popover closes.
  useEffect(() => {
    if (open) return;
    setResult(null);
    setCopied(false);
    setPhase('idle');
  }, [open]);

  // Best-effort copy: most screenshot tools put the image on the clipboard
  // as soon as the capture lands. Falls back silently — the Copy button stays.
  const autoCopy = useCallback(async (dataUrl: string) => {
    try {
      const blob = await dataUrlToBlob(dataUrl);
      await copyBlobToClipboard(blob);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  const request = useCallback(async (mode: CaptureMode, selector?: string) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      setResult({
        type: 'CAPTURE_RESULT',
        ok: false,
        filename: 'loadix.png',
        error: t('capture.web_only'),
      });
      return;
    }
    setResult(null);
    setCopied(false);
    setPhase(mode === 'selection' || (mode === 'element' && !selector) ? 'picking' : 'capturing');
    const req: CaptureRequest = {
      type: 'CAPTURE_REQUEST',
      mode,
      filename: 'loadix',
      ...(selector ? { selector } : {}),
    };
    try {
      // The SW answers through sendResponse: the resolved value IS the result.
      // (It never broadcasts CAPTURE_RESULT over onMessage.)
      const res = (await chrome.runtime.sendMessage(req)) as CaptureResult | undefined;
      if (!res) throw new Error('The extension did not respond. Reload the dashboard and retry.');
      setResult(res);
      if (res.ok && res.dataUrl && !res.onPage) void autoCopy(res.dataUrl);
    } catch (e) {
      setResult({
        type: 'CAPTURE_RESULT',
        ok: false,
        filename: 'loadix.png',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPhase('idle');
    }
  }, [autoCopy, t]);

  // Mode tiles: icon + label + sub-label.
  const modes: Array<{ id: CaptureMode; icon: typeof Eye; key: string }> = [
    { id: 'visible',   icon: Eye,           key: 'visible' },
    { id: 'fullpage',  icon: FileImage,     key: 'fullpage' },
    { id: 'selection', icon: Crop,          key: 'selection' },
    { id: 'element',   icon: MousePointer2, key: 'element' },
  ];

  const error = result && !result.ok ? result.error : null;
  // Region / element picks show their result as a card on the captured page,
  // so there is nothing to preview here.
  const previewUrl = result?.ok && !result.onPage ? result.dataUrl : null;

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`nav-btn flex items-center gap-1.5 ${open ? 'text-primary' : ''}`}
        title={t('capture.shortcut_hint')}
      >
        <Camera size={16} />
        <span className="hidden md:inline">{t('capture.button')}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-2 w-[420px] origin-top-right overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[13px] font-bold">
                <Camera size={15} className="text-primary" />
                {t('capture.title')}
              </div>
              <button onClick={() => setOpen(false)} className="icon-btn">
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {modes.map(({ id, icon: Icon, key }) => (
                <button
                  key={id}
                  disabled={phase !== 'idle'}
                  onClick={() => request(id)}
                  className="group flex flex-col items-start gap-1.5 rounded-lg border border-line bg-panel p-2.5 text-left transition-colors duration-150 hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon size={16} className="text-primary" />
                  <span className="text-[12.5px] font-semibold leading-tight">
                    {t(`capture.mode.${key}.label`)}
                  </span>
                  <span className="text-[11px] leading-snug text-muted">
                    {t(`capture.mode.${key}.desc`)}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-line bg-panelAlt px-3.5 py-2.5">
              <AdvancedCapture onPick={(sel) => request('element', sel)} disabled={phase !== 'idle'} />
            </div>

            <div className="border-t border-line p-3.5">
              {phase === 'picking' && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] text-primary">
                  <Loader2 size={14} className="animate-spin" />
                  {t('capture.picking')}
                </div>
              )}
              {phase === 'capturing' && (
                <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[12px] text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  {t('capture.capturing')}
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span className="break-all">{error}</span>
                </div>
              )}
              {previewUrl && result?.ok && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>
                      {result.width}×{result.height}
                      {result.bytes ? ` · ${(result.bytes / 1024).toFixed(1)} KB` : ''}
                    </span>
                    <span className="truncate" title={result.filename}>{result.filename}</span>
                  </div>
                  <img
                    src={previewUrl}
                    alt="capture preview"
                    className="max-h-48 w-full rounded-md border border-line object-contain"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const blob = await dataUrlToBlob(previewUrl);
                          await copyBlobToClipboard(blob);
                          setCopied(true);
                        } catch (e) {
                          // Fallback: at least let the user copy the data URL.
                          await navigator.clipboard.writeText(previewUrl).catch(() => {});
                          console.warn('clipboard image copy failed', e);
                        }
                      }}
                      className="ghost-btn flex flex-1 items-center justify-center gap-1.5"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? t('capture.copied') : t('capture.copy')}
                    </button>
                    <button
                      onClick={() => downloadDataUrl(previewUrl, result.filename)}
                      className="primary-btn flex flex-1 items-center justify-center gap-1.5"
                    >
                      <Download size={13} />
                      {t('capture.download')}
                    </button>
                  </div>
                </div>
              )}
              {phase === 'idle' && result?.ok && result.onPage && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] text-primary">
                  <Check size={14} className="shrink-0" />
                  {t('capture.on_page')}
                </div>
              )}
              {phase === 'idle' && !result && (
                <p className="text-[11px] text-muted">
                  {t('capture.hint')}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Advanced: paste a CSS selector or use the running-tool selector to capture
 * a specific element on the *active tab* (works for any page, not just the
 * Loadix dashboard).
 */
function AdvancedCapture({ onPick, disabled }: { onPick: (selector: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const [selector, setSelector] = useState('#root');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {t('capture.advanced.title')}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          className="field flex-1 font-mono text-[12px]"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          placeholder="e.g. article, #main, [data-id]"
          spellCheck={false}
        />
        <button
          disabled={disabled || !selector.trim()}
          onClick={() => onPick(selector.trim())}
          className="primary-btn whitespace-nowrap"
        >
          {t('capture.advanced.run')}
        </button>
      </div>
      <p className="text-[10.5px] text-muted">{t('capture.advanced.hint')}</p>
    </div>
  );
}
