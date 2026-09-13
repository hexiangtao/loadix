/**
 * Media module data model — captured assets and download tasks.
 *
 * The sniffer (background service worker) observes network traffic per tab
 * and classifies each request through `mediaClassify.ts`. Everything the UI
 * sees is a `MediaAsset`; everything a download produces is a `MediaTask`.
 *
 * Extension build: captures arrive live via `media:list` messages and are
 * persisted per-tab in `chrome.storage.session` (never to disk — captured
 * URLs routinely embed short-lived tokens). Web build: the same UI is fed
 * by paste-URL ingestion (`ingestUrl`), so both surfaces share one model.
 */

import type { LucideIcon } from 'lucide-react';

export type MediaKind = 'video' | 'audio' | 'subtitle' | 'stream' | 'image' | 'other';

export type MediaContainer =
  /** A standalone playable file (mp4/webm/mp3/…). */
  | 'file'
  /** An HLS playlist (master or media). */
  | 'hls'
  /** A DASH manifest — detected and listed in v1, parsing is v2. */
  | 'dash';

export type MediaEncryption = 'unknown' | 'none' | 'aes-128' | 'sample-aes' | 'drm';

export interface MediaAsset {
  /** Stable identity: method+url (dedupes repeated segment hits). */
  id: string;
  kind: MediaKind;
  container: MediaContainer;
  url: string;
  method: string;
  /** Response content-type, when the sniffer saw headers. */
  contentType: string;
  /** bytes, when the response declared or finished with a length. */
  size: number | null;
  fileName: string;
  /** Ids of assets this one aggregates (e.g. variant streams of a master). */
  children?: string[];
  /** For streams: the resolved media playlist (v1 HLS) or '' . */
  playlistUrl?: string;
  encryption: MediaEncryption;
  firstSeenAt: number;
  lastSeenAt: number;
  hits: number;
  /** webRequest saw these request headers — replay-friendly. */
  requestHeaders: [string, string][];
  /** true when the capture came from the live sniffer (vs paste-URL). */
  live: boolean;
  pageUrl: string;
}

export interface MediaVariant {
  /** BANDWIDTH attribute (bits/s). */
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  /** Absolute URL of the variant media playlist. */
  url: string;
}

export interface HlsKey {
  method: 'NONE' | 'AES-128' | 'SAMPLE-AES';
  uri: string;
  iv?: string;
}

export interface ParsedMediaPlaylist {
  /** Absolute segment URLs in play order. */
  segments: string[];
  key: HlsKey | null;
  /** EXT-X-MAP initialization segment (fMP4/CMAF), absolute. */
  initSegment?: string;
  targetDuration: number;
  /** Total duration in seconds when known (sum of EXTINF). */
  durationSeconds: number | null;
  /** true when the manifest advertises live (unbounded) windows. */
  isLive: boolean;
  /** EXT-X-MEDIA-SEQUENCE — derives default AES IVs (RFC 8216 §4.3.2.4). */
  mediaSequence: number;
}

export interface ParsedMasterPlaylist {
  isMaster: true;
  variants: MediaVariant[];
}

export type ParsedPlaylist = ParsedMediaPlaylist | ParsedMasterPlaylist;

export type TaskState = 'preparing' | 'downloading' | 'decrypting' | 'merging' | 'done' | 'error' | 'canceled';

export interface MediaTask {
  id: string;
  assetId: string;
  title: string;
  fileName: string;
  state: TaskState;
  /** 0..1 — segment-weighted for streams, byte-based for files. */
  progress: number;
  /** Bytes fetched so far (segments include decrypt/merge output estimates). */
  receivedBytes: number;
  totalBytes: number | null;
  segmentsDone: number;
  segmentsTotal: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export const KIND_META: Record<MediaKind, { label: string; icon: string; className: string }> = {
  video: { label: 'Video', icon: 'Film', className: 'text-primary' },
  audio: { label: 'Audio', icon: 'Music', className: 'text-violet' },
  subtitle: { label: 'Subtitle', icon: 'Captions', className: 'text-success' },
  stream: { label: 'Stream', icon: 'Radio', className: 'text-warning' },
  image: { label: 'Image', icon: 'Image', className: 'text-muted' },
  other: { label: 'File', icon: 'File', className: 'text-muted' },
};

/** A display icon is resolved at the UI edge — registry stays data-only. */
export function mediaIcon(_kind: MediaKind): LucideIcon | null {
  return null;
}

export function createMediaTask(assetId: string, title: string, fileName: string): MediaTask {
  const now = Date.now();
  return {
    id: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    assetId,
    title,
    fileName,
    state: 'preparing',
    progress: 0,
    receivedBytes: 0,
    totalBytes: null,
    segmentsDone: 0,
    segmentsTotal: 0,
    startedAt: now,
  };
}
