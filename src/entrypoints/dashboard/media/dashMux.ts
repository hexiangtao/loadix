/**
 * DASH remuxer — two single-track fMP4 streams in, one dual-track MP4 out.
 *
 * Verified against Bilibili's DASH layout by walking real boxes (2026-09):
 *   - every track file: `ftyp + moov(one trak, trex track_ID=1) + sidx + (moof+mdat)*N`
 *   - both files claim `track_ID=1` → real renumbering is required
 *   - fragments set `default-base-is-moof` (tfhd flags 0x020000) → data offsets
 *     are relative to their own moof, so moof+mdat pairs can be copied
 *     verbatim into the output at any position
 *
 * The surgery, all box-level (no sample re-timing, no re-encoding):
 *   1. merge the two moovs: mvhd (from video) + trak_vide + trak_soun,
 *      tkhd/trex track ids renumbered 1/2, mvex keeps both trex
 *   2. interleave fragments ordered by tfdt baseMediaDecodeTime (stable:
 *      video wins ties — its timestamps lead audio at equal times)
 *   3. per fragment: patch tfhd track id + mfhd sequence number
 *
 * Streaming shape: the engine feeds boxes as they arrive over the network;
 * the merger emits only what is safely ordered, so memory stays bounded
 * (a handful of fragments per track) and output streams straight to disk.
 */

/* ------------------------------------------------------------------ */
/* Box primitives                                                      */
/* ------------------------------------------------------------------ */

export interface Mp4Box {
  /** FourCC, e.g. 'moov'. */
  type: string;
  /** Full box bytes, header included. */
  data: Uint8Array;
}

const boxType = (data: Uint8Array): string => String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!);

/** Iterate sibling boxes in a buffer. Handles 64-bit largesize defensively. */
export function* iterateBoxes(buf: Uint8Array, offset = 0, end = buf.length): Generator<Mp4Box> {
  let off = offset;
  while (off + 8 <= end) {
    const view = new DataView(buf.buffer, buf.byteOffset + off, end - off);
    let size = view.getUint32(0);
    const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
    let headerSize = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - off; // extends to end of buffer
    }
    if (size < headerSize || off + size > end) return; // truncated / malformed
    yield { type, data: buf.slice(off, off + size) };
    off += size;
  }
}

/** Walk child boxes of a container box (skipping its 8-byte header). */
function childBoxes(box: Mp4Box): Mp4Box[] {
  return [...iterateBoxes(box.data, 8, box.data.length)];
}

const findBox = (boxes: Mp4Box[], type: string): Mp4Box | undefined => boxes.find((b) => b.type === type);

/* ------------------------------------------------------------------ */
/* Header (moov) merge                                                 */
/* ------------------------------------------------------------------ */

/** hdlr handler_type for a trak ('vide' | 'soun' | …); '' when absent. */
function trakHandlerType(trak: Mp4Box): string {
  const mdia = findBox(childBoxes(trak), 'mdia');
  const hdlr = mdia && findBox(childBoxes(mdia), 'hdlr');
  if (!hdlr || hdlr.data.length < 20) return '';
  return String.fromCharCode(hdlr.data[16]!, hdlr.data[17]!, hdlr.data[18]!, hdlr.data[19]!);
}

/** Patch a 32-bit field at `valueOffset` within the box payload. */
function patchU32(box: Mp4Box, valueOffset: number, value: number): Uint8Array {
  const out = box.data.slice();
  new DataView(out.buffer).setUint32(out.byteOffset + valueOffset, value >>> 0);
  return out;
}

/** Rewrite a trak's tkhd track_ID (offset 20 in tkhd, ver 0). */
function renumberTrak(trak: Mp4Box, trackId: number): Mp4Box {
  const children = childBoxes(trak).map((child) =>
    child.type === 'tkhd' ? ({ type: 'tkhd', data: patchU32(child, 20, trackId) } as Mp4Box) : child,
  );
  return rebuildBox('trak', children);
}

/** Rewrite a trex's track_ID (offset 12 in trex). */
function renumberTrex(trex: Mp4Box, trackId: number): Mp4Box {
  return { type: 'trex', data: patchU32(trex, 12, trackId) };
}

/** Rebuild a container box from new children (header size never changes:
 *  every rewritten child keeps its original byte length). */
function rebuildBox(type: string, children: Mp4Box[]): Mp4Box {
  const bodyLength = children.reduce((sum, c) => sum + c.data.length, 0);
  const out = new Uint8Array(8 + bodyLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let off = 8;
  for (const child of children) {
    out.set(child.data, off);
    off += child.data.length;
  }
  return { type, data: out };
}

/**
 * Build the merged output header: ftyp (video's) + moov carrying both traks.
 * `videoHeader`/`audioHeader` are each track's leading boxes (ftyp… up to,
 * not including, the first moof). Throws when the layout is not the
 * single-trak fMP4 this module supports — the caller surfaces that as a
 * task error instead of producing an unplayable file.
 */
export function buildMergedHeader(videoHeader: Mp4Box[], audioHeader: Mp4Box[]): Mp4Box[] {
  const videoMoov = findBox(videoHeader, 'moov');
  const audioMoov = findBox(audioHeader, 'moov');
  const ftyp = findBox(videoHeader, 'ftyp') ?? findBox(audioHeader, 'ftyp');
  if (!videoMoov || !audioMoov || !ftyp) throw new Error('dash-mux: missing moov/ftyp in track headers');

  const pickTrak = (moov: Mp4Box, handler: string): Mp4Box => {
    const traks = childBoxes(moov).filter((b) => b.type === 'trak');
    const match = traks.find((t) => trakHandlerType(t) === handler);
    if (!match) throw new Error(`dash-mux: no ${handler} trak in source moov`);
    return match;
  };

  const trakV = renumberTrak(pickTrak(videoMoov, 'vide'), 1);
  const trakA = renumberTrak(pickTrak(audioMoov, 'soun'), 2);

  const trexOf = (moov: Mp4Box): Mp4Box => {
    const mvex = findBox(childBoxes(moov), 'mvex');
    const trex = mvex && findBox(childBoxes(mvex), 'trex');
    if (!trex) throw new Error('dash-mux: source moov has no trex (not an fMP4 DASH track)');
    return trex;
  };
  const mvex = rebuildBox('mvex', [renumberTrex(trexOf(videoMoov), 1), renumberTrex(trexOf(audioMoov), 2)]);

  const mvhd = findBox(childBoxes(videoMoov), 'mvhd');
  if (!mvhd) throw new Error('dash-mux: video moov has no mvhd');
  const moov = rebuildBox('moov', [mvhd, trakV, trakA, mvex]);
  return [ftyp, moov];
}

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

/** moof → its traf's tfd-t baseMediaDecodeTime (v0 32-bit, v1 64-bit). */
export function fragmentDecodeTime(moof: Mp4Box): number {
  const traf = findBox(childBoxes(moof), 'traf');
  const tfdt = traf && findBox(childBoxes(traf), 'tfdt');
  if (!tfdt) return 0;
  const view = new DataView(tfdt.data.buffer, tfdt.data.byteOffset, tfdt.data.byteLength);
  return view.getUint8(8) === 1 ? Number(view.getBigUint64(12)) : view.getUint32(12);
}

/** moov → the trak's mdhd timescale (ticks per second). Video and audio
 *  tracks use DIFFERENT timescales, so tfdt values are only comparable
 *  after normalizing to seconds. */
export function moovTimescale(moov: Mp4Box): number {
  for (const trak of childBoxes(moov)) {
    if (trak.type !== 'trak') continue;
    const mdia = findBox(childBoxes(trak), 'mdia');
    const mdhd = mdia && findBox(childBoxes(mdia), 'mdhd');
    if (!mdhd) continue;
    const view = new DataView(mdhd.data.buffer, mdhd.data.byteOffset, mdhd.data.byteLength);
    const offset = view.getUint8(8) === 1 ? 28 : 20; // after ver/flags + 2×timestamps
    return view.getUint32(offset);
  }
  return 1;
}

/** moof → its traf's tfd-t baseMediaDecodeTime (v0 32-bit, v1 64-bit). */

/** Patch a merged fragment in one pass: mfhd sequence_number and tfhd
 *  track_ID (both at payload offset 12 of their box; sizes unchanged so
 *  the enclosing moof rebuild is byte-length neutral). */
export function patchFragment(moof: Mp4Box, trackId: number, sequence: number): Mp4Box {
  const children = childBoxes(moof).map((child) => {
    if (child.type === 'mfhd') return { type: 'mfhd', data: patchU32(child, 12, sequence) };
    if (child.type === 'traf') {
      return rebuildBox(
        'traf',
        childBoxes(child).map((tc) => (tc.type === 'tfhd' ? { type: 'tfhd', data: patchU32(tc, 12, trackId) } : tc)),
      );
    }
    return child;
  });
  return rebuildBox('moof', children);
}

/** sidx → reference_count (how many fragments the index covers), or null
 *  when the box is too small to trust. Gives total progress before the
 *  first fragment lands. Layout: ver/flags(4) + reference_ID(4) +
 *  timescale(4) + early_time(4|8) + first_offset(4|8) + reserved(4) +
 *  count(2) → 32 (v0) / 40 (v1) from box start. */
export function sidxFragmentCount(sidx: Mp4Box): number | null {
  const view = new DataView(sidx.data.buffer, sidx.data.byteOffset, sidx.data.byteLength);
  const countOffset = view.getUint8(8) === 1 ? 40 : 32;
  if (sidx.data.length < countOffset + 2) return null;
  return view.getUint16(countOffset);
}

/** Output track slots, in tie-break order. */
export type DashTrackSlot = 'video' | 'audio';

/** One interleaved fragment ready to write (moof already patched). */
export interface ReadyFragment {
  slot: DashTrackSlot;
  moof: Mp4Box;
  mdat: Mp4Box;
}

/**
 * Two-track fragment merger. Feed fragments as they arrive from either
 * track; it emits them in global order (decode time in SECONDS — tracks
 * have different timescales). Per-track FIFO queues: a fast track never
 * loses fragments while the slow one catches up. Queues grow only while
 * the other track starves — bounded by network skew in practice.
 */
export class FragmentMerger {
  private readonly queues = new Map<DashTrackSlot, { seconds: number; moof: Mp4Box; mdat: Mp4Box }[]>();

  /** Offer a (moof, mdat) pair; returns fragments now safe to emit. */
  push(slot: DashTrackSlot, moof: Mp4Box, mdat: Mp4Box, timescale: number): ReadyFragment[] {
    const queue = this.queues.get(slot) ?? [];
    queue.push({ seconds: fragmentDecodeTime(moof) / Math.max(1, timescale), moof, mdat });
    this.queues.set(slot, queue);
    return this.drain();
  }

  /** Both tracks ended: flush what remains (earliest first, video wins ties). */
  flush(): ReadyFragment[] {
    const out: ReadyFragment[] = [];
    for (;;) {
      const remaining = [...this.queues.values()].filter((q) => q.length > 0);
      if (remaining.length === 0) break;
      // Emit the globally earliest remaining fragment.
      let bestSlot: DashTrackSlot = 'video';
      let best: { seconds: number; moof: Mp4Box; mdat: Mp4Box } | null = null;
      for (const [slot, queue] of this.queues) {
        const head = queue[0];
        if (head && (!best || head.seconds < best.seconds)) {
          best = head;
          bestSlot = slot;
        }
      }
      if (!best) break;
      this.queues.get(bestSlot)!.shift();
      out.push({ slot: bestSlot, moof: best.moof, mdat: best.mdat });
    }
    return out;
  }

  private drain(): ReadyFragment[] {
    const out: ReadyFragment[] = [];
    for (;;) {
      const video = this.queues.get('video')?.[0];
      const audio = this.queues.get('audio')?.[0];
      if (!video || !audio) break; // need both to compare order
      const first = video.seconds <= audio.seconds ? 'video' : 'audio';
      const item = this.queues.get(first)!.shift()!;
      out.push({ slot: first, moof: item.moof, mdat: item.mdat });
    }
    return out;
  }
}

/**
 * Incremental box splitter for network streams: feed raw chunks, receive
 * complete boxes as soon as their bytes have fully arrived. Holds at most
 * one partial box in memory (mdats are ~0.5 MB here, never whole files).
 */
export class BoxStreamParser {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Mp4Box[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const out: Mp4Box[] = [];
    let off = 0;
    for (;;) {
      const remaining = this.buffer.length - off;
      if (remaining < 8) break;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + off, remaining);
      let size = view.getUint32(0);
      let headerSize = 8;
      if (size === 1) {
        if (remaining < 16) break;
        size = Number(view.getBigUint64(8));
        headerSize = 16;
      } else if (size === 0) {
        break; // extends to stream end — caller flushes explicitly
      }
      if (size < headerSize) throw new Error('dash-mux: malformed box size');
      if (off + size > this.buffer.length) break; // partial box, wait for more
      out.push({ type: typeAt(this.buffer, off), data: this.buffer.slice(off, off + size) });
      off += size;
    }
    this.buffer = this.buffer.slice(off);
    return out;
  }

  /** Bytes still held (a single partial box header+prefix). */
  get buffered(): number {
    return this.buffer.length;
  }
}

function typeAt(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
}

export { boxType };
