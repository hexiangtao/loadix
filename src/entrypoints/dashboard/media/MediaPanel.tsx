/**
 * Media panel — the third first-class surface (beside Markdown / API).
 *
 * Two ingestion modes, one UI:
 *  - Extension: a live sniffer runs in the service worker; this panel asks
 *    for the active tab's captures (`media:list`) and renders them grouped
 *    by kind (video / audio / streams / other), with per-asset details and
 *    the download flow (HLS merge included).
 *  - Web: no cross-tab sight — paste a media / m3u8 URL and the identical
 *    classify → download pipeline runs on it.
 *
 * Download runs in this page: the extension page is CORS-exempt through
 * `<all_urls>`, and File System Access streams big merges straight to disk.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Film,
  Music,
  Radio,
  RefreshCw,
  Trash2,
  Link as LinkIcon,
  Lock,
  Loader2,
  CheckCircle2,
  XCircle,
  ClipboardPaste,
} from 'lucide-react';
import { assetIdFor, classifyRequest } from './mediaClassify';
import type { MediaAsset, MediaTask } from './mediaTypes';
import { KIND_META } from './mediaTypes';
import { canStreamToDisk, startDownload, type DownloadHandle } from './hlsDownload';

interface MediaPanelProps {
  /** false on the web build — no sniffer, paste-URL mode only. */
  extensionMode: boolean;
}

const GROUP_ORDER = ['stream', 'video', 'audio', 'subtitle', 'other'] as const;
type GroupKind = (typeof GROUP_ORDER)[number];

export function MediaPanel({ extensionMode }: MediaPanelProps) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteError, setPasteError] = useState('');
  const handlesRef = useRef(new Map<string, DownloadHandle>());

  /* ——— Sniffer wiring (extension only) ——— */

  const refresh = useCallback(async (id: number) => {
    const response = await chrome.runtime.sendMessage({ type: 'media:list', tabId: id });
    if (response?.type === 'media:list') setAssets(response.assets as MediaAsset[]);
  }, []);

  useEffect(() => {
    if (!extensionMode) return;
    let disposed = false;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (disposed || !tab?.id) return;
      setTabId(tab.id);
      void refresh(tab.id);
    });
    const timer = window.setInterval(() => {
      if (tabId != null) void refresh(tabId);
    }, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [extensionMode, tabId, refresh]);

  /* ——— Paste-URL ingestion (web) ——— */

  const ingestPaste = useCallback(() => {
    const url = pasteUrl.trim();
    setPasteError('');
    if (!url) return;
    const asset = classifyRequest({ url, live: false, pageUrl: '' });
    if (!asset) {
      setPasteError(t('media.pasteUnrecognized'));
      return;
    }
    const full: MediaAsset = {
      ...asset,
      id: assetIdFor(url),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hits: 1,
    };
    setAssets((prev) => [full, ...prev.filter((a) => a.id !== full.id)]);
    setSelectedId(full.id);
    setPasteUrl('');
  }, [pasteUrl, t]);

  /* ——— Download flow ——— */

  const startAssetDownload = useCallback(
    (asset: MediaAsset, variantUrl?: string) => {
      // The save dialog must open inside the click's user activation —
      // startDownload invokes the picker synchronously for that reason.
      // Insert ONLY here: onTask upserts the same id, so a manual prepend
      // would race it into duplicate rows/keys.
      const handle = startDownload(
        asset,
        { variantUrl },
        {
          onTask: (task) => setTasks((prev) => upsert(prev, task)),
          onDone: (task) => setTasks((prev) => upsert(prev, task)),
          onError: (task) => setTasks((prev) => upsert(prev, task)),
        },
      );
      handlesRef.current.set(handle.task.id, handle);
      setTasks((prev) => upsert(prev, handle.task));
    },
    [],
  );

  const selected = useMemo(() => assets.find((a) => a.id === selectedId) ?? null, [assets, selectedId]);

  const grouped = useMemo(() => {
    const groups = new Map<GroupKind, MediaAsset[]>();
    for (const asset of assets) {
      const kind = (GROUP_ORDER as readonly string[]).includes(asset.kind) ? (asset.kind as GroupKind) : 'other';
      const bucket = groups.get(kind) ?? [];
      bucket.push(asset);
      groups.set(kind, bucket);
    }
    for (const bucket of groups.values()) bucket.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return groups;
  }, [assets]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ——— Header row ——— */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Film className="size-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t('media.title')}</h2>
            <p className="text-[11px] text-muted">
              {extensionMode ? t('media.subtitleExtension') : t('media.subtitleWeb')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {extensionMode && tabId != null && (
            <button className="btn-ghost flex items-center gap-1.5 text-[12px]" onClick={() => void refresh(tabId)}>
              <RefreshCw className="size-3.5" /> {t('media.refresh')}
            </button>
          )}
          {assets.length > 0 && (
            <button
              className="btn-ghost flex items-center gap-1.5 text-[12px] text-danger"
              onClick={() => {
                setAssets([]);
                setSelectedId(null);
                if (extensionMode && tabId != null) void chrome.runtime.sendMessage({ type: 'media:clear', tabId });
              }}
            >
              <Trash2 className="size-3.5" /> {t('media.clear')}
            </button>
          )}
        </div>
      </div>

      {/* ——— Paste-URL box (always available; primary on web) ——— */}
      <div className="border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="size-4 shrink-0 text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
            placeholder={t('media.pastePlaceholder')}
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ingestPaste();
            }}
          />
          <button className="btn-ghost flex items-center gap-1.5 text-[12px]" onClick={() => void navigator.clipboard?.readText?.().then((text) => setPasteUrl(text)).catch(() => undefined)}>
            <ClipboardPaste className="size-3.5" /> {t('media.pasteFromClipboard')}
          </button>
          <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={ingestPaste}>
            {t('media.analyze')}
          </button>
        </div>
        {pasteError && <p className="mt-2 text-[11px] text-danger">{pasteError}</p>}
      </div>

      {/* ——— Body ——— */}
      <div className="flex min-h-0 flex-1">
        {/* Asset list */}
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {assets.length === 0 ? (
            <EmptyState extensionMode={extensionMode} />
          ) : (
            <div className="space-y-5">
              {GROUP_ORDER.map((kind) => {
                const bucket = grouped.get(kind);
                if (!bucket?.length) return null;
                const meta = KIND_META[kind];
                return (
                  <section key={kind}>
                    <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <GroupIcon kind={kind} className={`size-3.5 ${meta.className}`} />
                      {t(`media.kind_${kind}`)}
                      <span className="text-[10px] font-normal">· {bucket.length}</span>
                    </h3>
                    <div className="space-y-2">
                      {bucket.map((asset) => (
                        <AssetRow
                          key={asset.id}
                          asset={asset}
                          selected={asset.id === selectedId}
                          onSelect={() => setSelectedId(asset.id)}
                          onDownload={() => startAssetDownload(asset)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Details rail */}
        {selected && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-line px-5 py-4">
            <AssetDetails asset={selected} tasks={tasks.filter((task) => task.assetId === selected.id)} onDownload={startAssetDownload} />
          </aside>
        )}
      </div>

      {/* ——— Active downloads bar ——— */}
      {tasks.length > 0 && (
        <div className="border-t border-line px-6 py-2.5">
          <div className="space-y-1.5">
            {tasks.slice(0, 4).map((task) => (
              <TaskRow key={task.id} task={task} onCancel={() => handlesRef.current.get(task.id)?.cancel()} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function upsert(list: MediaTask[], task: MediaTask): MediaTask[] {
  const index = list.findIndex((item) => item.id === task.id);
  if (index === -1) return [task, ...list];
  const next = [...list];
  next[index] = task;
  return next;
}

function GroupIcon({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'audio') return <Music className={className} />;
  if (kind === 'stream') return <Radio className={className} />;
  return <Film className={className} />;
}

function AssetRow({ asset, selected, onSelect, onDownload }: { asset: MediaAsset; selected: boolean; onSelect: () => void; onDownload: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        selected ? 'border-primary/60 bg-primary/5' : 'border-line hover:bg-hover'
      }`}
      onClick={onSelect}
    >
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-muted/10 ${KIND_META[asset.kind]?.className ?? ''}`}>
        <GroupIcon kind={asset.kind} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{asset.fileName}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="truncate">{shortenUrl(asset.url)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {asset.encryption === 'drm' && (
          <span className="flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
            <Lock className="size-3" /> DRM
          </span>
        )}
        {asset.size != null && asset.size > 0 && <span className="text-[11px] text-muted">{formatBytes(asset.size)}</span>}
        {asset.container === 'hls' ? (
          <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">HLS</span>
        ) : asset.container === 'dash' ? (
          <span className="rounded-md bg-violet/10 px-1.5 py-0.5 text-[10px] text-violet">DASH</span>
        ) : null}
        <button
          className="btn-ghost grid size-7 place-items-center opacity-0 transition-opacity group-hover:opacity-100"
          title={t('media.download')}
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
        >
          <Download className="size-4" />
        </button>
      </div>
    </div>
  );
}

function AssetDetails({
  asset,
  tasks,
  onDownload,
}: {
  asset: MediaAsset;
  tasks: MediaTask[];
  onDownload: (asset: MediaAsset, variantUrl?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <h3 className="break-all text-[14px] font-semibold text-ink">{asset.fileName}</h3>
        <p className="mt-1 break-all text-[11px] text-muted">{asset.url}</p>
      </div>
      <dl className="space-y-1.5 text-[12px]">
        <Detail label={t('media.kind')} value={t(`media.kind_${asset.kind}`)} />
        <Detail label={t('media.container')} value={asset.container.toUpperCase()} />
        {asset.contentType && <Detail label="Content-Type" value={asset.contentType} />}
        {asset.size != null && asset.size > 0 && <Detail label={t('media.size')} value={formatBytes(asset.size)} />}
        <Detail label={t('media.encryption')} value={asset.encryption === 'none' ? t('media.encNone') : asset.encryption.toUpperCase()} />
        {asset.hits > 1 && <Detail label={t('media.hits')} value={String(asset.hits)} />}
      </dl>
      {asset.encryption === 'drm' ? (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">{t('media.drmNote')}</p>
      ) : (
        <button className="btn-primary flex w-full items-center justify-center gap-2 py-2 text-[13px]" onClick={() => onDownload(asset)}>
          <Download className="size-4" /> {t('media.download')}
        </button>
      )}
      {!canStreamToDisk() && (
        <p className="text-[10px] text-muted">{t('media.memorySinkNote')}</p>
      )}
      {tasks.length > 0 && (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} compact onCancel={() => undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  );
}

function TaskRow({ task, onCancel, compact = false }: { task: MediaTask; onCancel: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const active = task.state === 'downloading' || task.state === 'preparing' || task.state === 'decrypting' || task.state === 'merging';
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'rounded-lg bg-surface px-3 py-2'}`}>
      {task.state === 'done' ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" />
      ) : task.state === 'error' ? (
        <XCircle className="size-4 shrink-0 text-danger" />
      ) : (
        <Loader2 className={`size-4 shrink-0 text-primary ${active ? 'animate-spin' : ''}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12px] text-ink">{task.title}</span>
          <span className="shrink-0 text-[10px] text-muted">
            {task.state === 'error'
              ? task.error ?? t('media.taskError')
              : `${Math.round(task.progress * 100)}%${task.segmentsTotal > 0 ? ` · ${task.segmentsDone}/${task.segmentsTotal}` : ''}`}
          </span>
        </div>
        {active && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/20">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, task.progress * 100)}%` }} />
          </div>
        )}
      </div>
      {active && !compact && (
        <button className="btn-ghost shrink-0 text-[11px] text-muted" onClick={onCancel}>
          {t('media.cancel')}
        </button>
      )}
    </div>
  );
}

function EmptyState({ extensionMode }: { extensionMode: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid place-items-center py-16 text-center">
      <div className="max-w-sm space-y-2">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted/10 text-muted">
          <Film className="size-6" />
        </span>
        <h3 className="text-[14px] font-semibold text-ink">{extensionMode ? t('media.emptyTitle') : t('media.emptyTitleWeb')}</h3>
        <p className="text-[12px] leading-relaxed text-muted">{extensionMode ? t('media.emptyHint') : t('media.emptyHintWeb')}</p>
      </div>
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
