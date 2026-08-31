import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Download, ClipboardCopy, AlertTriangle } from 'lucide-react';
import { toBlob, toPng } from 'html-to-image';
import { ToolShell } from '../ToolShell';
import { usePersistedState } from '../usePersistedState';

type Background = 'transparent' | 'page' | 'panel';
type Format = 'png' | 'jpeg';
type Scale = 1 | 2;

/**
 * Capture a specific DOM element on the *current* Loadix dashboard as PNG
 * or JPEG. The toolbar's <CapturePopover> handles the broader cases
 * (visible tab, full page, region, element on any page) — this tool is
 * the ergonomic "snap a tool result" entry: pick a CSS selector, get the
 * rendered image.
 *
 * Useful for: saving a single tool's output (a gradient, a JSON tree,
 * a regex match), embedding a panel in a doc, or getting a tight crop
 * of one element without leaving the workbench.
 */
export function ScreenshotTool() {
  const { t } = useTranslation();

  const [background, setBackground] = usePersistedState<Background>('screenshot.bg', 'page');
  const [format, setFormat] = usePersistedState<Format>('screenshot.format', 'png');
  const [scale, setScale] = usePersistedState<Scale>('screenshot.scale', 2);
  const [selector, setSelector] = usePersistedState<string>('screenshot.selector', '#root');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{ w: number; h: number; bytes: number } | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const setUrl = (url: string | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  const bgFor = useCallback((): string | null => {
    if (format === 'jpeg' || background === 'page') {
      return getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#f5f5f7';
    }
    if (background === 'panel') {
      return getComputedStyle(document.documentElement).getPropertyValue('--color-panel').trim() || '#ffffff';
    }
    return null;
  }, [background, format]);

  const capture = useCallback(async (): Promise<{ blob: Blob; url: string; w: number; h: number } | null> => {
    setError(null);
    setBusy(true);
    try {
      const node = document.querySelector<HTMLElement>(selector.trim());
      if (!node) throw new Error(t('tools.screenshot.selectorNotFound', { selector }));
      const w = Math.ceil(node.scrollWidth || node.getBoundingClientRect().width);
      const h = Math.ceil(node.scrollHeight || node.getBoundingClientRect().height);
      const bg = bgFor();

      const opts = {
        pixelRatio: scale,
        backgroundColor: bg ?? undefined,
        cacheBust: true,
        width: w,
        height: h,
      } as const;

      const blob = format === 'png'
        ? await toBlob(node, opts)
        : await (async () => {
            const dataUrl = await toPng(node, opts);
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
  }, [selector, bgFor, format, scale, t]);

  const handlePreview = useCallback(async () => {
    setUrl(null);
    const result = await capture();
    if (!result) return;
    setUrl(result.url);
    setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
  }, [capture]);

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
    a.download = `loadix-element-${ts}.${format === 'png' ? 'png' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (result) {
      URL.revokeObjectURL(a.href);
      setUrl(result.url);
      setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
    }
  }, [capture, previewUrl, format]);

  const handleCopy = useCallback(async () => {
    if (!previewUrl) {
      const result = await capture();
      if (!result) return;
      setUrl(result.url);
      setLastMeta({ w: result.w, h: result.h, bytes: result.blob.size });
    }
    try {
      const blob = await fetch(previewUrl!).then((r) => r.blob());
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
        <div className="flex w-full flex-col gap-3 lg:w-72">
          <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] text-primary">
            {t('tools.screenshot.workbench_only')}
          </p>

          <Field label={t('tools.screenshot.selector')}>
            <input
              className="field w-full font-mono"
              placeholder="#root, .panel, [data-…]"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              spellCheck={false}
            />
          </Field>

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
            <button onClick={handlePreview} disabled={busy} className="primary-btn flex items-center gap-1.5">
              <Camera size={14} />
              {busy ? t('tools.screenshot.busy') : t('tools.screenshot.capture')}
            </button>
            <button onClick={handleDownload} disabled={busy} className="ghost-btn flex items-center gap-1.5">
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

          {metaText && <p className="text-[11px] text-muted">{metaText}</p>}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[12px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <div className="flex min-h-[400px] flex-1 flex-col rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-3 py-2 text-[12px] text-muted">
            {t('tools.screenshot.preview')}
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="screenshot preview"
                className="max-w-full rounded-md border border-line shadow-sm"
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
