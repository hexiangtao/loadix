/**
 * Traffic recorder panel — drives the recorder content script in the active
 * tab, lists what it captured, and converts the selection into workspace
 * requests + a replayable Journey (recorderImport.ts).
 *
 * Outside the extension (web build) the capture side does not exist, so the
 * panel degrades to a paste-JSON import surface — the same pipeline, fed by
 * traffic exported from anywhere (e.g. another machine's recorder session).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ClipboardPaste,
  Eraser,
  Pause,
  Play,
  Radio,
  Trash2,
  X,
} from 'lucide-react';
import type { ApiRequest } from './apiTypes';
import { METHOD_CHIP } from './apiTypes';
import type { Journey } from './journeyTypes';
import { importCaptures } from './recorderImport';
import type { RecorderCapture } from './recorderTypes';

const RECORDER_CONTENT_FILE = 'content-scripts/recorder.js';
const POLL_MS = 1500;

interface RecorderStateMessage {
  type: 'recorder:state';
  recording: boolean;
  count: number;
  captures?: RecorderCapture[];
}

function hasChromeApi(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function statusClass(status: number): string {
  if (status === 0) return 'bg-muted/12 text-muted';
  if (status < 300) return 'bg-success/12 text-success';
  if (status < 400) return 'bg-warning/12 text-warning';
  return 'bg-danger/12 text-danger';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function RecorderPanel(props: {
  onClose: () => void;
  onImport: (requests: ApiRequest[], journey: Journey | null) => void;
}) {
  const { onClose, onImport } = props;
  const { t } = useTranslation();
  const extMode = useMemo(hasChromeApi, []);

  const [recording, setRecording] = useState(false);
  const [captures, setCaptures] = useState<RecorderCapture[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const [tabHost, setTabHost] = useState('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showRedacted, setShowRedacted] = useState<Set<string>>(new Set());
  const connectAttempted = useRef(false);

  const toggle = (set: Set<string>, key: string, updater: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updater(next);
  };

  /* ——— Connect to the active tab (inject the recorder when needed) ——— */
  const connect = useCallback(async () => {
    if (!extMode) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error(t('api.recorderNoTab'));
      setTabId(tab.id);
      setTabHost(hostOf(tab.url ?? ''));
      let injected = false;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'recorder:ping' });
      } catch {
        // Content script not present yet (tab was open before install/update).
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [RECORDER_CONTENT_FILE] });
          injected = true;
        } catch {
          throw new Error(t('api.recorderNeedReload'));
        }
      }
      setConnected(true);
      setError('');
      if (injected) setFeedback(t('api.recorderInjected'));
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [extMode, t]);

  useEffect(() => {
    if (!extMode || connectAttempted.current) return;
    connectAttempted.current = true;
    void connect();
  }, [extMode, connect]);

  /* ——— Poll the tab for live captures ——— */
  useEffect(() => {
    if (!extMode || tabId == null) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = (await chrome.tabs.sendMessage(tabId, { type: 'recorder:get' })) as RecorderStateMessage;
        if (!alive || !res || res.type !== 'recorder:state') return;
        setRecording(Boolean(res.recording));
        const list = res.captures ?? [];
        setCaptures(list);
        if (!selectionSeeded && list.length > 0) {
          setSelected(new Set(list.map((c) => c.id)));
          setSelectionSeeded(true);
        }
      } catch {
        /* tab navigated or closed — next poll reconnects */
        setConnected(false);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [extMode, tabId, selectionSeeded]);

  /* ——— Controls ——— */
  const sendControl = useCallback(
    async (type: 'recorder:start' | 'recorder:stop' | 'recorder:clear') => {
      if (tabId == null) return;
      setBusy(true);
      try {
        const res = (await chrome.tabs.sendMessage(tabId, { type })) as RecorderStateMessage;
        if (res?.type === 'recorder:state') setRecording(Boolean(res.recording));
        if (type === 'recorder:clear') {
          setCaptures([]);
          setSelected(new Set());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [tabId],
  );

  const copyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(captures, null, 2));
      setFeedback(t('api.recorderCopied'));
    } catch {
      setError(t('api.recorderCopyFailed'));
    }
  }, [captures, t]);

  const runImport = useCallback(
    (list: RecorderCapture[], withJourney: boolean) => {
      const result = importCaptures(list, {
        withJourney,
        journeyName: t('api.recorderJourneyName', { host: tabHost || '…' }),
      });
      if (result.requests.length > 0) {
        onImport(result.requests, result.journey);
        setFeedback(t('api.recorderImported', { count: result.requests.length }));
        setSelected(new Set());
      }
      const messages = [...result.warnings];
      if (messages.length > 0) setError(messages.slice(0, 3).join(' · '));
    },
    [onImport, t, tabHost],
  );

  const importSelected = (withJourney: boolean) => {
    const chosen = captures.filter((c) => selected.has(c.id));
    if (chosen.length > 0) runImport(chosen, withJourney);
  };

  const importPaste = () => {
    try {
      const parsed: unknown = JSON.parse(pasteText);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      runImport(parsed as RecorderCapture[], true);
    } catch {
      setError(t('api.recorderParseError'));
    }
  };

  const selectedCount = captures.filter((c) => selected.has(c.id)).length;
  const redactedCount = captures.reduce((sum, c) => sum + c.redacted.headers.length + c.redacted.urlParams.length + c.redacted.bodyFields.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      {/* ——— Header ——— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onClose} title={t('api.journeyClose')} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink">
          <X size={15} />
        </button>
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary"><Radio size={15} /></div>
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-ink">{t('api.recorderTitle')}</h2>
          {tabHost && <p className="truncate text-[10px] text-muted">{t('api.recorderTabBadge', { host: tabHost })}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {extMode && (
            <>
              {recording ? (
                <button
                  onClick={() => void sendControl('recorder:stop')}
                  disabled={busy}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-40"
                >
                  <Pause size={11} className="fill-current" />
                  {t('api.recorderStop')}
                </button>
              ) : (
                <button
                  onClick={() => void sendControl('recorder:start')}
                  disabled={busy || !connected}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  <Play size={11} className="fill-current" />
                  {t('api.recorderStart')}
                </button>
              )}
              <button
                onClick={() => void sendControl('recorder:clear')}
                disabled={busy || captures.length === 0}
                title={t('api.recorderClear')}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <Eraser size={13} />
              </button>
            </>
          )}
          <button
            onClick={() => void copyJson()}
            disabled={captures.length === 0}
            title={t('api.recorderCopyJson')}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <Clipboard size={13} />
          </button>
          <button
            onClick={() => setShowPaste(!showPaste)}
            title={t('api.recorderPasteJson')}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors ${showPaste ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}
          >
            <ClipboardPaste size={13} />
          </button>
        </div>
      </div>

      {showPaste && (
        <div className="shrink-0 border-b border-line bg-surface/40 px-3 py-3">
          <p className="mb-2 text-[10px] text-muted">{t('api.recorderPasteHint')}</p>
          <div className="flex items-start gap-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={t('api.recorderPastePlaceholder')}
              spellCheck={false}
              className="field min-h-20 flex-1 resize-y font-mono !text-[10px]"
            />
            <button
              onClick={importPaste}
              disabled={!pasteText.trim()}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <ClipboardPaste size={11} />
              {t('api.recorderImportPaste')}
            </button>
          </div>
        </div>
      )}

      {/* ——— Status / errors ——— */}
      {(error || feedback) && (
        <div className="shrink-0 border-b border-line px-3 py-1.5">
          {error && (
            <p className="flex items-center gap-1.5 text-[10px] text-danger"><CircleAlert size={11} />{error}</p>
          )}
          {feedback && <p className="text-[10px] text-success">{feedback}</p>}
        </div>
      )}
      {!extMode && (
        <div className="shrink-0 border-b border-line bg-primary/5 px-3 py-2 text-[11px] text-muted">
          {t('api.recorderWebModeHint')}
        </div>
      )}

      {/* ——— List ——— */}
      <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-2.5">
          {captures.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/30 px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Radio size={20} /></div>
              <p className="text-sm font-semibold text-ink">{t('api.recorderEmptyTitle')}</p>
              <p className="max-w-sm text-xs text-muted">{t('api.recorderEmpty')}</p>
              {extMode && (
                <button
                  onClick={() => void sendControl('recorder:start')}
                  disabled={!connected}
                  className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  <Play size={12} className="fill-current" />
                  {t('api.recorderStart')}
                </button>
              )}
            </div>
          ) : (
            captures.map((c) => {
              const isExpanded = expanded.has(c.id);
              const isRedacted = c.redacted.headers.length + c.redacted.urlParams.length + c.redacted.bodyFields.length > 0;
              const redactedParts = [
                ...c.redacted.headers.map((n) => `header ${n}`),
                ...c.redacted.urlParams.map((n) => `?${n}`),
                ...c.redacted.bodyFields.map((n) => `body ${n}`),
              ];
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border bg-surface/60 transition-colors hover:bg-surface/80 ${isExpanded ? 'border-primary/30' : 'border-line'}`}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setSelected(next);
                      }}
                      className="size-3.5 shrink-0 cursor-pointer accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-12 shrink-0 rounded-md px-1 py-0.5 text-center font-mono text-[10px] font-bold ${METHOD_CHIP[c.method as keyof typeof METHOD_CHIP] ?? 'bg-muted/10 text-muted'}`}>
                          {c.method}
                        </span>
                        <p className="truncate font-mono text-[13px] leading-snug text-ink">{c.url}</p>
                      </div>
                      <p className="mt-1 truncate pl-14 text-[10px] text-muted">
                        {formatTime(c.ts)} · {c.source === 'xhr' ? 'XHR' : 'fetch'} · {c.pageTitle || hostOf(c.pageUrl)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {isRedacted && (
                        <span
                          onClick={() => toggle(showRedacted, c.id, setShowRedacted)}
                          title={redactedParts.join(' · ')}
                          className={`cursor-help rounded-full px-2 py-0.5 text-[10px] font-semibold ${showRedacted.has(c.id) ? 'bg-warning text-white' : 'bg-warning/12 text-warning'}`}
                        >
                          {t('api.recorderRedacted')} {c.redacted.headers.length + c.redacted.urlParams.length + c.redacted.bodyFields.length}
                        </span>
                      )}
                      <div className="min-w-16 text-right">
                        <span className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${statusClass(c.status)}`}>
                          {c.status || 'ERR'}
                        </span>
                        {c.status > 0 && (
                          <p className="mt-0.5 font-mono text-[10px] text-muted">{c.durationMs.toFixed(0)} ms</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggle(expanded, c.id, setExpanded)}
                        title={t('api.journeyDetail')}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="grid gap-4 border-t border-line px-4 py-4 xl:grid-cols-2">
                      <div className="min-w-0">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">{t('api.recorderRequest')}</p>
                        {c.headers.length > 0 && (
                          <pre className="app-scroller sb-hairline mb-2 max-h-32 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
                            {c.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}
                          </pre>
                        )}
                        {c.body ? (
                          <pre className="app-scroller sb-hairline max-h-44 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink">{c.body}</pre>
                        ) : (
                          <p className="text-[10px] text-muted">{t('api.recorderNoBody')}</p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                          {t('api.recorderResponse')} {c.status > 0 && <span className={`font-semibold ${c.status < 300 ? 'text-success' : c.status < 400 ? 'text-warning' : 'text-danger'}`}>{c.status} {c.statusText}</span>}
                          {c.responseTruncated && <span className="font-normal text-muted"> · {t('api.recorderBodyTruncated')}</span>}
                        </p>
                        {c.responseHeaders.length > 0 && (
                          <pre className="app-scroller sb-hairline mb-2 max-h-32 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
                            {c.responseHeaders.map(([k, v]) => `${k}: ${v}`).join('\n')}
                          </pre>
                        )}
                        {c.responseBody ? (
                          <pre className="app-scroller sb-hairline max-h-60 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink">{c.responseBody}</pre>
                        ) : (
                          <p className="text-[10px] text-muted">{t('api.recorderNoResponse')}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ——— Import bar ——— */}
      {captures.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <span className="text-[11px] text-muted">
            {t('api.recorderCount', { count: captures.length })} · {t('api.recorderSelected', { count: selectedCount })}
            {redactedCount > 0 && ` · ${t('api.recorderRedactedTotal', { count: redactedCount })}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => importSelected(false)}
              disabled={selectedCount === 0}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              <Check size={11} />
              {t('api.recorderImportRequests')}
            </button>
            <button
              onClick={() => importSelected(true)}
              disabled={selectedCount === 0}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Radio size={11} />
              {t('api.recorderImportJourney')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}