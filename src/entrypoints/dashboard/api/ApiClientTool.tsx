/**
 * Requests module shell — the API client.
 *
 * Owns the workspace state (requests / collections / history / variables)
 * and orchestrates the panes: ApiSidebar (left), RequestEditor + ResponseView
 * (right). Persistence is the heart of the "no bookkeeping" philosophy:
 * every edit auto-saves to IndexedDB (debounced), so there is no Save
 * button — naming a draft is the only explicit act.
 *
 * Execution goes through requestRunner, which prefers the background
 * service worker (CORS-free in the extension) and falls back to in-page
 * fetch on the web build.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { storageGet, storageSet } from '../storage';
import type { ApiCollection, ApiHistoryEntry, ApiRequest, ApiResponse } from './apiTypes';
import { createApiRequest, requestDisplayTitle, uid } from './apiTypes';
import {
  addHistoryEntry,
  clearHistory,
  deleteCollection as deleteCollectionInStore,
  deleteRequest as deleteRequestInStore,
  loadWorkspace,
  saveCollection,
  saveRequest,
} from './apiStore';
import { exportPostmanCollection, parsePostmanCollection } from './postmanImport';
import { buildRawRequest, sendRequest, type SendHandle } from './requestRunner';
import { ApiSidebar } from './ApiSidebar';
import { RequestEditor } from './RequestEditor';
import { ResponseView } from './ResponseView';

const CURRENT_KEY = 'loadix-api:current';
const VARS_KEY = 'loadix-api:vars';
const SAVE_DEBOUNCE_MS = 600;

interface ApiClientToolProps {
  /** Kept for registry/ToolProps compatibility (the palette passes it). */
  initialPayload?: string;
  /** The load-test bridge: hand this request to the load-test view.
   *  Optional because the Ctrl+K palette mounts the tool without App-level
   *  wiring (the bridge is a no-op there). */
  onOpenInLoadTest?: (request: ApiRequest) => void;
}

export function ApiClientTool({ onOpenInLoadTest }: ApiClientToolProps) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [history, setHistory] = useState<ApiHistoryEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [vars, setVars] = useState<[string, string][]>([]);
  // The import hint is noise after the first successful import.
  const [importedOnce, setImportedOnce] = useState(() => localStorage.getItem('loadix-api:imported') === '1');
  const importedOnceRef = useRef(importedOnce);
  importedOnceRef.current = importedOnce;

  const current = requests.find((r) => r.id === currentId) ?? null;
  const varsRef = useRef(vars);
  varsRef.current = vars;

  /* ——— Boot: load the workspace, vars, and last-opened request ——— */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [workspace, savedVars, lastId] = await Promise.all([
        loadWorkspace(),
        storageGet<[string, string][]>(VARS_KEY),
        storageGet<string>(CURRENT_KEY),
      ]);
      if (cancelled) return;
      setCollections(workspace.collections);
      setHistory(workspace.history);
      if (savedVars) setVars(savedVars);

      let requestsList = workspace.requests;
      // Make sure there is always at least one working draft — the editor
      // surface must never greet the user with "create something first".
      if (requestsList.length === 0) {
        const draft = createApiRequest();
        await saveRequest(draft);
        requestsList = [draft];
      }
      setRequests(requestsList);

      const initial =
        lastId && requestsList.some((r) => r.id === lastId)
          ? lastId
          : (requestsList.find((r) => r.collectionId == null)?.id ?? requestsList[0]!.id);
      setCurrentId(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Remember the open request across reloads.
  useEffect(() => {
    if (currentId) void storageSet(CURRENT_KEY, currentId);
  }, [currentId]);

  /* ——— Auto-save: every edit persists (debounced) ——— */

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveRequest(current);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [current]);

  // Flush the outgoing request when switching away, so a quick switch never
  // loses the last keystrokes.
  const switchTo = useCallback(
    (id: string) => {
      if (id === currentId) return;
      if (current) void saveRequest({ ...current, updatedAt: Date.now() });
      setCurrentId(id);
    },
    [current, currentId],
  );

  /* ——— Editing ——— */

  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const patchCurrent = useCallback((patch: Partial<ApiRequest>) => {
    setRequests((prev) =>
      prev.map((r) => (r.id === currentIdRef.current ? { ...r, ...patch, updatedAt: Date.now() } : r)),
    );
  }, []);

  /* ——— Send / cancel ——— */

  const sendHandleRef = useRef<SendHandle | null>(null);
  const handleSend = useCallback(async () => {
    if (!current || sending) return;
    if (!current.url.trim()) return;
    setSending(true);
    const handle = sendRequest(buildRawRequest(current, Object.fromEntries(varsRef.current)));
    sendHandleRef.current = handle;
    try {
      const res = await handle.promise;
      setResponse(res);
      const entry: ApiHistoryEntry = {
        id: uid(),
        request: { ...current, updatedAt: Date.now() },
        sentAt: Date.now(),
        status: res.status,
        ms: res.ms,
        ok: res.ok,
        error: res.error,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 100));
      void addHistoryEntry(entry);
    } finally {
      setSending(false);
      sendHandleRef.current = null;
    }
  }, [current, sending]);

  const handleCancel = useCallback(() => {
    sendHandleRef.current?.abort();
  }, []);

  /* ——— Sidebar actions ——— */

  const handleNewRequest = useCallback(() => {
    const draft = createApiRequest();
    void saveRequest(draft);
    setRequests((prev) => [...prev, draft]);
    setCurrentId(draft.id);
    setResponse(null);
  }, []);

  const handleNewRequestIn = useCallback(
    (collectionId: string) => {
      const draft = createApiRequest();
      draft.collectionId = collectionId;
      void saveRequest(draft);
      setRequests((prev) => [...prev, draft]);
      setCurrentId(draft.id);
      setResponse(null);
    },
    [],
  );

  const handleNewCollection = useCallback((name: string) => {
    const collection: ApiCollection = { id: uid(), name, parentId: null, createdAt: Date.now() };
    void saveCollection(collection);
    setCollections((prev) => [...prev, collection]);
  }, []);

  const handleKeepRequest = useCallback((id: string, name: string, collectionId: string | null) => {
    const target = requests.find((r) => r.id === id);
    if (!target) return;
    const updated: ApiRequest = { ...target, name, collectionId, updatedAt: Date.now() };
    setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    void saveRequest(updated);
  }, [requests]);

  const handleRenameCollection = useCallback((id: string, name: string) => {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    const target = collections.find((c) => c.id === id);
    if (target) void saveCollection({ ...target, name });
  }, [collections]);

  const handleMoveRequest = useCallback((id: string, collectionId: string | null) => {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, collectionId, updatedAt: Date.now() } : r)),
    );
    const target = requests.find((r) => r.id === id);
    if (target) void saveRequest({ ...target, collectionId, updatedAt: Date.now() });
  }, [requests]);

  const handleDuplicateRequest = useCallback(
    (id: string) => {
      const target = requests.find((r) => r.id === id);
      if (!target) return;
      const copy: ApiRequest = {
        ...target,
        id: uid(),
        name: target.name ? `${target.name} (copy)` : '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      void saveRequest(copy);
      setRequests((prev) => [copy, ...prev]);
      setCurrentId(copy.id);
    },
    [requests],
  );

  const handleDeleteRequest = useCallback(
    (id: string) => {
      const target = requests.find((r) => r.id === id);
      if (!target) return;
      if (!window.confirm(t('api.confirmDeleteRequest', { name: requestDisplayTitle(target, t('api.untitled')) }))) return;
      setRequests((prev) => prev.filter((r) => r.id !== id));
      void deleteRequestInStore(id);
      if (currentId === id) setCurrentId(null);
    },
    [requests, currentId, t],
  );

  const handleDeleteCollection = useCallback(
    (id: string) => {
      const target = collections.find((c) => c.id === id);
      if (!target) return;
      if (!window.confirm(t('api.confirmDeleteCollection', { name: target.name }))) return;
      const doomed = new Set<string>();
      const walk = (cid: string) => {
        doomed.add(cid);
        for (const c of collections) if (c.parentId === cid) walk(c.id);
      };
      walk(id);
      setCollections((prev) => prev.filter((c) => !doomed.has(c.id)));
      setRequests((prev) => prev.map((r) => (r.collectionId && doomed.has(r.collectionId) ? { ...r, collectionId: null, updatedAt: Date.now() } : r)));
      void deleteCollectionInStore(id);
    },
    [collections, t],
  );

  const handleImportFile = useCallback((file: File) => {
    void file.text().then((text) => {
      try {
        const result = parsePostmanCollection(text);
        setCollections((prev) => [...prev, ...result.collections]);
        setRequests((prev) => [...prev, ...result.requests]);
        for (const c of result.collections) void saveCollection(c);
        for (const r of result.requests) void saveRequest(r);
        const first = result.requests[0];
        if (first) setCurrentId(first.id);
        if (!importedOnceRef.current) {
          importedOnceRef.current = true;
          localStorage.setItem('loadix-api:imported', '1');
          setImportedOnce(true);
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  }, []);

  const handleExport = useCallback(() => {
    const json = exportPostmanCollection(collections, requests, t('api.exportName'));
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loadix-requests.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [collections, requests, t]);

  const handleOpenHistory = useCallback(
    (entry: ApiHistoryEntry) => {
      // Reopening a sent request starts a fresh draft (same content, no
      // name) so editing it never mutates the snapshot in History.
      const draft: ApiRequest = { ...entry.request, id: uid(), name: '', collectionId: null, createdAt: Date.now(), updatedAt: Date.now() };
      void saveRequest(draft);
      setRequests((prev) => [draft, ...prev]);
      setCurrentId(draft.id);
    },
    [],
  );

  const handleClearHistory = useCallback(() => {
    if (!window.confirm(t('api.confirmClearHistory'))) return;
    setHistory([]);
    void clearHistory();
  }, [t]);

  const handleVarsChange = useCallback((next: [string, string][]) => {
    setVars(next);
    void storageSet(VARS_KEY, next);
  }, []);

  /* ——— Render ——— */

  const collectionName = current?.collectionId ? (collections.find((c) => c.id === current.collectionId)?.name ?? '') : '';

  return (
    <div className="flex h-full min-h-0 w-full">
      <ApiSidebar
        requests={requests}
        collections={collections}
        history={history}
        currentId={currentId}
        showImportHint={!importedOnce}
        onOpenRequest={switchTo}
        onNewRequest={handleNewRequest}
        onNewRequestIn={handleNewRequestIn}
        onNewCollection={handleNewCollection}
        onKeepRequest={handleKeepRequest}
        onRenameCollection={handleRenameCollection}
        onMoveRequest={handleMoveRequest}
        onDuplicateRequest={handleDuplicateRequest}
        onDeleteRequest={handleDeleteRequest}
        onDeleteCollection={handleDeleteCollection}
        onImportFile={handleImportFile}
        onExport={handleExport}
        onOpenHistory={handleOpenHistory}
        onClearHistory={handleClearHistory}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-panel">
        {current ? (
          <>
            <RequestEditor request={current} onChange={patchCurrent} onSend={handleSend} onCancel={handleCancel} sending={sending} collectionName={collectionName} vars={vars} onVarsChange={handleVarsChange} />
            <ResponseView response={response} sending={sending} request={current} vars={vars} onLoadTest={onOpenInLoadTest ?? (() => {})} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="text-[13px] text-muted">{t('api.emptyEditor')}</p>
            <button onClick={handleNewRequest} className="primary-btn">
              {t('api.newRequest')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}