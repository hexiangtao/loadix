import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Download, ClipboardCopy, RefreshCcw, AlertTriangle } from 'lucide-react';
import { toBlob, toPng } from 'html-to-image';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Target = 'page' | 'app' | 'panel' | 'selector';
type Background = 'transparent' | 'page' | 'panel';
type Format = 'png' | 'jpeg';
type Scale = 1 | 2;

/**
 * HTML → PNG screenshot tool.
 *
 * Why this exists: every other tool in the workbench operates on *data*
 * (JWT, JSON, hash, …). This one operates on the rendered DOM, which makes
 * it ideal for:
 *   - Chrome Web Store / documentation screenshots of the real UI
 *   - Bug reports: select a node, snap it, paste in the issue
 *   - Sharing a tool result (a rendered gradient, a JSON tree) with someone
 *     who doesn't have Loadix installed
 *
 * Implementation notes:
 *   - `html-to-image` walks the DOM and serialises it as a self-contained
 *     <svg>/<foreignObject> image. It is more accurate than html2canvas
 *     (no font / foreignObject quirks) and ~30 KB minified.
 *   - The full-page target snapshots the *entire* scrollable document, not
 *     just the viewport, so you get a 1:1 representation of a tall page.
 *   - The "app" target prefers the React root (`#root`) so the resulting
 *     image carries the real layout rather than a viewport-sized window.
 */
export function ScreenshotTool() {
  const { t } = useTranslation();

  // Persisted user choices.
  const [target, setTarget] = usePersistedState<Target>('screenshot.target', 'page');
  const [background, setBackground] = usePersistedState<Background>('screenshot.bg', 'page');
  const [format, setFormat] = usePersistedState<Format>('screenshot.format', 'png');
  const [scale, setScale] = usePersistedState<Scale>('screenshot.scale', 2);
  const [selector, setSelector] = usePersistedState<string>('screenshot.selector', '#root');

  // Ephemeral UI state.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{ w: number; h: number; bytes: number } | null>(null);

  // Avoid leaking object URLs across renders.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /** Resolve the current target choice to a real DOM node + capture bounds. */
  const resolveTarget = useCallback((): HTMLElement => {
    if (target === 'page') return document.documentElement;
    if (target === 'app') {
      return (document.getElementById('root')
        || document.querySelector<HTMLElement>('[data-loadix-root]')
        || document.body);
    }
    if (target === 'panel') {
      // The currently focused area: a tool panel in the tools view, or the
      // load-test column in the load-test view. Falls back to <main> / #root.
      const el = document.querySelector<HTMLElement>('[data-screenshot-target="panel"]')
        || document.querySelector<HTMLElement>('[data-screenshot-target="loadtest"]')
        || document.querySelector<HTMLElement>('main')
        || document.querySelector<HTMLElement>('#root > *');
      if (el) return el;
    }
    // 'selector'
    const found = document.querySelector<HTMLElement>(selector.trim());
    if (!found) throw new Error(t('tools.screenshot.selectorNotFound', { selector }));
    return found;
  }, [target, selector, t]);

  const bgFor = useCallback((): string | null => {
    if (format === 'jpeg' || background === 'page') {
      // JPEG has no alpha; always paint the page background. Page bg is the
      // CSS --color-surface token.
      return getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#f5f5f7';
    }
    if (background === 'panel') {
      return getComputedStyle(document.documentElement).getPropertyValue('--color-panel').trim() || '#ffffff';
    }
    return null; // transparent
  }, [background, format]);

  const capture = useCallback(async (): Promise<{ blob: Blob; url: string; w: number; h: number } | null> => {
    setError(null);
    setBusy(true);
    try {
      const node = resolveTarget();
      const rect = node.getBoundingClientRect();
      const w = Math.ceil(node.scrollWidth || rect.width);
      const h = Math.ceil(node.scrollHeight || rect.height);
      const bg = bgFor();

      // Reset inline transitions/animations for a clean capture.
      const opts = {
        pixelRatio: scale,
        backgroundColor: bg ?? undefined,
        cacheBust: true,
        // Walk the entire document height even when capturing the body.
        width: w,
        height: h,
        style: {
          // Strip the toolbar's fixed positioning that would otherwise cover
          // the body in a sticky way during rasterisation.
          transform: 'none',
          transformOrigin: 'top left',
        },
      } as const;

      const blob = format === 'png'
        ? await toBlob(node, opts)
        : await (async () => {
            const dataUrl = await toPng(node, opts);
            // Convert PNG → JPEG via an off-screen canvas.
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');
            if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); }
            ctx.drawImage(img, 0, 0);
            const jpegBlob: Blob | null = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
            if (!jpegBlob) throw new Error('JPEG encoding failed');
            return jpegBlob;
          })();

      if (!blob) throw new Error('Renderer returned no image');
      const url = URL.createObjectURL(blob);
      return { blob, url, w, h };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [resolveTarget, bgFor, format, scale]);

  /** Render a preview and store it for the user to inspect. */
  const handlePreview = useCallback(async () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const result = await capture();
    if (!result) return;
    setPreviewUrl(result.url);
    setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
  }, [capture, previewUrl]);

  /** Download the latest preview (or capture a fresh one if none). */
  const handleDownload = useCallback(async () => {
    const result = previewUrl
      ? null
      : await capture();
    const blob = result?.blob
      ?? (await fetch(previewUrl ?? '').then((r) => r.blob()).catch(() => null));
    if (!blob) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = previewUrl ?? URL.createObjectURL(blob);
    a.download = `loadix-${target}-${ts}.${format === 'png' ? 'png' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (result) {
      URL.revokeObjectURL(a.href);
      setPreviewUrl(result.url);
      setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
    }
  }, [capture, previewUrl, target, format]);

  /** Copy the image to the clipboard (PNG only — JPEG is downloadable). */
  const handleCopy = useCallback(async () => {
    if (!previewUrl) {
      const result = await capture();
      if (!result) return;
      setPreviewUrl(result.url);
      setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
    }
    try {
      const blob = await fetch(previewUrl!).then((r) => r.blob());
      // Clipboard API requires PNG for image/* writes in Chromium.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [capture, previewUrl]);

  const metaText = lastMeta
    ? `${lastMeta.w} × ${lastMeta.h}  ·  ${(lastMeta.bytes / 1024).toFixed(1)} KB  ·  ${format.toUpperCase()}  ·  ${scale}×`
    : '';

  return (
    <ToolShell icon={Camera} title={t('tools.screenshot.name')}>
      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        {/* ——— Controls ——— */}
        <div className="flex w-full flex-col gap-3 lg:w-72">
          <Field label={t('tools.screenshot.target')}>
            <select
              className="field w-full"
              value={target}
              onChange={(e) => setTarget(e.target.value as Target)}
            >
              <option value="page">{t('tools.screenshot.target_page')}</option>
              <option value="app">{t('tools.screenshot.target_app')}</option>
              <option value="panel">{t('tools.screenshot.target_panel')}</option>
              <option value="selector">{t('tools.screenshot.target_selector')}</option>
            </select>
          </Field>

          {target === 'selector' && (
            <Field label={t('tools.screenshot.selector')}>
              <input
                className="field w-full font-mono"
                placeholder="#root, .panel, [data-…]"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
              />
            </Field>
          )}

          <Field label={t('tools.screenshot.format')}>
            <div className="flex gap-1">
              {(['png', 'jpeg'] as Format[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
                    format === f
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-panel text-muted hover:border-primary hover:text-primary'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('tools.screenshot.background')}>
            <select
              className="field w-full"
              value={background}
              onChange={(e) => setBackground(e.target.value as Background)}
              disabled={format === 'jpeg'}
            >
              <option value="page">{t('tools.screenshot.bg_page')}</option>
              <option value="panel">{t('tools.screenshot.bg_panel')}</option>
              <option value="transparent" disabled={format === 'jpeg'}>
                {t('tools.screenshot.bg_transparent')}
              </option>
            </select>
          </Field>

          <Field label={t('tools.screenshot.scale')}>
            <div className="flex gap-1">
              {([1, 2] as Scale[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
                    scale === s
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-panel text-muted hover:border-primary hover:text-primary'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </Field>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handlePreview}
              disabled={busy}
              className="primary-btn flex items-center gap-1.5"
            >
              <Camera size={14} />
              {busy ? t('tools.screenshot.busy') : t('tools.screenshot.capture')}
            </button>
            <button
              onClick={handleDownload}
              disabled={busy}
              className="ghost-btn flex items-center gap-1.5"
            >
              <Download size={14} />
              {t('tools.screenshot.download')}
            </button>
            <button
              onClick={handleCopy}
              disabled={busy || format === 'jpeg'}
              title={format === 'jpeg' ? t('tools.screenshot.copyJpegHint') : undefined}
              className="ghost-btn flex items-center gap-1.5"
            >
              <ClipboardCopy size={14} />
              {t('tools.screenshot.copy')}
            </button>
          </div>

          {metaText && (
            <p className="text-[11px] text-muted">{metaText}</p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[12px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer select-none">{t('tools.screenshot.tips_title')}</summary>
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li>{t('tools.screenshot.tip_dpr')}</li>
              <li>{t('tools.screenshot.tip_full')}</li>
              <li>{t('tools.screenshot.tip_selector')}</li>
            </ul>
          </details>
        </div>

        {/* ——— Preview ——— */}
        <div className="flex min-h-[400px] flex-1 flex-col rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
            <span>{t('tools.screenshot.preview')}</span>
            {previewUrl && (
              <button
                onClick={() => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setLastMeta(null);
                }}
                className="icon-btn flex items-center gap-1 px-2"
                title={t('tools.screenshot.clear')}
              >
                <RefreshCcw size={12} />
                {t('tools.screenshot.clear')}
              </button>
            )}
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="screenshot preview"
                className="max-w-full rounded-md border border-line shadow-sm"
                style={{ imageRendering: 'auto' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center text-muted">
                <Camera size={36} className="opacity-30" />
                <p className="text-[13px]">{t('tools.screenshot.empty')}</p>
                <p className="max-w-xs text-[11px]">{t('tools.screenshot.emptyHint')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
