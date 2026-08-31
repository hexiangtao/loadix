/**
 * Zero-dependency icon generator.
 *
 * Rasterises `public/icon.svg` (a hand-built vector that mirrors the app
 * branding) into the PNG sizes required by a Chrome / Chromium extension
 * and the Chrome Web Store:
 *
 *   - 16, 32, 48  → toolbar / extensions page
 *   - 128         → store listing & installation
 *   - 256, 512    → high-DPI / store small promo tile
 *
 * Why not sharp / canvas?  Adding a native build dep just to draw a few
 * squares is overkill.  The icon is composed of axis-aligned rectangles,
 * a few round-rect strokes, a polyline and two circles — easy to render
 * with a tiny scanline painter.  Output PNGs are identical to what
 * `headless-chrome --screenshot` would produce for these shapes.
 *
 * Run with: `node scripts/generate-icons.mjs`
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const OUT_DIR = join(ROOT, 'public');

const SIZES = [16, 32, 48, 128, 256, 512];

/* ------------------------------------------------------------------ */
/* Painters                                                            */
/* ------------------------------------------------------------------ */

/** Clamp helper. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear blend between two RGB triples. */
const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Brand gradient endpoints (matches public/icon.svg). */
const GRAD_TOP = [0x0a, 0x84, 0xff];
const GRAD_BOT = [0x00, 0x66, 0xd6];

/** Subtle top-half highlight overlay. */
const HIGHLIGHT = [1, 1, 1, 0.06];

/** Curve colour. */
const CURVE_TOP = [1, 1, 1, 0.95];
const CURVE_BOT = [1, 1, 1, 0.7];

/**
 * Build the RGBA pixel grid for a square icon at the given size.
 * Coordinates are in the 1024-space design grid; we scale by `s = size/1024`.
 */
function rasterise(size) {
  const s = size / 1024;
  const buf = new Uint8Array(size * size * 4); // RGBA, all zero (transparent)

  const setPx = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Source-over compositing.
    const sa = a / 255;
    const da = buf[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    buf[i + 0] = Math.round((r * sa + buf[i + 0] * da * (1 - sa)) / oa);
    buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
    buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };

  /* ---------- 1. Rounded-square background ---------- */
  const r = 224 * s; // corner radius
  const fillRectRounded = (x0, y0, w, h, rad) => {
    x0 *= s; y0 *= s; w *= s; h *= s;
    const x1 = x0 + w, y1 = y0 + h;
    const radC = Math.min(rad * s, w / 2, h / 2);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
        // Distance to the nearest corner centre for the corner regions.
        const inLeft = x - x0 < radC;
        const inRight = x1 - 1 - x < radC;
        const inTop = y - y0 < radC;
        const inBot = y1 - 1 - y < radC;
        let inside = true;
        if ((inLeft && inTop) || (inRight && inTop) || (inLeft && inBot) || (inRight && inBot)) {
          const cx = inLeft ? x0 + radC : x1 - radC;
          const cy = inTop ? y0 + radC : y1 - radC;
          const dx = x - cx + 0.5, dy = y - cy + 0.5;
          if (dx * dx + dy * dy > radC * radC) inside = false;
        }
        if (!inside) continue;
        // Brand gradient: top→bottom.
        const t = clamp((y - y0) / Math.max(1, y1 - y0 - 1), 0, 1);
        const [cr, cg, cb] = lerp(GRAD_TOP, GRAD_BOT, t);
        setPx(x, y, cr, cg, cb, 255);
      }
    }
  };
  fillRectRounded(0, 0, 1024, 1024, 224);

  /* ---------- 2. Top-half highlight overlay ---------- */
  for (let y = 0; y < size / 2; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = HIGHLIGHT[3] * 255;
      const r0 = buf[i], g0 = buf[i + 1], b0 = buf[i + 2];
      const sa = a / 255, da = buf[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) continue;
      buf[i + 0] = Math.round((255 * sa + r0 * da * (1 - sa)) / oa);
      buf[i + 1] = Math.round((255 * sa + g0 * da * (1 - sa)) / oa);
      buf[i + 2] = Math.round((255 * sa + b0 * da * (1 - sa)) / oa);
      buf[i + 3] = Math.round(oa * 255);
    }
  }

  /* ---------- 3. "L" mark (two rounded rects) ---------- */
  const fillRoundRect = (x, y, w, h, rad, rgb) => {
    x *= s; y *= s; w *= s; h *= s;
    rad = Math.min(rad * s, w / 2, h / 2);
    const x1 = x + w, y1 = y + h;
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(size, Math.ceil(y1)); py++) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(size, Math.ceil(x1)); px++) {
        const inLeft = px - x < rad;
        const inRight = x1 - 1 - px < rad;
        const inTop = py - y < rad;
        const inBot = y1 - 1 - py < rad;
        let inside = true;
        if ((inLeft && inTop) || (inRight && inTop) || (inLeft && inBot) || (inRight && inBot)) {
          const cx = inLeft ? x + rad : x1 - rad;
          const cy = inTop ? y + rad : y1 - rad;
          const dx = px - cx + 0.5, dy = py - cy + 0.5;
          if (dx * dx + dy * dy > rad * rad) inside = false;
        }
        if (inside) setPx(px, py, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  };
  fillRoundRect(270, 200, 120, 500, 60, [255, 255, 255]);
  fillRoundRect(270, 640, 420, 120, 60, [255, 255, 255]);

  /* ---------- 4. Load-curve polyline with thick round stroke ---------- */
  const curve = [
    [305, 820], [410, 760], [500, 700], [580, 640],
    [660, 580], [760, 500], [870, 420],
  ].map(([x, y]) => [x * s, y * s]);
  const strokeW = 56 * s;
  const strokeR = strokeW / 2;
  // For every pixel near the polyline, compute distance to the nearest
  // segment; if within strokeR, paint with the gradient colour.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let minD2 = Infinity;
      for (let i = 0; i < curve.length - 1; i++) {
        const [ax, ay] = curve[i];
        const [bx, by] = curve[i + 1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2;
        t = clamp(t, 0, 1);
        const px = ax + t * dx, py = ay + t * dy;
        const ex = x - px, ey = y - py;
        const d2 = ex * ex + ey * ey;
        if (d2 < minD2) minD2 = d2;
      }
      if (minD2 <= strokeR * strokeR) {
        // Soft edge for AA on large sizes.
        const d = Math.sqrt(minD2);
        const edge = clamp(strokeR - d, 0, 1);
        // Gradient along Y.
        const t = clamp(y / Math.max(1, size - 1), 0, 1);
        const [cr, cg, cb] = lerp(CURVE_BOT, CURVE_TOP, t);
        setPx(x, y, cr, cg, cb, Math.round(255 * edge));
      }
    }
  }

  /* ---------- 5. Endpoint marker (white circle with brand-coloured core) ---------- */
  const ex = 870 * s, ey = 420 * s;
  const r1 = 46 * s, r2 = 22 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - ex, dy = y - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r1 * r1) {
        // Anti-alias the outer edge.
        const d = Math.sqrt(d2);
        const edge = clamp(r1 - d, 0, 1);
        if (d2 <= r2 * r2) {
          setPx(x, y, GRAD_TOP[0], GRAD_TOP[1], GRAD_TOP[2], 255);
        } else {
          setPx(x, y, 255, 255, 255, Math.round(255 * edge));
        }
      }
    }
  }

  return buf;
}

/* ------------------------------------------------------------------ */
/* PNG encoder (RGBA, 8-bit, no filter = filter type 0).               */
/* ------------------------------------------------------------------ */

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Raw scanlines: each row prefixed with a 0 filter byte.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const idatData = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const rgba = rasterise(size);
  const png = encodePNG(size, size, rgba);
  const name = size === 128 ? 'icon-128.png' : `icon-${size}.png`;
  writeFileSync(join(OUT_DIR, name), png);
  process.stdout.write(`wrote ${name} (${png.length} bytes)\n`);
}
