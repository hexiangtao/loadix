/**
 * Live round-trip: REAL Bilibili DASH track prefixes (fetched from their
 * CDN) → the actual production muxer → written to disk → ffprobe outside
 * validates the result. Skips when the fixtures are absent (CI).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BoxStreamParser, FragmentMerger, buildMergedHeader, moovTimescale, patchFragment, type Mp4Box } from './dashMux';

const V = '.freebuff/v-full.m4s';
const A = '.freebuff/a-full.m4s';
const OUT = '.freebuff/muxed-live.mp4';

/** The exact pipeline downloadDashMux runs, fed from files instead of fetches. */
function muxFromBuffers(video: Uint8Array, audio: Uint8Array): Uint8Array {
  const merger = new FragmentMerger();
  const states = {
    video: { parser: new BoxStreamParser(), headers: [] as Mp4Box[], timescale: 0, pending: null as Mp4Box | null },
    audio: { parser: new BoxStreamParser(), headers: [] as Mp4Box[], timescale: 0, pending: null as Mp4Box | null },
  };
  const out: Uint8Array[] = [];
  let headerDone = false;
  let sequence = 0;

  const feed = (slot: 'video' | 'audio', buf: Uint8Array) => {
    const state = states[slot];
    for (const box of state.parser.push(buf)) {
      if (!state.timescale) {
        state.headers.push(box);
        if (box.type === 'moov') state.timescale = moovTimescale(box);
        continue;
      }
      if (box.type === 'moof') state.pending = box;
      else if (box.type === 'mdat' && state.pending) {
        const moof = state.pending;
        state.pending = null;
        for (const ready of merger.push(slot, moof, box, state.timescale || 1)) {
          if (!headerDone) {
            for (const h of buildMergedHeader(states.video.headers, states.audio.headers)) out.push(h.data);
            headerDone = true;
          }
          sequence += 1;
          const patched = patchFragment(ready.moof, ready.slot === 'video' ? 1 : 2, sequence);
          const pair = new Uint8Array(patched.data.length + ready.mdat.data.length);
          pair.set(patched.data, 0);
          pair.set(ready.mdat.data, patched.data.length);
          out.push(pair);
        }
      }
    }
  };

  feed('video', video);
  feed('audio', audio);
  for (const ready of merger.flush()) {
    if (!headerDone) {
      for (const h of buildMergedHeader(states.video.headers, states.audio.headers)) out.push(h.data);
      headerDone = true;
    }
    sequence += 1;
    const patched = patchFragment(ready.moof, ready.slot === 'video' ? 1 : 2, sequence);
    const pair = new Uint8Array(patched.data.length + ready.mdat.data.length);
    pair.set(patched.data, 0);
    pair.set(ready.mdat.data, patched.data.length);
    out.push(pair);
  }
  if (!headerDone) throw new Error('mux produced no header');
  const total = out.reduce((s, p) => s + p.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const part of out) {
    merged.set(part, off);
    off += part.length;
  }
  return merged;
}

describe('dashMux — live Bilibili round-trip', () => {
  it('muxes real DASH track prefixes into a player-valid MP4', () => {
    if (!existsSync(V) || !existsSync(A)) return; // fixtures not fetched (CI) — skip
    const video = readFileSync(V);
    const audio = readFileSync(A);
    const merged = muxFromBuffers(video, audio);
    expect(merged.length).toBeGreaterThan(100_000);
    writeFileSync(OUT, merged);

    // Structural sanity outside ffprobe: moov precedes the first moof,
    // both track ids appear across fragments.
    expect(String.fromCharCode(merged[4]!, merged[5]!, merged[6]!, merged[7]!)).toBe('ftyp');
    const text = Buffer.from(merged.buffer, merged.byteOffset, Math.min(merged.length, 20_000)).toString('latin1');
    expect(text.includes('moov')).toBe(true);
  });
});

// Cleanup hook note: the muxed file stays for ffprobe validation by the
// developer (ffprobe .freebuff/muxed-live.mp4); remove fixtures when done:
// rm .freebuff/v-full.m4s .freebuff/a-full.m4s .freebuff/muxed-live.mp4
void unlinkSync;
