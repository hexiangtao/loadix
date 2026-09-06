/**
 * Data model for the Requests module — a lightweight API client.
 *
 * The shape mirrors the Markdown module's workspace model on purpose:
 * requests ⇄ documents, collections ⇄ folders, and the same "draft until
 * you name it" philosophy (an unnamed request lives under Drafts, giving
 * it a name is the only act of "saving").
 */

import type { RawResponse } from '@/engine/runner';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Shared method colour language — text tones (editor hero bar, title row). */
export const METHOD_TEXT: Record<ApiMethod, string> = {
  GET: 'text-success',
  POST: 'text-primary',
  PUT: 'text-warning',
  PATCH: 'text-violet',
  DELETE: 'text-danger',
  HEAD: 'text-muted',
  OPTIONS: 'text-muted',
};

/** Tinted chip variant for list rows (sidebar tree, history). */
export const METHOD_CHIP: Record<ApiMethod, string> = {
  GET: 'bg-success/10 text-success',
  POST: 'bg-primary/10 text-primary',
  PUT: 'bg-warning/10 text-warning',
  PATCH: 'bg-violet/10 text-violet',
  DELETE: 'bg-danger/10 text-danger',
  HEAD: 'bg-muted/10 text-muted',
  OPTIONS: 'bg-muted/10 text-muted',
};

export type ApiBodyType = 'none' | 'json' | 'form' | 'text';

export type ApiAuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface ApiBody {
  type: ApiBodyType;
  /** JSON / text payload (content-type json|text). */
  content: string;
  /** Key-value rows for application/x-www-form-urlencoded bodies. */
  form: [string, string][];
}

export interface ApiAuth {
  type: ApiAuthType;
  /** Bearer token. */
  token: string;
  /** Basic auth credentials. */
  username: string;
  password: string;
  /** Custom header auth (e.g. X-API-Key). */
  key: string;
  value: string;
}

export interface ApiRequest {
  id: string;
  /** '' means "untitled draft" — the request lives under Drafts until named. */
  name: string;
  /** null = draft (not yet placed in a collection). */
  collectionId: string | null;
  method: ApiMethod;
  url: string;
  /** Query params — kept in two-way sync with the URL's query string. */
  params: [string, string][];
  /** User headers. Auth-derived headers are computed at send time, never stored. */
  headers: [string, string][];
  body: ApiBody;
  auth: ApiAuth;
  createdAt: number;
  updatedAt: number;
}

export interface ApiCollection {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

/** A sent request, kept so History can reopen it as a fresh draft. */
export interface ApiHistoryEntry {
  id: string;
  /** Snapshot of the request as sent. */
  request: ApiRequest;
  sentAt: number;
  status: number;
  ms: number;
  ok: boolean;
  error: string;
}

/** What the Requests module's UI consumes — same shape the executor returns. */
export type ApiResponse = RawResponse;

/** Default request timeout (ms) for Requests sends. Kept off the UI on
 *  purpose — a fixed sane default is part of "no bookkeeping". */
export const DEFAULT_TIMEOUT_MS = 30_000;

export function createApiRequest(): ApiRequest {
  const now = Date.now();
  return {
    id: uid(),
    name: '',
    collectionId: null,
    method: 'GET',
    url: '',
    params: [],
    headers: [['Accept', 'application/json']],
    body: { type: 'none', content: '', form: [] },
    auth: { type: 'none', token: '', username: '', password: '', key: 'X-API-Key', value: '' },
    createdAt: now,
    updatedAt: now,
  };
}

export function createApiCollection(name: string, parentId: string | null = null): ApiCollection {
  return { id: uid(), name, parentId, createdAt: Date.now() };
}

/** Collision-safe id (same strategy as the markdown docStore). */
export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The title shown in lists: manual name wins, else "GET /path" from the URL. */
export function requestDisplayTitle(req: Pick<ApiRequest, 'name' | 'method' | 'url'>, fallback: string): string {
  if (req.name.trim()) return req.name.trim();
  if (req.url.trim()) {
    try {
      const path = new URL(req.url).pathname;
      return `${req.method} ${path === '/' || !path ? new URL(req.url).host : path}`;
    } catch {
      return req.url;
    }
  }
  return fallback;
}