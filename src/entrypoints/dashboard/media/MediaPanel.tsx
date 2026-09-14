/**
 * Media panel — the third first-class surface (beside Markdown / API).
 *
 * Layout doctrine (production-standard downloader):
 *   - A segmented switch splits the two mental models: LIVE CAPTURE
 *     (extension sniffer) vs LINK RESOLVE (paste a page/media URL).
 *   - A resolved page renders as a HERO card: poster · title · format
 *     ladder with one recommended action — the money moment gets weight.
 *   - Downloads live in a bottom DOCK with speed/ETA/retry — half the
 *     product in any downloader, not an afterthought strip.
 *   - The panel is kept alive by App across view switches; state (and
 *     running downloads) survive navigation.
 *
 * Download runs in this page: the extension page is CORS-exempt through
 * `<all_urls>`, and File System Access streams big merges straight to disk.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Link as LinkIcon,
  ListVideo,
  Loader2,
  Lock,
  Music,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { assetIdFor, classifyRequest } from './mediaClassify';
import type { MediaAsset, MediaTask } from './mediaTypes';
import { KIND_META } from './mediaTypes';
import {
  canStreamToDisk,
  downloadDirectoryName,
  pickDownloadDirectory,
  discardIdleResumes,
  startDownload,
  type DownloadCallbacks,
  type DownloadHandle,
  type DownloadOptions,
} from './hlsDownload';
import { DownloadQueue, type JobContext, type QueueEntry, type QueueJob } from './downloadQueue';
import {
  extractUrlFromText,
  fetchableUrl,
  fileNameForCover,
  fileNameForFormat,
  fileNameForPart,
  originalImageUrl,
  preferredFormat,
  SUPPORTED_PLATFORMS,
  withPartParam,
  type MediaFormatOption,
  type ResolvedPageAsset,
  type VideoPart,
} from './mediaResolver';

interface MediaPanelProps {
  /** false on the web build — no sniffer, paste-URL mode only. */
  extensionMode: boolean;
}

/** Resolve the tab whose media the user cares about: the active tab unless
 *  that IS the dashboard (the normal case — the dashboard is an extension
 *  page), then the last real page browsed in this window. The sniffer
 *  keys captures by that page's tab id, not the dashboard's. */
async function resolveTargetTab(): Promise<number | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && !active.url?.startsWith('chrome-extension://')) return active.id;
  const currentWindow = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ active: false, windowId: currentWindow?.id });
  // Most recently browsed non-dashboard tab with captured media potential:
  // prefer http(s) pages over new-tab/special pages.
  const candidates = tabs
    .filter((tab) => tab.id != null && /^https?:/i.test(tab.url ?? ''))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0]?.id ?? null;
}

const GROUP_ORDER = ['stream', 'video', 'audio', 'subtitle', 'other'] as const;
type GroupKind = (typeof GROUP_ORDER)[number];
type PanelTab = 'resolve' | 'capture';

/* ------------------------------------------------------------------ */
/* Queued work                                                         */
/* ------------------------------------------------------------------ */

/** Everything a queued download needs, so a retry re-runs the identical job
 *  without a retained closure per click — the job IS the retry state. */
type MediaJob =
  | { kind: 'format'; format: MediaFormatOption; page: ResolvedPageAsset; label?: string }
  | { kind: 'asset'; asset: MediaAsset; variantUrl?: string }
  | { kind: 'cover'; page: ResolvedPageAsset }
  /** A part of a multi-part video: resolved when its turn comes, because the
   *  part's formats do not exist until the page for that part is fetched. */
  | { kind: 'part'; pageUrl: string; part: VideoPart; prefer?: { quality?: string; container?: MediaFormatOption['container'] } };

/** Resolve a watch page on whichever build this is. The extension asks its
 *  service worker (which can send browser-shaped headers); the web build asks
 *  its own backend, because Bilibili refuses cross-origin browser calls. */
async function resolvePageForBuild(pageUrl: string, extensionMode: boolean): Promise<ResolvedPageAsset> {
  if (extensionMode) {
    const response = await chrome.runtime.sendMessage({ type: 'media:scrape', pageUrl });
    if (response?.type !== 'media:scrape' || response.error) throw new Error(String(response?.error ?? 'resolve-failed'));
    return response.resolved as ResolvedPageAsset;
  }
  const res = await fetch('/api/resolve?pageUrl=' + encodeURIComponent(pageUrl));
  const body = (await res.json().catch(() => null)) as { resolved?: ResolvedPageAsset; error?: string } | null;
  if (!res.ok || !body || body.error) throw new Error(String(body?.error ?? `HTTP ${res.status}`));
  return body.resolved!;
}

/** One row per (page, format, part). Retrying reuses the id, so the dock
 *  replaces the failed row instead of stacking a duplicate beside it. */
function queueId(format: MediaFormatOption, page: ResolvedPageAsset, label?: string): string {
  return `fmt:${page.pageUrl}:${format.key}:${label ?? ''}`;
}

/** Where a part lives. A Bilibili 分P is the same page with `?p=n`, but a
 *  番剧 episode is its own URL — the adapter says which, and anything
 *  without one falls back to the query-parameter convention. */
function partPageUrl(pageUrl: string, part: VideoPart): string {
  return part.url ?? withPartParam(pageUrl, part.index);
}

/** How a part is named in the dock and on disk. The site's own episode
 *  title beats a bare P-number, but the number stays in front so a batch is
 *  still ordered and identifiable. */
function partLabel(part: VideoPart): string {
  const auto = `P${part.index}`;
  return part.title && part.title !== auto ? `${auto} ${part.title}` : auto;
}

/** Build the asset + options the download engine consumes for one format.
 *  Only the Referer-gated DASH video track needs the same-origin proxy on the
 *  web build; the muxed MP4 and the audio track are fetched directly. */
function formatSpawn(
  format: MediaFormatOption,
  page: ResolvedPageAsset,
  extensionMode: boolean,
  callbacks: DownloadCallbacks,
  label?: string,
): DownloadHandle {
  const fileName = fileNameForFormat(page.title, format, label);
  if (format.container === 'hls') {
    const asset: MediaAsset = {
      id: assetIdFor(format.url),
      kind: 'stream',
      container: 'hls',
      url: format.url,
      method: 'GET',
      contentType: 'application/vnd.apple.mpegurl',
      size: null,
      fileName,
      encryption: 'unknown',
      requestHeaders: [],
      live: false,
      pageUrl: page.pageUrl,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hits: 1,
    };
    return startDownload(asset, { fileName }, callbacks);
  }
  const gated = format.requiresReferer === true;
  const options: DownloadOptions = {
    fileName,
    backupUrls: format.backupUrls.map((url) => fetchableUrl(url, extensionMode, gated)),
    companionUrl: format.companionUrl ? fetchableUrl(format.companionUrl, extensionMode) : undefined,
    companionBackupUrls: (format.companionBackupUrls ?? []).map((url) => fetchableUrl(url, extensionMode)),
  };
  return startDownload(
    {
      id: assetIdFor(format.url),
      kind: format.container === 'dash-audio' ? 'audio' : 'video',
      container: 'file',
      url: fetchableUrl(format.url, extensionMode, gated),
      method: 'GET',
      contentType: '',
      size: format.size || null,
      fileName,
      encryption: 'none',
      requestHeaders: [],
      live: false,
      pageUrl: page.pageUrl,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hits: 1,
    },
    options,
    callbacks,
  );
}

/** Poster download: the original full-resolution artwork, not the share-sized
 *  crop the card shows. Its CDN is CORS-open, so this never pays for the
 *  proxy in either build. */
function coverSpawn(page: ResolvedPageAsset, extensionMode: boolean, callbacks: DownloadCallbacks): DownloadHandle {
  const fileName = fileNameForCover(page.title);
  const source = fetchableUrl(originalImageUrl(page.cover ?? ''), extensionMode);
  return startDownload(
    {
      id: assetIdFor(source),
      kind: 'image',
      container: 'file',
      url: source,
      method: 'GET',
      contentType: 'image/jpeg',
      size: null,
      fileName,
      encryption: 'none',
      requestHeaders: [],
      live: false,
      pageUrl: page.pageUrl,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hits: 1,
    },
    { fileName },
    callbacks,
  );
}

/** The queue's runner. A part returns a promise because resolving it is real
 *  network work — the row shows `resolving` until its handle exists. */
function runMediaJob(job: QueueJob<MediaJob>, context: JobContext, extensionMode: boolean): DownloadHandle | Promise<DownloadHandle> {
  const meta = job.meta;
  if (meta.kind === 'asset') return startDownload(meta.asset, { variantUrl: meta.variantUrl }, context.callbacks);
  if (meta.kind === 'cover') return coverSpawn(meta.page, extensionMode, context.callbacks);
  if (meta.kind === 'format') return formatSpawn(meta.format, meta.page, extensionMode, context.callbacks, meta.label);

  return (async (): Promise<DownloadHandle> => {
    const resolved = await resolvePageForBuild(partPageUrl(meta.pageUrl, meta.part), extensionMode);
    // The user may have canceled while this was in flight; the queue aborts
    // the signal, and the caller turns this rejection into a canceled row.
    if (context.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const format = preferredFormat(resolved.formats, meta.prefer) ?? resolved.formats[0];
    if (!format) throw new Error('resolve-failed');
    return formatSpawn(format, resolved, extensionMode, context.callbacks, partLabel(meta.part));
  })();
}

export function MediaPanel({ extensionMode }: MediaPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PanelTab>('resolve');
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [scraping, setScraping] = useState(false);
  /** Resolved watch-page result — the hero card on the resolve tab. */
  const [resolved, setResolved] = useState<ResolvedPageAsset | null>(null);
  /** Every download goes through the queue — it caps how many run at once,
   *  and it is what keeps a row cancellable and retryable long after the
   *  click that created it is gone. The runner is module scope, so the
   *  instance survives re-renders. */
  const queue = useMemo(
    () => new DownloadQueue<MediaJob>({ run: (job, context) => runMediaJob(job, context, extensionMode) }),
    [extensionMode],
  );
  const downloads = useSyncExternalStore(queue.subscribe, () => queue.entries, () => queue.entries);
  /** Mirrors the queue's pause flag so the button can label itself. */
  const [queuePaused, setQueuePaused] = useState(false);
  /** Where batch downloads land. A queued job has no user activation, so the
   *  folder has to be chosen up front — see `pickDownloadDirectory`. */
  const [folderName, setFolderName] = useState<string | null>(() => downloadDirectoryName());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ——— Sniffer wiring (extension only) ——— */

  const refresh = useCallback(async (id: number) => {
    const response = await chrome.runtime.sendMessage({ type: 'media:list', tabId: id });
    if (response?.type === 'media:list') setAssets(response.assets as MediaAsset[]);
  }, []);

  useEffect(() => {
    if (!extensionMode) return;
    let disposed = false;
    const resolveAndRefresh = () => {
      void resolveTargetTab().then((id) => {
        if (disposed) return;
        setTabId(id);
        if (id != null) void refresh(id);
        else setAssets([]);
      });
    };
    resolveAndRefresh();
    // Re-resolve on tab switches: the user flips to Loadix after playing a
    // video, and the list must follow the tab that actually has captures.
    const onActivated = (info: chrome.tabs.TabActiveInfo) => {
      void chrome.tabs.get(info.tabId).then((tab) => {
        if (disposed || !tab.url?.startsWith('chrome-extension://')) return;
        resolveAndRefresh();
      });
    };
    chrome.tabs.onActivated.addListener(onActivated);
    const timer = window.setInterval(() => {
      if (tabId != null) void refresh(tabId);
    }, 2000);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      window.clearInterval(timer);
    };
  }, [extensionMode, tabId, refresh]);

  /* ——— Paste-URL ingestion (both builds) ———
   * Direct media URLs classify instantly. Page URLs (bilibili.com/video/…)
   * resolve to a format list: web build → /api/resolve (our backend; Bilibili
   * 403s cross-origin browser calls, the CDN bytes are open so downloads go
   * direct); extension → the service worker performs the identical chain. */

  const ingestPaste = useCallback((raw: string) => {
    // Users paste the whole share sheet (「【标题】 https://b23.tv/…」), not a
    // bare URL — take the link out of it before classifying.
    const url = extractUrlFromText(raw);
    setPasteError('');
    if (!url) return;
    const asset = classifyRequest({ url, live: false, pageUrl: '' });
    if (asset) {
      const full: MediaAsset = {
        ...asset,
        id: assetIdFor(url),
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        hits: 1,
      };
      setAssets((prev) => [full, ...prev.filter((a) => a.id !== full.id)]);
      setSelectedId(full.id);
      setTab('capture');
      setPasteUrl('');
      return;
    }
    // Not a media URL — resolve it as a watch page.
    setScraping(true);
    void resolvePageForBuild(url, extensionMode)
      .then((result) => {
        setScraping(false);
        if (!result || result.formats.length === 0) {
          setPasteError(t('media.scrapeEmpty'));
          return;
        }
        setResolved(result);
        setTab('resolve');
        setPasteUrl('');
      })
      .catch(() => {
        setScraping(false);
        setPasteError(t('media.scrapeFailed'));
      });
  }, [t, extensionMode]);

  /* ——— Download flow ———
   * Nothing here downloads. Every action only ENQUEUES, and the queue decides
   * when a job starts. That is what stops a twelve-part batch from opening
   * twelve simultaneous streams against one CDN, and what keeps a row
   * cancellable and retryable after the click that created it is long gone. */

  const enqueueFormat = useCallback(
    (format: MediaFormatOption, page: ResolvedPageAsset, label?: string) => {
      queue.add({
        id: queueId(format, page, label),
        title: label ? `${page.title} · ${label}` : page.title,
        fileName: fileNameForFormat(page.title, format, label),
        meta: { kind: 'format', format, page, label },
      });
    },
    [queue],
  );

  /** Batch entry from the part list. Each part resolves on its own turn and
   *  takes the quality the user is looking at — falling back to that part's
   *  best complete file whenever it does not offer that exact one. */
  const enqueueParts = useCallback(
    (parts: VideoPart[], page: ResolvedPageAsset, prefer?: { quality?: string; container?: MediaFormatOption['container'] }) => {
      for (const part of parts) {
        queue.add({
          id: `part:${part.cid || part.index}`,
          title: `${page.title} · ${partLabel(part)}`.trim(),
          fileName: fileNameForPart(page.title, part.index, part.title),
          meta: { kind: 'part', pageUrl: page.pageUrl, part, prefer },
        });
      }
    },
    [queue],
  );

  const enqueueAsset = useCallback(
    (asset: MediaAsset, variantUrl?: string) => {
      queue.add({
        id: `asset:${asset.id}:${variantUrl ?? ''}`,
        title: asset.fileName,
        fileName: asset.fileName,
        meta: { kind: 'asset', asset, variantUrl },
      });
    },
    [queue],
  );

  const enqueueCover = useCallback(
    (page: ResolvedPageAsset) => {
      if (!page.cover) return;
      queue.add({
        id: `cover:${assetIdFor(page.cover)}`,
        title: `${page.title} · ${t('media.shelfImage')}`,
        fileName: fileNameForCover(page.title),
        meta: { kind: 'cover', page },
      });
    },
    [queue, t],
  );

  /** Show another part's ladder. Re-resolving is the honest way to offer a
   *  hand-picked quality — each part has its own format list. */
  const openPart = useCallback(
    (page: ResolvedPageAsset, part: VideoPart) => {
      setScraping(true);
      void resolvePageForBuild(partPageUrl(page.pageUrl, part), extensionMode)
        .then((result) => {
          setScraping(false);
          if (result.formats.length > 0) setResolved(result);
        })
        .catch(() => {
          setScraping(false);
          setPasteError(t('media.scrapeFailed'));
        });
    },
    [extensionMode, t],
  );

  /** A batch needs somewhere to write that is not a per-file dialog: a save
   *  picker demands transient user activation, which a job the queue starts a
   *  minute later simply does not have. */
  const chooseFolder = useCallback(() => {
    void pickDownloadDirectory()
      .then((name) => {
        if (name) setFolderName(name);
      })
      .catch(() => undefined);
  }, []);

  const toggleQueuePause = useCallback(() => {
    if (queue.isPaused) {
      queue.resume();
      setQueuePaused(false);
    } else {
      queue.pause();
      setQueuePaused(true);
    }
  }, [queue]);

  const activeDownloads = downloads.filter((entry) => entry.state !== 'done' && entry.state !== 'error' && entry.state !== 'canceled');
  const failedCount = downloads.filter((entry) => entry.state === 'error').length;
  const hasFinished = downloads.some((entry) => entry.state === 'done' || entry.state === 'error' || entry.state === 'canceled');
  const waitingCount = downloads.filter((entry) => entry.state === 'queued').length;

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
      {/* ——— Header: identity + segmented mode switch ——— */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
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
        {extensionMode && (
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
            {(
              [
                ['resolve', t('media.tabResolve')],
                ['capture', t('media.tabCapture')],
              ] as [PanelTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
                  tab === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
                {id === 'capture' && assets.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{assets.length}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ——— Paste box: the primary input on every surface ——— */}
      <div className="shrink-0 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className="field w-full !py-2 !pl-9 !pr-3 placeholder:text-muted"
              placeholder={t('media.pastePlaceholder')}
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ingestPaste(pasteUrl);
              }}
            />
          </div>
          <button
            className="ghost-btn flex shrink-0 items-center gap-1.5"
            onClick={() => void navigator.clipboard?.readText?.().then((text) => setPasteUrl(text)).catch(() => undefined)}
          >
            <ClipboardPaste className="size-3.5" /> {t('media.pasteFromClipboard')}
          </button>
          <button
            className="primary-btn flex shrink-0 items-center gap-1.5"
            onClick={() => ingestPaste(pasteUrl)}
            disabled={scraping}
          >
            {scraping ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('media.analyze')}
          </button>
        </div>
        {pasteError && <p className="mt-2 text-[11px] text-danger">{pasteError}</p>}
      </div>

      {/* ——— Body ——— */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {tab === 'resolve' ? (
            resolved ? (
              <ResultCard
                resolved={resolved}
                onDownload={enqueueFormat}
                onDownloadParts={enqueueParts}
                onOpenPart={openPart}
                onDownloadCover={enqueueCover}
                onDismiss={() => setResolved(null)}
              />
            ) : (
              <ResolveEmptyState
                onTry={(url) => {
                  setPasteUrl(url);
                  ingestPaste(url);
                }}
              />
            )
          ) : assets.length === 0 ? (
            <CaptureEmptyState />
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted">
                  {t('media.listeningPrefix')} <span className="font-medium text-ink">{t('media.listeningTab')}</span>
                </p>
                <div className="flex items-center gap-2">
                  <button className="ghost-btn flex items-center gap-1.5 !text-xs" onClick={() => tabId != null && void refresh(tabId)}>
                    <RefreshCw className="size-3.5" /> {t('media.refresh')}
                  </button>
                  <button
                    className="danger-btn flex items-center gap-1.5 !text-xs"
                    onClick={() => {
                      setAssets([]);
                      setSelectedId(null);
                      if (extensionMode && tabId != null) void chrome.runtime.sendMessage({ type: 'media:clear', tabId });
                    }}
                  >
                    <Trash2 className="size-3.5" /> {t('media.clear')}
                  </button>
                </div>
              </div>
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
                          onDownload={() => enqueueAsset(asset)}
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
        {selected && tab === 'capture' && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-line px-5 py-4">
            <AssetDetails asset={selected} downloads={downloads} onDownload={enqueueAsset} />
          </aside>
        )}
      </div>

      {/* ——— Downloads dock ——— */}
      {downloads.length > 0 && (
        <div className="shrink-0 border-t border-line bg-panel px-6 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Download className="size-3.5" />
              {t('media.dockTitle')}
              {activeDownloads.length > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{activeDownloads.length}</span>
              )}
            </span>
            {/* Where a batch writes. Without a folder every queued job would
                have to open its own save dialog, and a queued job cannot. */}
            <button
              className={`ghost-btn flex shrink-0 items-center gap-1 !px-2 !py-0.5 !text-[11px] ${
                folderName ? 'text-muted' : 'text-warning'
              }`}
              onClick={chooseFolder}
              title={t('media.folderHint')}
            >
              <FolderOpen className="size-3" />
              {folderName ? t('media.saveFolder', { name: folderName }) : t('media.pickFolder')}
            </button>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {activeDownloads.length > 0 && (
                <button className="ghost-btn flex items-center gap-1 !px-2 !py-0.5 !text-[11px]" onClick={toggleQueuePause}>
                  {queuePaused ? <Play className="size-3" /> : <Pause className="size-3" />}
                  {queuePaused ? t('media.resumeQueue') : t('media.pauseQueue')}
                </button>
              )}
              {failedCount > 0 && (
                <button
                  className="ghost-btn flex items-center gap-1 !px-2 !py-0.5 !text-[11px] text-primary"
                  onClick={() => queue.retryAll()}
                >
                  <RotateCcw className="size-3" /> {t('media.retryAll', { count: failedCount })}
                </button>
              )}
              {hasFinished && (
                <button
                  className="ghost-btn !px-2.5 !py-1 !text-[11px] text-muted"
                  onClick={() => {
                    queue.clearFinished();
                    // Rows are gone, so nothing will resume into the partials
                    // they were holding — release them now rather than keeping
                    // a stream (and its file lock) open for the session.
                    discardIdleResumes();
                  }}
                >
                  <Ban className="size-3" /> {t('media.clearFinished')}
                </button>
              )}
            </span>
          </div>
          {waitingCount > 0 && (
            <p className="mb-1.5 text-[11px] text-muted">
              {queuePaused ? t('media.queuePausedNote', { count: waitingCount }) : t('media.queueNote', { count: waitingCount })}
            </p>
          )}
          {folderName === null && waitingCount > 0 && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-warning">
              <FolderOpen className="size-3" /> {t('media.batchNeedsFolder')}
            </p>
          )}
          <div className="max-h-[168px] space-y-1.5 overflow-y-auto">
            {downloads.map((entry) => (
              <DownloadRow
                key={entry.id}
                entry={entry}
                now={now}
                onCancel={() => queue.cancel(entry.id)}
                onRetry={
                  entry.state === 'error' || entry.state === 'canceled' ? () => queue.retry(entry.id) : undefined
                }
                onMove={(delta) => queue.move(entry.id, delta)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ————————————————— Result: the resolved page as an asset shelf ————————— */

function ResultCard({
  resolved,
  onDownload,
  onDownloadParts,
  onOpenPart,
  onDownloadCover,
  onDismiss,
}: {
  resolved: ResolvedPageAsset;
  onDownload: (format: MediaFormatOption, page: ResolvedPageAsset) => void;
  onDownloadParts: (
    parts: VideoPart[],
    page: ResolvedPageAsset,
    prefer?: { quality?: string; container?: MediaFormatOption['container'] },
  ) => void;
  onOpenPart: (page: ResolvedPageAsset, part: VideoPart) => void;
  onDownloadCover: (page: ResolvedPageAsset) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [imgOk, setImgOk] = useState(true);
  // The artwork is one asset among several, not decoration — group every
  // downloadable thing the page offered into shelves, the way a downloader
  // presents results. "Complete" = carries its own sound (or is a stream).
  const video = resolved.formats.filter(
    (f) => f.container === 'mp4' || f.container === 'dash-mux' || f.container === 'hls' || f.container === 'dash-video',
  );
  const audio = resolved.formats.filter((f) => f.container === 'dash-audio');
  const recommended = video.find((f) => f.hasAudio && f.container !== 'dash-video') ?? video[0];
  const initials = resolved.title.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '▶';
  const best =
    recommended && recommended.size > 0
      ? `${recommended.quality} · ${formatBytes(recommended.size)}`
      : recommended?.quality;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      {/* Hero row: poster · title · primary action */}
      <div className="flex gap-5 p-5">
        {resolved.cover && imgOk ? (
          <img
            src={resolved.cover}
            alt=""
            referrerPolicy="no-referrer"
            className="h-28 w-48 shrink-0 rounded-xl object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="grid h-28 w-48 shrink-0 place-items-center rounded-xl bg-muted/10 text-2xl font-bold text-muted">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 text-[16px] font-semibold leading-snug text-ink">{resolved.title}</h3>
            <button className="ghost-btn shrink-0 !px-2.5 !py-1 !text-[11px] text-muted" onClick={onDismiss}>
              {t('media.dismiss')}
            </button>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted">{shortenUrl(resolved.pageUrl)}</p>
          {recommended && (
            <div className="mt-3 flex items-center gap-3">
              <button className="primary-btn flex items-center gap-2 !px-4 !py-2" onClick={() => onDownload(recommended, resolved)}>
                <Download className="size-4" />
                {t('media.downloadRecommended')}
                {best && <span className="text-[11px] font-normal opacity-80">{best}</span>}
              </button>
              <CopyButton value={recommended.url} label={t('media.copyLink')} />
            </div>
          )}
        </div>
      </div>

      {/* Multi-part videos come BEFORE the ladder: a user who only sees 720p
          and clicks it would otherwise download one twelfth of a box set. */}
      {resolved.parts && resolved.parts.length > 1 && (
        <PartsShelf
          parts={resolved.parts}
          labelKind={resolved.partsLabel ?? 'parts'}
          currentPart={resolved.partIndex ?? 1}
          onDownload={(parts) =>
            onDownloadParts(parts, resolved, { quality: recommended?.quality, container: recommended?.container })
          }
          onOpen={(part) => onOpenPart(resolved, part)}
        />
      )}

      {video.length > 0 && (
        <Shelf
          title={
            resolved.parts && resolved.parts.length > 1
              ? t(resolved.partsLabel === 'episodes' ? 'media.shelfVideoEpisode' : 'media.shelfVideoPart', {
                  part: resolved.partIndex ?? 1,
                })
              : t('media.shelfVideo')
          }
          icon={<Film className="size-3.5" />}
          count={video.length}
        >
          {video.map((format) => (
            <FormatRow
              key={format.key}
              format={format}
              recommended={format === recommended}
              onDownload={() => onDownload(format, resolved)}
            />
          ))}
        </Shelf>
      )}

      {audio.length > 0 && (
        <Shelf title={t('media.shelfAudio')} icon={<Music className="size-3.5" />} count={audio.length}>
          {audio.map((format) => (
            <FormatRow key={format.key} format={format} recommended={false} onDownload={() => onDownload(format, resolved)} />
          ))}
        </Shelf>
      )}

      {resolved.cover && imgOk && (
        <Shelf title={t('media.shelfImage')} icon={<ImageIcon className="size-3.5" />} count={1}>
          <CoverRow cover={resolved.cover} onDownload={() => onDownloadCover(resolved)} />
        </Shelf>
      )}

      {resolved.notice === 'dash-only' && (
        <p className="border-t border-line px-5 py-3 text-[11px] text-warning">{t('media.dashOnlyNote')}</p>
      )}
    </section>
  );
}

/** Parts of one video, each independently selectable.
 *
 * A part is not a quality variant — it is different CONTENT — so it gets a
 * list with checkboxes rather than another shelf of rows, and the batch
 * action lives here where the selection is. */
function PartsShelf({
  parts,
  labelKind,
  currentPart,
  onDownload,
  onOpen,
}: {
  parts: VideoPart[];
  /** 分P or episodes — same list, the site's own word for its parts. */
  labelKind: 'parts' | 'episodes';
  currentPart: number;
  onDownload: (parts: VideoPart[]) => void;
  onOpen: (part: VideoPart) => void;
}) {
  const { t } = useTranslation();
  const episodes = labelKind === 'episodes';
  const ordinal = (index: number) => `${episodes ? 'EP' : 'P'}${index}`;
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const allSelected = selected.size === parts.length;
  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="border-t border-line px-5 py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <ListVideo className="size-3.5" />
          {t(episodes ? 'media.episodesTitle' : 'media.partsTitle', { count: parts.length })}
        </h4>
        <button
          className="ghost-btn shrink-0 !px-2 !py-0.5 !text-[11px]"
          onClick={() => setSelected(allSelected ? new Set() : new Set(parts.map((part) => part.index)))}
        >
          {allSelected ? t('media.selectNone') : t('media.selectAll')}
        </button>
        <button
          className="primary-btn ml-auto flex shrink-0 items-center gap-1.5 !px-3 !py-1.5 !text-xs"
          disabled={selected.size === 0}
          onClick={() => onDownload(parts.filter((part) => selected.has(part.index)))}
        >
          <Download className="size-3.5" />
          {t('media.downloadParts', { count: selected.size })}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-muted">
        {t(episodes ? 'media.episodesHint' : 'media.partsHint', { part: currentPart })}
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {parts.map((part) => (
          <div
            key={part.cid}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-1.5 ${
              part.index === currentPart ? 'border-primary/40 bg-primary/5' : 'border-line hover:bg-hover'
            }`}
          >
            <input
              type="checkbox"
              className="size-3.5 shrink-0 cursor-pointer accent-primary"
              checked={selected.has(part.index)}
              onChange={() => toggle(part.index)}
              aria-label={ordinal(part.index)}
            />
            <span className="w-8 shrink-0 text-[11px] tabular-nums text-muted">{ordinal(part.index)}</span>
            <button
              className="min-w-0 flex-1 truncate text-left text-[12px] text-ink"
              title={part.title}
              onClick={() => toggle(part.index)}
            >
              {part.title}
            </button>
            {part.durationSeconds > 0 && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted">{formatDuration(part.durationSeconds)}</span>
            )}
            <button className="ghost-btn shrink-0 !px-2 !py-0.5 !text-[11px]" onClick={() => onOpen(part)}>
              {t('media.viewFormats')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One labelled group of downloads — the card's information architecture. */
function Shelf({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line px-5 py-3.5">
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
        <span className="text-[10px] font-normal">· {count}</span>
      </h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/** A download row: identity on the left, size + copy + download on the right. */
function FormatRow({
  format,
  recommended,
  onDownload,
}: {
  format: MediaFormatOption;
  recommended: boolean;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors ${
        recommended ? 'border-primary/50 bg-primary/5' : 'border-line hover:bg-hover'
      }`}
    >
      <span className="w-14 shrink-0 text-[13px] font-semibold text-ink">{format.quality || t('media.fileType')}</span>
      <span className="shrink-0 text-[11px] text-muted">{formatLabel(format, t)}</span>
      {/* An audio track needs no "has sound" badge — it IS the sound. */}
      {format.container === 'dash-audio' ? null : format.hasAudio ? (
        <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">{t('media.withAudio')}</span>
      ) : (
        <span className="shrink-0 rounded bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted">{t('media.noAudio')}</span>
      )}
      {recommended && (
        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t('media.recommended')}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {format.size > 0 && <span className="mr-1 text-[11px] tabular-nums text-muted">{formatBytes(format.size)}</span>}
        <CopyButton value={format.url} label={t('media.copyLink')} />
        <button className="ghost-btn flex shrink-0 items-center gap-1 !px-2.5 !py-1 !text-xs" onClick={onDownload}>
          <Download className="size-3.5" /> {t('media.download')}
        </button>
      </span>
    </div>
  );
}

function CoverRow({ cover, onDownload }: { cover: string; onDownload: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:bg-hover">
      <img src={cover} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-lg object-cover" />
      <span className="min-w-0 truncate text-[12px] text-ink">{t('media.coverOriginal')}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <a
          className="ghost-btn grid size-7 place-items-center !p-0"
          href={cover}
          target="_blank"
          rel="noreferrer"
          title={t('media.preview')}
          aria-label={t('media.preview')}
        >
          <ExternalLink className="size-3.5" />
        </a>
        <button className="ghost-btn flex shrink-0 items-center gap-1 !px-2.5 !py-1 !text-xs" onClick={onDownload}>
          <Download className="size-3.5" /> {t('media.download')}
        </button>
      </span>
    </div>
  );
}

/** Copy a format's direct CDN link — what a pro user pastes into their own
 *  downloader or player. Copies the raw URL, never a proxy wrapper. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost-btn grid size-7 place-items-center !p-0"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function formatLabel(format: MediaFormatOption, t: (key: string) => string): string {
  switch (format.container) {
    case 'mp4':
    case 'dash-mux': // merged on the fly — the result IS a complete MP4
      return t('media.fmtMp4');
    case 'hls':
      return t('media.fmtHls');
    case 'dash-video':
      return t('media.fmtDashVideo');
    case 'dash-audio':
      return t('media.fmtDashAudio');
    default:
      return '';
  }
}

/* ————————————————— Capture list ————————————————— */

function GroupIcon({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'audio') return <Music className={className} />;
  if (kind === 'stream') return <Radio className={className} />;
  return <Film className={className} />;
}

function AssetRow({ asset, selected, onSelect, onDownload }: { asset: MediaAsset; selected: boolean; onSelect: () => void; onDownload: () => void }) {
  const { t } = useTranslation();
  const collapsed = asset.container === 'dash' && asset.hits > 4;
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
          className="ghost-btn grid size-7 place-items-center !p-0 opacity-0 transition-opacity group-hover:opacity-100"
          title={collapsed ? t('media.collapsedHint') : t('media.download')}
          onClick={(e) => {
            e.stopPropagation();
            if (collapsed) {
              onSelect();
              return;
            }
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
  downloads,
  onDownload,
}: {
  asset: MediaAsset;
  downloads: QueueEntry<MediaJob>[];
  onDownload: (asset: MediaAsset, variantUrl?: string) => void;
}) {
  const { t } = useTranslation();
  const related = downloads.filter((entry) => entry.meta.kind === 'asset' && entry.meta.asset.id === asset.id);
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
        <button className="primary-btn flex w-full items-center justify-center gap-2" onClick={() => onDownload(asset)}>
          <Download className="size-4" /> {t('media.download')}
        </button>
      )}
      {!canStreamToDisk() && (
        <p className="text-[10px] text-muted">{t('media.memorySinkNote')}</p>
      )}
      {related.length > 0 && (
        <div className="space-y-1.5">
          {related.map((entry) => (
            <DownloadRow key={entry.id} entry={entry} now={Date.now()} compact onCancel={() => undefined} />
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

/* ————————————————— Downloads dock ————————————————— */

function DownloadRow({
  entry,
  now,
  onCancel,
  onRetry,
  onMove,
  compact = false,
}: {
  entry: QueueEntry<MediaJob>;
  /** Ticking clock (ms) — re-renders every second so speed/ETA stay live. */
  now: number;
  onCancel: () => void;
  onRetry?: () => void;
  /** Move a still-waiting row up/down the line. */
  onMove?: (delta: number) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const task = entry.task;
  const active = entry.state === 'queued' || entry.state === 'resolving' || entry.state === 'running';
  const speed = useSpeed(task, now);
  const eta =
    speed != null && task?.totalBytes != null && task.totalBytes > task.receivedBytes
      ? (task.totalBytes - task.receivedBytes) / speed
      : null;

  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'rounded-lg bg-surface px-3 py-2'}`}>
      {entry.state === 'done' ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" />
      ) : entry.state === 'error' ? (
        <XCircle className="size-4 shrink-0 text-danger" />
      ) : entry.state === 'canceled' ? (
        <Ban className="size-4 shrink-0 text-muted" />
      ) : entry.state === 'queued' ? (
        <Clock className="size-4 shrink-0 text-muted" />
      ) : (
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[12px] text-ink">{entry.title}</span>
            {/* A retry that picked up where the last attempt stopped says so —
                otherwise "it restarted and finished fast" is indistinguishable
                from "it resumed". */}
            {task?.resumedFromBytes != null && (
              <span
                className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary"
                title={t('media.resumedFrom', { size: formatBytes(task.resumedFromBytes) })}
              >
                {t('media.resumed')}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted">{statusText(entry, speed, eta, t)}</span>
        </div>
        {entry.state === 'running' && task && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/20">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, task.progress * 100)}%` }} />
          </div>
        )}
      </div>
      {!compact && entry.state === 'queued' && onMove && (
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            className="ghost-btn grid size-6 place-items-center !p-0"
            title={t('media.moveUp')}
            aria-label={t('media.moveUp')}
            disabled={entry.position <= 1}
            onClick={() => onMove(-1)}
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            className="ghost-btn grid size-6 place-items-center !p-0"
            title={t('media.moveDown')}
            aria-label={t('media.moveDown')}
            onClick={() => onMove(1)}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </span>
      )}
      {onRetry && (
        <button className="ghost-btn flex shrink-0 items-center gap-1 !px-2 !py-0.5 !text-[11px] text-primary" onClick={onRetry}>
          <RotateCcw className="size-3" /> {t('media.retry')}
        </button>
      )}
      {active && !compact && (
        <button className="ghost-btn shrink-0 !px-2.5 !py-1 !text-[11px] text-muted" onClick={onCancel}>
          {t('media.cancel')}
        </button>
      )}
    </div>
  );
}

/** The right-hand status line, one branch per queue state. Split out so the
 *  row body stays markup and the wording stays in i18n. */
function statusText(
  entry: QueueEntry<MediaJob>,
  speed: number | null,
  eta: number | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const task = entry.task;
  if (entry.state === 'queued') return t('media.queued', { position: entry.position });
  if (entry.state === 'resolving') return t('media.resolving');
  if (entry.state === 'done') return t('media.done');
  if (entry.state === 'error') return entry.error ?? task?.error ?? t('media.taskError');
  if (entry.state === 'canceled') return t('media.canceled');
  const progress = Math.round((task?.progress ?? 0) * 100);
  const segments = task && task.segmentsTotal > 0 ? ` · ${task.segmentsDone}/${task.segmentsTotal}` : '';
  const rate = speed != null ? ` · ${formatBytes(speed)}/s` : '';
  const remaining = eta != null && Number.isFinite(eta) ? ` · ${formatEta(eta)}` : '';
  return `${progress}%${segments}${rate}${remaining}`;
}

/** Rolling 3-sample download speed (bytes/s). Samples are kept per task id;
 *  the hook reads the shared ref — tasks are single-writer, so this stays
 *  consistent across the dock's re-renders. */
function useSpeed(task: MediaTask | null, now: number): number | null {
  const samplesRef = useRef<{ at: number; bytes: number }[]>([]);
  const samples = samplesRef.current;
  if (task) {
    const last = samples[samples.length - 1];
    if (!last || last.bytes !== task.receivedBytes || now - last.at > 1000) {
      samples.push({ at: now, bytes: task.receivedBytes });
      if (samples.length > 3) samples.shift();
    }
  }
  const first = samples[0];
  if (!task || !first || samples.length < 2) return null;
  const dt = (now - first.at) / 1000;
  const db = task.receivedBytes - first.bytes;
  if (dt <= 0 || db <= 0) return null;
  return db / dt;
}

/** `12:05` / `1:02:33` — content durations, not a countdown. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
  return `~${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

/* ————————————————— Empty states ————————————————— */

/**
 * The first screen a new user sees, so it has to do two jobs: teach the
 * two-step flow, and prove what the tool can actually open.
 *
 * The platform list is generated from the resolver's own adapter registry
 * rather than written out in copy. That is deliberate — hard-coded
 * "supports Bilibili and Douyin" text is how a product ends up advertising
 * three platforms while its registry holds five, and it is why adding an
 * adapter previously also meant remembering to edit the translations. Each
 * entry is a button that resolves its own example, so the list doubles as
 * the fastest way to try the feature.
 */
function ResolveEmptyState({ onTry }: { onTry: (url: string) => void }) {
  const { t } = useTranslation();
  return (
    // Full width on purpose. A narrower centred column here is what turns a
    // wide window into two margins of empty background and makes the tool
    // read as a form rather than a workbench.
    <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-ink">{t('media.resolveEmptyTitle')}</h3>
          <p className="text-[12px] text-muted">{t('media.resolveEmptyHint')}</p>
        </div>

        <div className="px-5 py-4">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('media.platformsTitle')}
          </p>
          {/* Fills the row instead of stacking into a single column: a
              platform is one short line, so a wide window should show more
              of them, not a taller list beside empty space. */}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {SUPPORTED_PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                onClick={() => onTry(platform.example)}
                title={platform.example}
                className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-left transition-colors duration-150 hover:border-primary/40 hover:bg-hover"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{platform.label}</span>
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {shortenUrl(platform.example)}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {t('media.tryExample')}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-1 border-t border-line pt-3">
            <p className="max-w-3xl text-[11.5px] leading-relaxed text-muted">{t('media.directHint')}</p>
            <p className="max-w-3xl text-[11.5px] leading-relaxed text-muted">{t('media.limitHint')}</p>
          </div>
        </div>
    </div>
  );
}

function CaptureEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="panel flex items-start gap-3 px-5 py-4">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted/10 text-muted">
        <Radio className="size-4" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <h3 className="text-[14px] font-semibold text-ink">{t('media.emptyTitle')}</h3>
        <p className="text-[12px] leading-relaxed text-muted">{t('media.emptyHint')}</p>
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
