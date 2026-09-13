/**
 * HLS playlist parsing — master and media playlists (RFC 8216 subset).
 *
 * Pure and dependency-free: text in, typed playlists out. The downloader
 * resolves relative URIs against the playlist URL before consuming these.
 * Covers what real-world m3u8s actually use:
 *   - EXT-X-STREAM-INF variants (master)
 *   - EXTINF segments, EXT-X-KEY (AES-128 / SAMPLE-AES / NONE), EXT-X-MAP
 *   - EXT-X-ENDLIST (VOD marker) — its absence ⇒ live window
 */

import type { HlsKey, MediaVariant, ParsedMasterPlaylist, ParsedMediaPlaylist } from './mediaTypes';

/** Sniff a playlist body: master playlists declare variants. */
export function isMasterPlaylist(body: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(body);
}

/** Parse a master playlist into its variant list (absolute URLs). */
export function parseMasterPlaylist(body: string, playlistUrl: string): ParsedMasterPlaylist {
  const lines = body.split(/\r?\n/);
  const variants: MediaVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
    // The variant URI is the next non-comment, non-empty line.
    let uri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!.trim();
      if (!next || next.startsWith('#')) continue;
      uri = next;
      i = j;
      break;
    }
    if (!uri) continue;
    variants.push({
      bandwidth: Number(attrs.BANDWIDTH ?? 0),
      resolution: typeof attrs.RESOLUTION === 'string' ? attrs.RESOLUTION : undefined,
      codecs: typeof attrs.CODECS === 'string' ? attrs.CODECS : undefined,
      url: resolveUrl(uri, playlistUrl),
    });
  }
  return { isMaster: true, variants };
}

interface MediaPlaylistAccumulator {
  segments: string[];
  key: HlsKey | null;
  initSegment?: string;
  targetDuration: number;
  durationSeconds: number | null;
  isLive: boolean;
  /** EXT-X-MEDIA-SEQUENCE — derives default AES IVs (RFC 8216 §4.3.2.4). */
  mediaSequence: number;
}

/** Parse a media playlist: ordered segments, encryption key, init segment. */
export function parseMediaPlaylist(body: string, playlistUrl: string): ParsedMediaPlaylist {
  const lines = body.split(/\r?\n/);
  const acc: MediaPlaylistAccumulator = {
    segments: [],
    key: null,
    targetDuration: 0,
    durationSeconds: null,
    isLive: true,
    mediaSequence: 0,
  };
  let totalDuration = 0;
  let sawEndList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const value = parseFloat(line.slice(line.indexOf(':') + 1));
      if (Number.isFinite(value)) totalDuration += value;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION')) {
      acc.targetDuration = Number(line.slice(line.indexOf(':') + 1)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      acc.mediaSequence = Number(line.slice(line.indexOf(':') + 1)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      const method = (attrs.METHOD ?? 'NONE') as HlsKey['method'];
      acc.key =
        method === 'NONE'
          ? null
          : {
              method,
              uri: attrs.URI ? resolveUrl(String(attrs.URI), playlistUrl) : '',
              iv: typeof attrs.IV === 'string' ? attrs.IV : undefined,
            };
      continue;
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      if (attrs.URI) acc.initSegment = resolveUrl(String(attrs.URI), playlistUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      sawEndList = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    acc.segments.push(resolveUrl(line, playlistUrl));
  }

  if (sawEndList) acc.isLive = false;
  acc.durationSeconds = totalDuration > 0 ? totalDuration : null;
  return acc;
}

/** `#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x...` → attribute map. */
export function parseAttributes(input: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  // Attribute values may contain commas inside quotes — split carefully.
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim().toUpperCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = /^0x[0-9a-f]+$/i.test(value) ? value : Number.isFinite(Number(value)) && value !== '' ? Number(value) : value;
  }
  return out;
}

/** Resolve a possibly-relative URI against the playlist's own URL. */
export function resolveUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}
