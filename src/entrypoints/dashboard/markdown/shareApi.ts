/**
 * Client side of the share backend (functions/). The backend is only hosted
 * on the web build (lab.loadix.dev), so every call here is guarded upstream
 * by the `canShare` http(s) check in MarkdownTool.
 *
 * Ownership model: the first POST returns an `ownerToken`; the client keeps
 * it in the IndexedDB share registry (docStore) and presents it via the
 * X-Share-Token header on PUT (re-publish) and DELETE (revoke). Public reads
 * never see it.
 */

export interface CreatedShare {
  id: string;
  url: string;
  ownerToken: string;
}

export type ShareErrorCode = 'generic' | 'too-large' | 'forbidden' | 'not-found' | 'network';

export class ShareError extends Error {
  code: ShareErrorCode;
  constructor(code: ShareErrorCode) {
    super(code);
    this.code = code;
  }
}

/** The id rides in both the path and the query: hosts that redirect /s/* to
    a clean path keep the query (but drop the path id), so the viewer can
    recover the document either way. Mirrors the original share flow. */
export function shareUrl(id: string): string {
  return `${window.location.origin}/s/${id}?id=${id}`;
}

/** Stable, cheap content hash (djb2, hex) so staleness survives reloads. */
export function hashSource(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h * 33) ^ source.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.ok) return body;
  const raw = body?.error ?? '';
  const code: ShareErrorCode =
    raw === 'source_too_large' ? 'too-large' : raw === 'forbidden' ? 'forbidden' : raw === 'not_found' ? 'not-found' : 'generic';
  throw new ShareError(code);
}

export async function createShare(source: string): Promise<CreatedShare> {
  let res: Response;
  try {
    res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
  } catch {
    throw new ShareError('network');
  }
  const data = (await parseResponse(res)) as { id?: string; ownerToken?: string } | null;
  if (!data?.id || !data.ownerToken) throw new ShareError('generic');
  return { id: data.id, url: shareUrl(data.id), ownerToken: data.ownerToken };
}

export async function updateShare(id: string, source: string, ownerToken: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/share/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-share-token': ownerToken },
      body: JSON.stringify({ source }),
    });
  } catch {
    throw new ShareError('network');
  }
  await parseResponse(res);
}

export async function revokeShare(id: string, ownerToken: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/share/${id}`, {
      method: 'DELETE',
      headers: { 'x-share-token': ownerToken },
    });
  } catch {
    throw new ShareError('network');
  }
  await parseResponse(res);
}

/**
 * Sets (absolute ms timestamp) or clears (null) a link's expiration. The link
 * 404s for visitors once expired; the owner can renew it with another call.
 */
export async function setShareExpiry(
  id: string,
  expiresAt: number | null,
  ownerToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/share/${id}/expiry`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-share-token': ownerToken },
      body: JSON.stringify({ expiresAt }),
    });
  } catch {
    throw new ShareError('network');
  }
  await parseResponse(res);
}

/**
 * Writes text to the clipboard: Async Clipboard API first, then the legacy
 * textarea + execCommand path (covers insecure contexts and browsers without
 * the API). Never throws — resolves false when every path is denied so the
 * caller can fall back to its own affordance.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Compact, locale-aware relative time ("just now", "5 min ago", …). */
export function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const fmt = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (seconds >= size) return fmt.format(-Math.floor(seconds / size), unit);
  }
  return fmt.format(-seconds, 'second');
}

/** Compact, locale-aware relative future time ("in 5 min", "in 7 days", …). */
export function timeUntil(ts: number): string {
  const seconds = Math.max(0, Math.ceil((ts - Date.now()) / 1000));
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const fmt = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (seconds >= size) return fmt.format(Math.ceil(seconds / size), unit);
  }
  return fmt.format(Math.ceil(seconds), 'second');
}