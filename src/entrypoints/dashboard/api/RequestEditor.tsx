/**
 * Request editor — the center pane of the Requests module.
 *
 * The hero row (method · URL · Send) is the omnibox of the module: type a
 * URL, hit Send / Ctrl+Enter, done. Below it a slim tab strip holds the
 * request parts — Params, Headers, Body, Auth — plus the variables
 * popover. Auth is a smart quick-fill that *derives* headers at send time
 * instead of making the user type them.
 *
 * Two-way URL ↔ Params sync: editing the URL re-parses the query into the
 * Params table, editing the table rewrites the URL's query. Both effects
 * compare against the other side's current serialization, so only the
 * dirty side wins and there is no edit loop.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Folder, Play, Square, Terminal, X } from 'lucide-react';
import type { ApiAuthType, ApiBodyType, ApiMethod, ApiRequest } from './apiTypes';
import { METHOD_TEXT, requestDisplayTitle } from './apiTypes';
import { Popover } from '../components/Popover';
import { buildQueryString, currentQuery, parseQueryParams, replaceQuery } from './urlUtil';
import { requestPatchFromCurl } from './requestImport';

interface RequestEditorProps {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  /** Cancels the in-flight request (the Send button becomes Stop). */
  onCancel: () => void;
  sending: boolean;
  /** The collection this request belongs to ('' for a draft). */
  collectionName?: string;
  vars: [string, string][];
  onVarsChange: (vars: [string, string][]) => void;
  /** Fixed editor height from the split divider (null = natural size). */
  editorHeight?: number | null;
}

const METHODS: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

type Tab = 'params' | 'headers' | 'body' | 'auth';

export function RequestEditor({ request, onChange, onSend, onCancel, sending, collectionName, vars, onVarsChange, editorHeight }: RequestEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('params');
  const [varsOpen, setVarsOpen] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [curlError, setCurlError] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);
  const curlBtnRef = useRef<HTMLButtonElement>(null);
  const varsBtnRef = useRef<HTMLButtonElement>(null);

  // Ctrl/Cmd+L focuses the URL bar (Ctrl+K is taken by the tool palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        urlRef.current?.focus();
        urlRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // URL typed by the user → re-parse the query into the Params table
  // (only when the query actually differs from what the table would produce).
  useEffect(() => {
    if (buildQueryString(request.params) !== currentQuery(request.url)) {
      onChange({ params: parseQueryParams(request.url) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.url]);

  // Params edited → rewrite the URL's query (only when it differs).
  useEffect(() => {
    if (currentQuery(request.url) !== buildQueryString(request.params)) {
      onChange({ url: replaceQuery(request.url, request.params) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.params]);

  const send = () => {
    if (!request.url.trim()) {
      urlRef.current?.focus();
      return;
    }
    onSend();
  };

  const applyCurl = () => {
    try {
      onChange(requestPatchFromCurl(curlInput));
      setCurlOpen(false);
      setCurlInput('');
      setCurlError('');
    } catch (e) {
      setCurlError(e instanceof Error ? e.message : String(e));
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'params', label: t('api.tabParams') },
    { id: 'headers', label: t('api.tabHeaders') },
    { id: 'body', label: t('api.tabBody') },
    { id: 'auth', label: t('api.tabAuth') },
  ];

  const locked = editorHeight != null;

  return (
    <div style={{ height: locked ? editorHeight : undefined }} className="flex min-h-0 flex-col">
      {/* ——— Request identity: inline-rename the name, see where it lives ——— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 pb-1.5 pt-2">
        <span className={`shrink-0 text-[10px] font-bold ${METHOD_TEXT[request.method]}`}>{request.method}</span>
        <input
          value={request.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={requestDisplayTitle(request, t('api.untitled'))}
          title={t('api.requestNamePlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted/60"
        />
        {collectionName ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <Folder size={11} className="text-primary/70" />
            <span className="max-w-32 truncate">{collectionName}</span>
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[10px] font-semibold text-muted">
            {t('api.drafts')}
          </span>
        )}
      </div>

      {/* ——— Hero command bar — one quiet island that wakes on focus ——— */}
      <div className="px-3 pb-1 pt-2">
        <div className="command-bar flex items-center gap-1 p-1 pl-1.5">
          <select
            value={request.method}
            onChange={(e) => onChange({ method: e.target.value as ApiMethod })}
            title={t('api.method')}
            className={`h-7 shrink-0 cursor-pointer appearance-none rounded-lg bg-hover px-2 text-[12px] font-bold outline-none transition-colors duration-150 hover:bg-hover/70 ${METHOD_TEXT[request.method]}`}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <input
            ref={urlRef}
            value={request.url}
            onChange={(e) => onChange({ url: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
            }}
            placeholder={t('api.urlPlaceholder')}
            spellCheck={false}
            className="min-h-7 min-w-0 flex-1 bg-transparent px-1 font-mono text-[12.5px] text-ink outline-none placeholder:text-muted/60"
          />

          <button
            ref={curlBtnRef}
            onClick={() => setCurlOpen((v) => !v)}
            title={t('api.pasteCurl')}
            className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 hover:bg-hover hover:text-primary ${
              curlOpen ? 'bg-hover text-primary' : 'text-muted'
            }`}
          >
            <Terminal size={14} />
          </button>

          <button
            onClick={sending ? onCancel : send}
            className={`flex shrink-0 items-center gap-1.5 !rounded-lg !px-3.5 ${
              sending ? 'danger-btn !bg-danger !text-white stop-pulse' : 'primary-btn send-glow'
            }`}
          >
            {sending ? <Square size={12} className="fill-current" /> : <Play size={13} className="fill-current" />}
            {sending ? t('api.stop') : t('api.send')}
          </button>
        </div>
      </div>

      {/* Paste-cURL popover — floating so the editor height never jumps */}
      {curlOpen && (
        <Popover anchor={curlBtnRef.current} onClose={() => setCurlOpen(false)} width="w-80">
          <div className="px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{t('api.pasteCurl')}</span>
              <button onClick={() => setCurlOpen(false)} className="cursor-pointer rounded p-0.5 text-muted hover:bg-hover hover:text-ink">
                <X size={13} />
              </button>
            </div>
            <textarea
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={t('api.pasteCurlPlaceholder')}
              spellCheck={false}
              className="field h-20 w-full resize-none font-mono text-[12px] leading-relaxed"
            />
            {curlError && <p className="mt-1 text-[11px] text-danger">{curlError}</p>}
            <div className="mt-2 flex justify-end gap-1.5">
              <button onClick={() => setCurlOpen(false)} className="ghost-btn !px-2.5 !py-1 !text-xs">
                {t('api.pasteCurlCancel')}
              </button>
              <button onClick={applyCurl} className="primary-btn !px-3 !py-1 !text-xs">
                {t('api.pasteCurlApply')}
              </button>
            </div>
          </div>
        </Popover>
      )}

      {/* ——— Tab strip ——— */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
                tab === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          ref={varsBtnRef}
          onClick={() => setVarsOpen((v) => !v)}
          title={t('api.varsTitle')}
          className={`relative flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150 hover:bg-hover ${
            varsOpen ? 'font-semibold text-primary' : 'text-muted hover:text-ink'
          }`}
        >
          <Braces size={12} />
          {t('api.tabVars')}
          {vars.filter(([k]) => k.trim()).length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
              {vars.filter(([k]) => k.trim()).length}
            </span>
          )}
        </button>
      </div>

      {/* ——— Tab body ———
          Natural mode: capped at 176px so the editor never outgrows the
          window. Locked mode (drag splitter): flex-1 fills the assigned
          editor height and scrolls instead of pushing the response away. */}
      <div key={tab} className={`anim-fade min-h-0 border-t border-line bg-surface/40 px-3 py-2 ${locked ? 'flex-1 overflow-y-auto' : 'max-h-44 overflow-y-auto'}`}>
        {tab === 'params' && (
          <KvRows rows={request.params} onChange={(params) => onChange({ params })} addLabel={t('api.addRow')} placeholderKey={t('api.paramKey')} placeholderValue={t('api.paramValue')} />
        )}
        {tab === 'headers' && (
          <>
            <KvRows rows={request.headers} onChange={(headers) => onChange({ headers })} addLabel={t('api.addHeader')} placeholderKey={t('api.headerKey')} placeholderValue={t('api.headerValue')} />
            {request.auth.type !== 'none' && (
              <p className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary/90">
                {t('api.authPreview', { auth: t(`api.auth_${request.auth.type}`) })}
              </p>
            )}
          </>
        )}
        {tab === 'body' && <BodyEditor body={request.body} onChange={(body) => onChange({ body })} />}
        {tab === 'auth' && <AuthEditor auth={request.auth} onChange={(auth) => onChange({ auth })} />}
      </div>

      {/* ——— Variables popover ——— floating so the editor height never jumps */}
      {varsOpen && (
        <Popover anchor={varsBtnRef.current} onClose={() => setVarsOpen(false)} width="w-80">
          <div className="px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{t('api.varsTitle')}</span>
              <button onClick={() => setVarsOpen(false)} className="cursor-pointer rounded p-0.5 text-muted hover:bg-hover hover:text-ink">
                <X size={13} />
              </button>
            </div>
            <p className="mb-2 text-[11px] text-muted">{t('api.varsHint')}</p>
            <KvRows
              rows={vars}
              onChange={onVarsChange}
              addLabel={t('api.addVariable')}
              placeholderKey={t('api.variableName')}
              placeholderValue={t('api.variableValue')}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ———————————————————————————————————————————————— */

/** Generic key-value row editor shared by Params / Headers / Variables / form bodies. */
function KvRows({
  rows,
  onChange,
  addLabel,
  placeholderKey,
  placeholderValue,
}: {
  rows: [string, string][];
  onChange: (rows: [string, string][]) => void;
  addLabel: string;
  placeholderKey: string;
  placeholderValue: string;
}) {
  const { t } = useTranslation();
  const set = (idx: number, part: 0 | 1, value: string) => {
    const next = rows.map((row, i) => (i === idx ? (part === 0 ? [value, row[1]] : [row[0], value]) as [string, string] : row));
    onChange(next);
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  return (
    <div>
      {rows.length === 0 && <p className="py-1 text-center text-[11px] text-muted">{t('api.noRows')}</p>}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        {rows.map(([key, value], idx) => (
          <FragmentRow key={idx} idx={idx} keyValue={[key, value]} set={set} remove={remove} placeholderKey={placeholderKey} placeholderValue={placeholderValue} />
        ))}
      </div>
      <button onClick={() => onChange([...rows, ['', '']])} className="mt-1.5 cursor-pointer rounded-lg border border-line bg-panel px-3 py-1 text-xs font-semibold text-primary transition-colors duration-150 hover:border-primary">
        {addLabel}
      </button>
    </div>
  );
}

/** A single row (key + value + remove). Keyed by index so focus survives edits. */
function FragmentRow({
  idx,
  keyValue,
  set,
  remove,
  placeholderKey,
  placeholderValue,
}: {
  idx: number;
  keyValue: [string, string];
  set: (idx: number, part: 0 | 1, value: string) => void;
  remove: (idx: number) => void;
  placeholderKey: string;
  placeholderValue: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <input value={keyValue[0]} onChange={(e) => set(idx, 0, e.target.value)} placeholder={placeholderKey} spellCheck={false} className="field !px-2 !py-1 !text-xs" />
      <input value={keyValue[1]} onChange={(e) => set(idx, 1, e.target.value)} placeholder={placeholderValue} spellCheck={false} className="field !px-2 !py-1 !text-xs" />
      <button onClick={() => remove(idx)} title={t('api.removeRow')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-danger">
        <X size={13} />
      </button>
    </>
  );
}

/* ———————————————————————————————————————————————— */

function BodyEditor({ body, onChange }: { body: ApiRequest['body']; onChange: (body: ApiRequest['body']) => void }) {
  const { t } = useTranslation();
  const types: { id: ApiBodyType; label: string }[] = [
    { id: 'none', label: t('api.bodyNone') },
    { id: 'json', label: t('api.bodyJson') },
    { id: 'form', label: t('api.bodyForm') },
    { id: 'text', label: t('api.bodyText') },
  ];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
          {types.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onChange({ ...body, type: id })}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
                body.type === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {body.type === 'json' && (
          <button
            onClick={() => {
              try {
                onChange({ ...body, content: JSON.stringify(JSON.parse(body.content), null, 2) });
              } catch {
                /* keep as-is */
              }
            }}
            className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-hover hover:text-primary"
          >
            {t('api.formatJson')}
          </button>
        )}
      </div>
      {body.type === 'none' && <p className="py-1 text-[11px] text-muted">{t('api.bodyNoneHint')}</p>}
      {(body.type === 'json' || body.type === 'text') && (
        <textarea
          value={body.content}
          onChange={(e) => onChange({ ...body, content: e.target.value })}
          spellCheck={false}
          placeholder={body.type === 'json' ? t('api.bodyJsonPlaceholder') : undefined}
          className="field h-24 w-full resize-y font-mono text-[12px] leading-relaxed"
        />
      )}
      {body.type === 'form' && (
        <KvRows rows={body.form} onChange={(form) => onChange({ ...body, form })} addLabel={t('api.addRow')} placeholderKey={t('api.paramKey')} placeholderValue={t('api.paramValue')} />
      )}
    </div>
  );
}

function AuthEditor({ auth, onChange }: { auth: ApiRequest['auth']; onChange: (auth: ApiRequest['auth']) => void }) {
  const { t } = useTranslation();
  const types: { id: ApiAuthType; label: string }[] = [
    { id: 'none', label: t('api.auth_none') },
    { id: 'bearer', label: t('api.auth_bearer') },
    { id: 'basic', label: t('api.auth_basic') },
    { id: 'apikey', label: t('api.auth_apikey') },
  ];
  const set = (patch: Partial<ApiRequest['auth']>) => onChange({ ...auth, ...patch });
  return (
    <div className="max-w-md">
      <div className="mb-2 flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
        {types.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onChange({ ...auth, type: id })}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
              auth.type === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {auth.type === 'bearer' && (
        <input value={auth.token} onChange={(e) => set({ token: e.target.value })} placeholder={t('api.token')} spellCheck={false} className="field w-full !text-xs" />
      )}
      {auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-1.5">
          <input value={auth.username} onChange={(e) => set({ username: e.target.value })} placeholder={t('api.username')} spellCheck={false} className="field !text-xs" />
          <input value={auth.password} onChange={(e) => set({ password: e.target.value })} type="password" placeholder={t('api.password')} spellCheck={false} className="field !text-xs" />
        </div>
      )}
      {auth.type === 'apikey' && (
        <div className="grid grid-cols-[1fr_1.5fr] gap-1.5">
          <input value={auth.key} onChange={(e) => set({ key: e.target.value })} placeholder={t('api.headerKey')} spellCheck={false} className="field !text-xs" />
          <input value={auth.value} onChange={(e) => set({ value: e.target.value })} placeholder={t('api.headerValue')} spellCheck={false} className="field !text-xs" />
        </div>
      )}
    </div>
  );
}