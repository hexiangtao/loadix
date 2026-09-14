/**
 * dashMux unit tests — synthetic single-track fMP4 streams in, assertions
 * on the merged output. Structures mirror Bilibili's real layout (verified
 * by walking actual boxes): ftyp + moov(trak[hdlr vide/soun], trex id=1) +
 * moof(mfhd, traf(tfhd id=1, tfdt, trun)) + mdat.
 */

import { describe, expect, it } from 'vitest';
import {
  BoxStreamParser,
  FragmentMerger,
  buildMergedHeader,
  fragmentDecodeTime,
  iterateBoxes,
  moovTimescale,
  patchFragment,
  sidxFragmentCount,
  type Mp4Box,
} from './dashMux';

/* ——— synthetic fMP4 builders ——— */

const u32 = (v: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v);
  return out;
};
const u64 = (v: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v);
  return out;
};
const four = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};
type Bytes = Uint8Array | Mp4Box;
const raw = (p: Bytes): Uint8Array => (p instanceof Uint8Array ? p : p.data);
const box = (type: string, ...body: Bytes[]): Mp4Box => {
  const parts = body.map(raw);
  const data = cat(u32(8 + parts.reduce((s, p) => s + p.length, 0)), four(type), ...parts);
  return { type, data };
};

/** FullBox: version + 24-bit flags + payload. */
const fullBox = (type: string, version: number, flags: number, ...body: Uint8Array[]): Mp4Box => {
  const vf = new Uint8Array(4);
  new DataView(vf.buffer).setUint32(0, (version << 24) | flags);
  return box(type, vf, ...body);
};

const makeFtyp = (): Mp4Box => box('ftyp', four('isom'), u32(512), four('isom'), four('iso2'));

/** One-trak moov with the given handler and timescale (mirrors Bilibili). */
const makeMoov = (handler: 'vide' | 'soun', trackId: number, timescale: number): Mp4Box => {
  const tkhd = fullBox('tkhd', 0, 3, cat(u32(0), u32(0), u32(trackId), u32(0), new Uint8Array(4 * 16)));
  const mdhd = fullBox('mdhd', 0, 0, cat(u32(0), u32(0), u32(timescale), u32(0), four('und'), new Uint8Array(2)));
  const hdlr = fullBox('hdlr', 0, 0, cat(u32(0), four(handler), u32(0), u32(0), u32(0), four('dumm')));
  const stbl = box(
    'stbl',
    box('stsd', fullBox('stsd', 0, 0, u32(0)), box('avc1', u32(0), u32(0), new Uint8Array(6), u32(0), new Uint8Array(78))),
    box('stts', fullBox('stts', 0, 0, u32(0))),
    box('stsc', fullBox('stsc', 0, 0, u32(0))),
    box('stsz', fullBox('stsz', 0, 0, cat(u32(0), u32(0)))),
    box('stco', fullBox('stco', 0, 0, u32(0))),
  );
  const mdia = box('mdia', mdhd, hdlr, box('minf', box('smhd', fullBox('smhd', 0, 0, new Uint8Array(2))), box('dinf', box('dref', fullBox('dref', 0, 0, u32(1)), fullBox('url ', 0, 1))), stbl));
  const trak = box('trak', tkhd, box('edts', fullBox('elst', 0, 0, u32(0))), mdia);
  const trex = fullBox('trex', 0, 0, cat(u32(trackId), u32(1), u32(0), u32(0), u32(0)));
  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    cat(u32(0), u32(0), u32(timescale), u32(0), u32(0x00010000), new Uint8Array(2), new Uint8Array(2 * 4), u32(0), u32(2), u32(0x00010000), new Uint8Array(4 * 9), u32(0), u32(0), u32(0), u32(0), four('dum1'), four('dum2'), u32(2), u32(1)),
  );
  return box('moov', mvhd, trak, box('mvex', trex));
};

/** A fragment: moof(mfhd, traf(tfhd, tfdt, trun)) + mdat with fake payload. */
const makeFragment = (trackId: number, decodeTime: number, mdatSize: number, version = 1): { moof: Mp4Box; mdat: Mp4Box } => {
  const tfhd = fullBox('tfhd', 0, 0x020038, cat(u32(trackId), u32(1), u32(1), u32(0)));
  const tfdt = fullBox('tfdt', version, 0, version === 1 ? u64(BigInt(decodeTime)) : u32(decodeTime));
  const trun = fullBox('trun', 0, 0x000201, cat(u32(4), u32(0), u32(mdatSize - 8), u32(3000), u32(200), u32(3000), u32(200), u32(3000), u32(200), u32(3000), u32(200)));
  const mfhd = fullBox('mfhd', 0, 0, u32(1));
  const moof = box('moof', mfhd, box('traf', tfhd, tfdt, trun));
  const mdat = box('mdat', new Uint8Array(mdatSize - 8));
  return { moof, mdat };
};

const findIn = (buf: Uint8Array, type: string): Mp4Box | undefined =>
  [...iterateBoxes(buf)].find((b) => b.type === type);

/* ——— tests ——— */

describe('dashMux — header merge', () => {
  it('merges two single-trak moovs into one dual-trak file with renumbered ids', () => {
    const videoHeader = [makeFtyp(), makeMoov('vide', 1, 16000), box('sidx', u32(0), u32(0))];
    const audioHeader = [makeFtyp(), makeMoov('soun', 1, 48000)];
    const merged = buildMergedHeader(videoHeader, audioHeader);

    expect(merged.map((b) => b.type)).toEqual(['ftyp', 'moov']);
    const moov = merged[1]!;
    const children = [...iterateBoxes(moov.data, 8)].map((b) => b.type);
    expect(children).toEqual(['mvhd', 'trak', 'trak', 'mvex']);

    // tkhd ids: 1 (video) and 2 (audio).
    const traks = [...iterateBoxes(moov.data, 8)].filter((b) => b.type === 'trak');
    const ids = traks.map((t) => {
      const tkhd = [...iterateBoxes(t.data, 8)].find((b) => b.type === 'tkhd')!;
      return new DataView(tkhd.data.buffer, tkhd.data.byteOffset).getUint32(20);
    });
    expect(ids).toEqual([1, 2]);

    // trex ids follow.
    const mvex = [...iterateBoxes(moov.data, 8)].find((b) => b.type === 'mvex')!;
    const trexIds = [...iterateBoxes(mvex.data, 8)].map(
      (t) => new DataView(t.data.buffer, t.data.byteOffset).getUint32(12),
    );
    expect(trexIds).toEqual([1, 2]);

    // Byte-length neutrality: merged moov = source mvhd + both (renumbered)
    // traks + a mvex holding both trex boxes — nothing dropped or duplicated.
    const videoMoov = findIn(cat(...videoHeader.map((b) => b.data)), 'moov')!;
    const audioMoov = findIn(cat(...audioHeader.map((b) => b.data)), 'moov')!;
    const childOf = (moov: Mp4Box, type: string): Mp4Box =>
      [...iterateBoxes(moov.data, 8)].find((b) => b.type === type)!;
    const trexOf = (moov: Mp4Box): number => childOf(childOf(moov, 'mvex'), 'trex').data.length;
    const mvexSize = 8 + trexOf(videoMoov) + trexOf(audioMoov);
    const expectedLength =
      8 + // moov header itself
      childOf(videoMoov, 'mvhd').data.length +
      traks[0]!.data.length +
      traks[1]!.data.length +
      mvexSize;
    expect(moov.data.length).toBe(expectedLength);
  });

  it('rejects layouts it cannot safely merge (no soun trak)', () => {
    const videoHeader = [makeFtyp(), makeMoov('vide', 1, 16000)];
    const audioHeader = [makeFtyp(), makeMoov('vide', 1, 48000)]; // wrong handler
    expect(() => buildMergedHeader(videoHeader, audioHeader)).toThrow(/soun/);
  });
});

describe('dashMux — fragments', () => {
  it('reads decode time in both tfdt versions and patch keeps byte length', () => {
    const { moof } = makeFragment(1, 42_000, 1000, 1);
    expect(fragmentDecodeTime(moof)).toBe(42_000);
    const v0 = makeFragment(1, 7_000, 1000, 0);
    expect(fragmentDecodeTime(v0.moof)).toBe(7_000);

    const patched = patchFragment(moof, 2, 17);
    expect(patched.data.length).toBe(moof.data.length);
    // tfhd track id now 2, mfhd seq now 17.
    const traf = [...iterateBoxes(patched.data, 8)].find((b) => b.type === 'traf')!;
    const tfhd = [...iterateBoxes(traf.data, 8)].find((b) => b.type === 'tfhd')!;
    expect(new DataView(tfhd.data.buffer, tfhd.data.byteOffset).getUint32(12)).toBe(2);
    const mfhd = [...iterateBoxes(patched.data, 8)].find((b) => b.type === 'mfhd')!;
    expect(new DataView(mfhd.data.buffer, mfhd.data.byteOffset).getUint32(12)).toBe(17);
  });

  it('interleaves fragments by decode time in seconds (different timescales)', () => {
    const merger = new FragmentMerger();
    // Video ts=16000: fragments at 0s, 1s, 2s. Audio ts=48000: 0s, 1s, 2s.
    const out: string[] = [];
    const feed = (slot: 'video' | 'audio', dt: number, ts: number) => {
      const { moof, mdat } = makeFragment(1, dt, 600);
      for (const ready of merger.push(slot, moof, mdat, ts)) out.push(`${ready.slot}@${fragmentDecodeTime(ready.moof)}`);
    };
    // Deliberately out-of-order arrival across tracks. Global time order:
    // 0s(v,a) 1s(v,a) 2s(v,a) 3s(v,a) — video wins ties.
    feed('video', 0, 16000);
    feed('audio', 0, 48000);
    feed('video', 16000, 16000); // 1s
    feed('audio', 48000, 48000); // 1s
    feed('audio', 96_000, 48000); // 2s — audio arrives ahead of its video
    feed('video', 32_000, 16000); // 2s — tie → video first
    feed('audio', 144_000, 48000); // 3s
    feed('video', 48_000, 16000); // 3s
    // Track ends: flush releases anything still queued (the last audio).
    for (const ready of merger.flush()) out.push(`${ready.slot}@${fragmentDecodeTime(ready.moof)}`);
    expect(out).toEqual([
      'video@0', 'audio@0',
      'video@16000', 'audio@48000',
      'video@32000', 'audio@96000',
      'video@48000', 'audio@144000',
    ]);
  });

  it('flushes the trailing track when the other ends first', () => {
    const merger = new FragmentMerger();
    const emitted: string[] = [];
    const { moof: vMoof, mdat: vMdat } = makeFragment(1, 0, 500);
    for (const r of merger.push('video', vMoof, vMdat, 16000)) emitted.push(r.slot);
    const { moof: aMoof1, mdat: aMdat1 } = makeFragment(1, 0, 500);
    for (const r of merger.push('audio', aMoof1, aMdat1, 48000)) emitted.push(r.slot);
    // Video track ends → its queued tail flushes even without audio counterpart.
    for (const r of merger.flush()) emitted.push(r.slot);
    expect(emitted).toEqual(['video', 'audio']);
  });

  it('reports sidx fragment count (v0 and v1)', () => {
    // Layout from box start: ver/flags(4) refID(4) timescale(4)
    // early(4|8) offset(4|8) reserved(4) count(u16) → 32 (v0) / 40 (v1).
    const count = (n: number): Uint8Array => Uint8Array.from([0, n]);
    const v0 = box('sidx', u32(0), u32(1), u32(1000), u32(0), u32(0), u32(0), count(2), new Uint8Array(12 * 2));
    const v1 = box('sidx', u32(1 << 24), u32(1), u32(1000), u64(0n), u64(0n), u32(0), count(3), new Uint8Array(12 * 3));
    expect(sidxFragmentCount(v0)).toBe(2);
    expect(sidxFragmentCount(v1)).toBe(3);
  });
});

describe('dashMux — timescale + streaming parser', () => {
  it('extracts per-track timescale from mdhd', () => {
    expect(moovTimescale(makeMoov('vide', 1, 16000))).toBe(16000);
    expect(moovTimescale(makeMoov('soun', 1, 48000))).toBe(48000);
  });

  it('reassembles boxes across arbitrary chunk boundaries', () => {
    const stream = cat(
      makeFtyp().data,
      makeMoov('vide', 1, 16000).data,
      makeFragment(1, 0, 2000).moof.data,
      makeFragment(1, 0, 2000).mdat.data,
    );
    const parser = new BoxStreamParser();
    const types: string[] = [];
    // Feed one byte at a time — worst case fragmentation.
    for (let i = 0; i < stream.length; i++) {
      for (const b of parser.push(stream.subarray(i, i + 1))) types.push(b.type);
    }
    expect(types).toEqual(['ftyp', 'moov', 'moof', 'mdat']);
    expect(parser.buffered).toBe(0);
  });

  it('rejects nonsense sizes instead of looping', () => {
    const parser = new BoxStreamParser();
    const bad = new Uint8Array(16);
    new DataView(bad.buffer).setUint32(0, 4); // size < header
    bad[4] = 0x78; bad[5] = 0x78; bad[6] = 0x78; bad[7] = 0x78;
    expect(() => parser.push(bad)).toThrow(/malformed/);
  });
});
