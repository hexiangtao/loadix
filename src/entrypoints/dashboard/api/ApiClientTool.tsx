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
import { evaluateAssertions } from '@/engine/core';
import type { ApiCollection, ApiHistoryEntry, ApiRequest, ApiResponse } from './apiTypes';
import { createApiRequest, requestDisplayTitle, requestFingerprint, snapshotResponse, uid } from './apiTypes';
import {
  addHistoryEntry,
  clearHistory,
  deleteCollection as deleteCollectionInStore,
  deleteEnvironment as deleteEnvironmentInStore,
  deleteRequest as deleteRequestInStore,
  loadWorkspace,
  saveCollection,
  saveCollections,
  saveEnvironment,
  saveRequest,
  saveRequests,
} from './apiStore';
import { exportPostmanCollection, parsePostmanCollection } from './postmanImport';
import { exportOpenApiSpec } from './openapiExport';
import { parseOpenApiSpec } from './openapiImport';
import { byOrderCreated, byOrderRecency, planReorder } from '../ordering';
import { buildRawRequest, sendRequest, type SendHandle } from './requestRunner';
import { applyExtractRules, createEnvironment, mergedVars, type ApiEnvironment } from './variables';
import type { Assertion } from '@/shared/types';
import { ApiSidebar } from './ApiSidebar';
import { RequestEditor } from './RequestEditor';
import { ResponseView } from './ResponseView';
import { RealtimePanel, type RealtimeMode } from './RealtimePanel';
import { ApiDirectoryPanel } from './ApiDirectoryPanel';
import type { DirectoryApi } from './apiDirectory';
import { SplitDivider } from './SplitDivider';
import { ConfirmDialog } from '../components/ConfirmDialog';

const CURRENT_KEY = 'loadix-api:current';
const VARS_KEY = 'loadix-api:vars'; // global-scope variables (pre-environment legacy key)
const ACTIVE_ENV_KEY = 'loadix-api:active-env';
const EXTRACTED_KEY = 'loadix-api:extracted';
const DIR_FAVORITES_KEY = 'loadix-api:dir-favorites';
const EDITOR_HEIGHT_KEY = 'loadix-api:editor-height';
const SAVE_DEBOUNCE_MS = 600;

interface ApiClientToolProps {
  /** Kept for registry/ToolProps compatibility (the palette passes it). */
  initialPayload?: string;
  /** The load-test bridge: hand this request to the load-test view.
   *  Optional because the Ctrl+K palette mounts the tool without App-level
   *  wiring (the bridge is a no-op there). */
  onOpenInLoadTest?: (request: ApiRequest) => void;
  /** Open the current request/response as a new Markdown document. */
  onOpenInMarkdown?: (markdown: string) => void;
}

export function ApiClientTool({ onOpenInLoadTest, onOpenInMarkdown }: ApiClientToolProps) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [history, setHistory] = useState<ApiHistoryEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [previousResponse, setPreviousResponse] = useState<ApiResponse | null>(null);
  const [responseRequest, setResponseRequest] = useState<ApiRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [globalVars, setGlobalVars] = useState<[string, string][]>([]);
  const [environments, setEnvironments] = useState<ApiEnvironment[]>([]);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<[string, string][]>([]);
  const [assertionResults, setAssertionResults] = useState<{ assertion: Assertion; pass: boolean }[] | null>(null);
  const [mode, setMode] = useState<RealtimeMode | 'http'>('http');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(DIR_FAVORITES_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  // Split-divider preference: null = editor at natural height, otherwise px.
  const [editorHeight, setEditorHeight] = useState<number | null>(() => {
    const raw = localStorage.getItem(EDITOR_HEIGHT_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  // The import hint is noise after the first successful import.
  const [importedOnce, setImportedOnce] = useState(() => localStorage.getItem('loadix-api:imported') === '1');
  const importedOnceRef = useRef(importedOnce);
  importedOnceRef.current = importedOnce;
  // Destructive actions confirm through the shared styled dialog, not
  // window.confirm (unstyled, clipped, and off-brand).
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  const current = requests.find((r) => r.id === currentId) ?? null;
  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
  // Resolved variables for the active scope (extracted > env > global).
  const varsRef = useRef<Record<string, string>>({});
  varsRef.current = mergedVars({ env: activeEnv?.vars ?? [], global: globalVars, extracted });

  /* ——— Boot: load the workspace, vars, and last-opened request ——— */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [workspace, savedVars, activeEnv, savedExtracted, lastId] = await Promise.all([
        loadWorkspace(),
        storageGet<[string, string][]>(VARS_KEY),
        storageGet<string>(ACTIVE_ENV_KEY),
        storageGet<[string, string][]>(EXTRACTED_KEY),
        storageGet<string>(CURRENT_KEY),
      ]);
      if (cancelled) return;
      setCollections(workspace.collections);
      setHistory(workspace.history);
      setEnvironments(workspace.environments);
      if (savedVars) setGlobalVars(savedVars);
      if (savedExtracted) setExtracted(savedExtracted);
      if (activeEnv && workspace.environments.some((e) => e.id === activeEnv)) setActiveEnvId(activeEnv);

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
      const initialRequest = requestsList.find((r) => r.id === initial);
      const initialFingerprint = initialRequest ? requestFingerprint(initialRequest) : '';
      const runs = [...workspace.history]
        .filter((entry) => entry.response && requestFingerprint(entry.request) === initialFingerprint)
        .sort((a, b) => b.sentAt - a.sentAt);
      if (runs[0]?.response) {
        setResponse(runs[0].response);
        setResponseRequest(runs[0].request);
        setPreviousResponse(runs[1]?.response ?? null);
      }
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
      setResponse(null);
      setPreviousResponse(null);
      setResponseRequest(null);
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
  const runRequest = useCallback(
    async (request: ApiRequest) => {
      if (sending || !request.url.trim()) return;
      const fingerprint = requestFingerprint(request);
      const baseline = [...history]
        .filter((entry) => entry.response && requestFingerprint(entry.request) === fingerprint)
        .sort((a, b) => b.sentAt - a.sentAt)[0]?.response ?? null;
      setPreviousResponse(baseline);
      setResponse(null);
      setAssertionResults(null);
      setResponseRequest(request);
      setSending(true);
      const handle = sendRequest(buildRawRequest(request, varsRef.current));
      sendHandleRef.current = handle;
      try {
        const res = await handle.promise;
        setResponse(res);
        // Request-level assertions: evaluated right after each send so the
        // response view can show pass/fail per rule.
        if (request.assertions.length > 0) {
          const failures = evaluateAssertions(
            {
              status: res.status,
              ms: res.ms,
              body: res.body,
              ok: res.ok,
              error: res.error,
              responseHeaders: Object.fromEntries(res.headers),
            },
            request.assertions,
          );
          setAssertionResults(request.assertions.map((a) => ({ assertion: a, pass: !failures.includes(a) })));
        }
        // Response → variable extraction: writes into the extracted scope,
        // which then feeds interpolation for the next request in the chain.
        const extractedNew = applyExtractRules(res, request.extract);
        if (extractedNew.length > 0) {
          setExtracted((prev) => {
            const map = new Map(prev);
            for (const [k, v] of extractedNew) map.set(k, v);
            const next = Array.from(map.entries());
            void storageSet(EXTRACTED_KEY, next);
            return next;
          });
        }
        const entry: ApiHistoryEntry = {
          id: uid(),
          request: { ...request, updatedAt: Date.now() },
          response: snapshotResponse(res),
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
    },
    [history, sending],
  );

  const handleSend = useCallback(() => {
    if (current) void runRequest(current);
  }, [current, runRequest]);

  const handleLaunch = useCallback(
    (patch: Partial<ApiRequest>, shouldSend: boolean) => {
      if (!current) return;
      const updated = { ...current, ...patch, updatedAt: Date.now() };
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setResponse(null);
      setPreviousResponse(null);
      setResponseRequest(null);
      if (shouldSend) void runRequest(updated);
    },
    [current, runRequest],
  );

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
    setPreviousResponse(null);
    setResponseRequest(null);
  }, []);

  const handleNewRequestIn = useCallback(
    (collectionId: string) => {
      const draft = createApiRequest();
      draft.collectionId = collectionId;
      void saveRequest(draft);
      setRequests((prev) => [...prev, draft]);
      setCurrentId(draft.id);
      setResponse(null);
      setPreviousResponse(null);
      setResponseRequest(null);
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

  /** Move + reorder a request: parent change (optional) plus position in the
      target group. Uses the sidebar's visible sort — orders first, then
      recency — so the drag result matches what the user saw while dropping. */
  const handleReorderRequest = useCallback(
    (id: string, collectionId: string | null, anchorId: string | null, zone: 'before' | 'after') => {
      const moved = requests.find((r) => r.id === id);
      if (!moved) return;
      const group = requests
        .filter((r) => (r.collectionId ?? null) === collectionId && r.id !== id)
        .sort(byOrderRecency);
      const movedInTarget = { ...moved, collectionId, updatedAt: Date.now() };
      const plan = planReorder(group, id, anchorId, zone, movedInTarget);
      if (!plan) return;
      setRequests((prev) => prev.map((r) => plan.ordered.find((x) => x.id === r.id) ?? r));
      void saveRequests(plan.changed);
    },
    [requests],
  );

  /** Same for collections: reparent (nesting) plus position among siblings. */
  const handleReorderCollection = useCallback(
    (id: string, parentId: string | null, anchorId: string | null, zone: 'before' | 'after') => {
      const moved = collections.find((c) => c.id === id);
      if (!moved) return;
      const group = collections
        .filter((c) => (c.parentId ?? null) === parentId && c.id !== id)
        .sort(byOrderCreated);
      const movedInTarget = { ...moved, parentId };
      const plan = planReorder(group, id, anchorId, zone, movedInTarget);
      if (!plan) return;
      setCollections((prev) => prev.map((c) => plan.ordered.find((x) => x.id === c.id) ?? c));
      void saveCollections(plan.changed);
    },
    [collections],
  );

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
      setResponse(null);
      setPreviousResponse(null);
    },
    [requests],
  );

  const handleDeleteRequest = useCallback(
    (id: string) => {
      const target = requests.find((r) => r.id === id);
      if (!target) return;
      setConfirm({
        message: t('api.confirmDeleteRequest', { name: requestDisplayTitle(target, t('api.untitled')) }),
        confirmLabel: t('api.deleteRequest'),
        onConfirm: () => {
          setRequests((prev) => prev.filter((r) => r.id !== id));
          void deleteRequestInStore(id);
          if (currentId === id) setCurrentId(null);
        },
      });
    },
    [requests, currentId, t],
  );

  const handleDeleteCollection = useCallback(
    (id: string) => {
      const target = collections.find((c) => c.id === id);
      if (!target) return;
      setConfirm({
        message: t('api.confirmDeleteCollection', { name: target.name }),
        confirmLabel: t('api.deleteCollection'),
        onConfirm: () => {
          const doomed = new Set<string>();
          const walk = (cid: string) => {
            doomed.add(cid);
            for (const c of collections) if (c.parentId === cid) walk(c.id);
          };
          walk(id);
          // Deletion is total: the collections AND the requests they held
          // all go away together (the store mirrors this in one transaction).
          setCollections((prev) => prev.filter((c) => !doomed.has(c.id)));
          setRequests((prev) => {
            const removed = prev.filter((r) => r.collectionId != null && doomed.has(r.collectionId));
            for (const r of removed) void deleteRequestInStore(r.id);
            return prev.filter((r) => !(r.collectionId != null && doomed.has(r.collectionId)));
          });
          void deleteCollectionInStore(id);
        },
      });
    },
    [collections, t],
  );

  const handleImportFile = useCallback((file: File) => {
    void file.text().then((text) => {
      try {
        // Postman v2.1 first, then OpenAPI 3.0 — both land in the same
        // workspace model (collections + requests).
        let result: ReturnType<typeof parsePostmanCollection> | ReturnType<typeof parseOpenApiSpec>;
        try {
          result = parsePostmanCollection(text);
        } catch {
          result = parseOpenApiSpec(text);
        }
        setCollections((prev) => [...prev, ...result.collections]);
        setRequests((prev) => [...prev, ...result.requests]);
        for (const c of result.collections) void saveCollection(c);
        for (const r of result.requests) void saveRequest(r);
        // OpenAPI servers → global variables (baseUrl, server1, …).
        if ('globalVars' in result && result.globalVars.length > 0) {
          setGlobalVars((prev) => {
            const map = new Map(prev);
            for (const [k, v] of result.globalVars) if (!map.has(k)) map.set(k, v);
            const next = Array.from(map.entries());
            void storageSet(VARS_KEY, next);
            return next;
          });
        }
        const first = result.requests[0];
        if (first) {
          setCurrentId(first.id);
          setResponse(null);
          setPreviousResponse(null);
          setResponseRequest(null);
        }
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

  const handleExportOpenApi = useCallback(() => {
    const spec = exportOpenApiSpec(collections, requests, t('api.exportName'));
    const blob = new Blob([spec], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loadix-openapi.json';
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
      setResponse(null);
      setPreviousResponse(null);
      setResponseRequest(null);
    },
    [],
  );

  const handleClearHistory = useCallback(() => {
    setConfirm({
      message: t('api.confirmClearHistory'),
      confirmLabel: t('api.clearHistory'),
      onConfirm: () => {
        setHistory([]);
        void clearHistory();
      },
    });
  }, [t]);

  /* ——— Variables: global scope + environments + extracted ——— */

  const handleGlobalVarsChange = useCallback((next: [string, string][]) => {
    setGlobalVars(next);
    void storageSet(VARS_KEY, next);
  }, []);

  const handleSelectEnv = useCallback((id: string | null) => {
    setActiveEnvId(id);
    if (id === null) void storageSet(ACTIVE_ENV_KEY, '');
    else void storageSet(ACTIVE_ENV_KEY, id);
  }, []);

  const handleCreateEnv = useCallback((name: string) => {
    const env = createEnvironment(name.trim() || 'New environment');
    setEnvironments((prev) => [...prev, env]);
    void saveEnvironment(env);
    setActiveEnvId(env.id);
    void storageSet(ACTIVE_ENV_KEY, env.id);
  }, []);

  const handleRenameEnv = useCallback((id: string, name: string) => {
    setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, name } : e)));
    const target = environments.find((e) => e.id === id);
    if (target) void saveEnvironment({ ...target, name });
  }, [environments]);

  const handleDeleteEnv = useCallback((id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    void deleteEnvironmentInStore(id);
    if (activeEnvId === id) {
      setActiveEnvId(null);
      void storageSet(ACTIVE_ENV_KEY, '');
    }
  }, [activeEnvId]);

  const handleEnvVarsChange = useCallback((id: string, vars: [string, string][]) => {
    setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, vars } : e)));
    const target = environments.find((e) => e.id === id);
    if (target) void saveEnvironment({ ...target, vars });
  }, [environments]);

  const handleClearExtracted = useCallback(() => {
    setExtracted([]);
    void storageSet(EXTRACTED_KEY, []);
  }, []);

  /* ——— Protocol mode ——— */

  const handleModeChange = useCallback(
    (m: RealtimeMode | 'http') => {
      if (current) void saveRequest({ ...current, updatedAt: Date.now() });
      setDirectoryOpen(false);
      setMode(m);
    },
    [current],
  );

  /* ——— API directory ——— */

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(DIR_FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleTryApi = useCallback((api: DirectoryApi) => {
    const draft = createApiRequest();
    draft.name = api.name;
    draft.method = api.example.method;
    draft.url = api.example.url;
    draft.headers = api.example.headers ? api.example.headers.map(([k, v]) => [k, v] as [string, string]) : draft.headers;
    if (api.example.body) draft.body = { ...api.example.body, form: [...(api.example.body.form ?? [])] };
    void saveRequest(draft);
    setRequests((prev) => [draft, ...prev]);
    setCurrentId(draft.id);
    setDirectoryOpen(false);
    setResponse(null);
    setPreviousResponse(null);
    setResponseRequest(null);
  }, []);

  const handleOpenDirectory = useCallback(() => {
    if (current) void saveRequest({ ...current, updatedAt: Date.now() });
    setMode('http');
    setDirectoryOpen(true);
  }, [current]);

  /* ——— Split divider ——— */

  const handleResizeEditor = useCallback((px: number) => {
    setEditorHeight(px);
    localStorage.setItem(EDITOR_HEIGHT_KEY, String(px));
  }, []);

  const handleResetEditor = useCallback(() => {
    setEditorHeight(null);
    localStorage.removeItem(EDITOR_HEIGHT_KEY);
  }, []);

  /* ——— Render ——— */

  const collectionName = current?.collectionId ? (collections.find((c) => c.id === current.collectionId)?.name ?? '') : '';
  const varContext = {
    environments,
    activeEnvId,
    globalVars,
    extracted,
    onSelectEnv: handleSelectEnv,
    onCreateEnv: handleCreateEnv,
    onRenameEnv: handleRenameEnv,
    onDeleteEnv: handleDeleteEnv,
    onEnvVarsChange: handleEnvVarsChange,
    onGlobalVarsChange: handleGlobalVarsChange,
    onClearExtracted: handleClearExtracted,
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* ——— Protocol switcher: HTTP client / WebSocket / SSE ——— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
          {([['http', t('api.protoHttp')], ['websocket', t('api.protoWebsocket')], ['sse', t('api.protoSse')]] as [RealtimeMode | 'http', string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => handleModeChange(id)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
                mode === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {directoryOpen ? (
        <ApiDirectoryPanel
          favorites={favorites}
          onToggleFavorite={handleToggleFavorite}
          onTryApi={handleTryApi}
          onClose={() => setDirectoryOpen(false)}
        />
      ) : mode !== 'http' ? (
        <RealtimePanel mode={mode} />
      ) : (
        <div className="flex min-h-0 w-full flex-1">
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
            onReorderRequest={handleReorderRequest}
            onReorderCollection={handleReorderCollection}
            onDuplicateRequest={handleDuplicateRequest}
            onDeleteRequest={handleDeleteRequest}
            onDeleteCollection={handleDeleteCollection}
            onImportFile={handleImportFile}
            onExportPostman={handleExport}
            onExportOpenApi={handleExportOpenApi}
            onOpenHistory={handleOpenHistory}
            onOpenDirectory={handleOpenDirectory}
            onClearHistory={handleClearHistory}
          />
          <div className="flex min-w-0 flex-1 flex-col bg-panel">
            {current ? (
              <>
                <RequestEditor
                  request={current}
                  onChange={patchCurrent}
                  onSend={handleSend}
                  onCancel={handleCancel}
                  sending={sending}
                  collectionName={collectionName}
                  varContext={varContext}
                  editorHeight={editorHeight}
                />
                <SplitDivider onResize={handleResizeEditor} onReset={handleResetEditor} />
                <ResponseView
                  response={response}
                  previousResponse={previousResponse}
                  sending={sending}
                  request={responseRequest ?? current}
                  resolvedVars={varsRef.current}
                  assertionResults={assertionResults}
                  extracted={extracted}
                  onLoadTest={onOpenInLoadTest ?? (() => {})}
                  onOpenInMarkdown={onOpenInMarkdown ?? (() => {})}
                  onLaunch={handleLaunch}
                />
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
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.confirmLabel}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={t('api.cancel')}
          onConfirm={() => {
            const action = confirm.onConfirm;
            setConfirm(null);
            action();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}