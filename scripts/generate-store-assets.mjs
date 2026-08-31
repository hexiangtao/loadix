/**
 * Generate Chrome Web Store marketing assets (zero dependencies).
 *
 * Produces:
 *   - store/promo-small-440x280.png       (required store listing thumbnail)
 *   - store/promo-marquee-1400x560.png    (recommended homepage feature)
 *   - store/screenshot-1-dashboard.png    1280x800
 *   - store/screenshot-2-metrics.png      1280x800
 *   - store/screenshot-3-request.png      1280x800
 *   - store/screenshot-4-load.png         1280x800
 *   - store/screenshot-5-tools.png        1280x800
 *
 * Run: `node scripts/generate-store-assets.mjs`
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const OUT = join(ROOT, 'store');

/* ------------------------------------------------------------------ */
/* Brand palette (mirrors app.css)                                     */
/* ------------------------------------------------------------------ */
const C = {
  bg:        [0xf5, 0xf5, 0xf7],
  panel:     [0xff, 0xff, 0xff],
  panelAlt:  [0xfb, 0xfb, 0xfc],
  line:      [0xe3, 0xe3, 0xe6],
  lineSoft:  [0xee, 0xee, 0xf0],
  hover:     [0xec, 0xec, 0xef],
  ink:       [0x1d, 0x1d, 0x1f],
  ink2:      [0x3a, 0x3a, 0x3c],
  muted:     [0x6e, 0x6e, 0x73],
  primary:   [0x00, 0x7a, 0xff],
  primary2:  [0x0a, 0x84, 0xff],
  primaryDk: [0x00, 0x60, 0xd6],
  success:   [0x1f, 0x8a, 0x44],
  successBg: [0xe6, 0xf4, 0xea],
  danger:    [0xff, 0x3b, 0x30],
  dangerBg:  [0xfd, 0xe7, 0xe6],
  warning:   [0xc2, 0x41, 0x0c],
  chartLine: [0x00, 0x7a, 0xff],
  chartFill: [0x00, 0x7a, 0xff],
  white:     [0xff, 0xff, 0xff],
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 4); // RGBA
  }
  setPx(x, y, r, g, b, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = 255;
    } else {
      const sa = a / 255, da = this.buf[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) return;
      this.buf[i]     = Math.round((r * sa + this.buf[i]     * da * (1 - sa)) / oa);
      this.buf[i + 1] = Math.round((g * sa + this.buf[i + 1] * da * (1 - sa)) / oa);
      this.buf[i + 2] = Math.round((b * sa + this.buf[i + 2] * da * (1 - sa)) / oa);
      this.buf[i + 3] = Math.round(oa * 255);
    }
  }
  /** Fill axis-aligned rect (inclusive-exclusive). */
  fillRect(x, y, w, h, rgb, a = 255) {
    const x1 = clamp(Math.round(x), 0, this.w);
    const y1 = clamp(Math.round(y), 0, this.h);
    const x2 = clamp(Math.round(x + w), 0, this.w);
    const y2 = clamp(Math.round(y + h), 0, this.h);
    for (let yy = y1; yy < y2; yy++)
      for (let xx = x1; xx < x2; xx++)
        this.setPx(xx, yy, rgb[0], rgb[1], rgb[2], a);
  }
  /** Round-rect outline filled. */
  fillRoundRect(x, y, w, h, rad, rgb, a = 255) {
    const x1 = Math.round(x), y1 = Math.round(y);
    const x2 = Math.round(x + w), y2 = Math.round(y + h);
    rad = Math.min(rad, (x2 - x1) / 2, (y2 - y1) / 2);
    for (let yy = Math.max(0, y1); yy < Math.min(this.h, y2); yy++) {
      for (let xx = Math.max(0, x1); xx < Math.min(this.w, x2); xx++) {
        const inL = xx - x1 < rad, inR = x2 - 1 - xx < rad;
        const inT = yy - y1 < rad, inB = y2 - 1 - yy < rad;
        let inside = true;
        if ((inL && inT) || (inR && inT) || (inL && inB) || (inR && inB)) {
          const cx = inL ? x1 + rad : x2 - rad;
          const cy = inT ? y1 + rad : y2 - rad;
          const dx = xx - cx + 0.5, dy = yy - cy + 0.5;
          if (dx * dx + dy * dy > rad * rad) inside = false;
        }
        if (inside) this.setPx(xx, yy, rgb[0], rgb[1], rgb[2], a);
      }
    }
  }
  /** Stroke round-rect. */
  strokeRoundRect(x, y, w, h, rad, t, rgb, a = 255) {
    // Draws as 4 thin round-rect fills: top, bottom, left, right bands.
    const x1 = Math.round(x), y1 = Math.round(y);
    const x2 = Math.round(x + w), y2 = Math.round(y + h);
    rad = Math.min(rad, (x2 - x1) / 2, (y2 - y1) / 2);
    const top    = { x: x1 + rad, y: y1,         w: x2 - x1 - 2 * rad, h: t };
    const bot    = { x: x1 + rad, y: y2 - t,     w: x2 - x1 - 2 * rad, h: t };
    const left   = { x: x1,         y: y1 + rad, w: t, h: y2 - y1 - 2 * rad };
    const right  = { x: x2 - t,     y: y1 + rad, w: t, h: y2 - y1 - 2 * rad };
    this.fillRect(top.x,   top.y,   top.w,   top.h,   rgb, a);
    this.fillRect(bot.x,   bot.y,   bot.w,   bot.h,   rgb, a);
    this.fillRect(left.x,  left.y,  left.w,  left.h,  rgb, a);
    this.fillRect(right.x, right.y, right.w, right.h, rgb, a);
    // Corners (filled quarter-discs).
    const corners = [
      [x1 + rad,       y1 + rad,       -1, -1],
      [x2 - rad - 1,   y1 + rad,        1, -1],
      [x1 + rad,       y2 - rad - 1,   -1,  1],
      [x2 - rad - 1,   y2 - rad - 1,    1,  1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      for (let yy = 0; yy < rad; yy++) {
        for (let xx = 0; xx < rad; xx++) {
          const dx = (xx - rad + 0.5) * sx, dy = (yy - rad + 0.5) * sy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= rad * rad) {
            const edgeT = clamp(rad - Math.sqrt(d2), 0, 1);
            const px = cx + xx * sx, py = cy + yy * sy;
            this.setPx(px, py, rgb[0], rgb[1], rgb[2], Math.round(a * edgeT));
          }
          // Thin stroke band at the edge of the corner.
          const inner = Math.max(0, rad - t);
          const id2 = (xx - inner + 0.5) * (xx - inner + 0.5) + (yy - inner + 0.5) * (yy - inner + 0.5);
          if (d2 > inner * inner && d2 <= rad * rad) {
            const px = cx + xx * sx, py = cy + yy * sy;
            this.setPx(px, py, rgb[0], rgb[1], rgb[2], Math.round(a * edgeT));
          }
        }
      }
    }
  }
  /** Filled circle. */
  fillCircle(cx, cy, r, rgb, a = 255) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++) {
        const d2 = xx * xx + yy * yy;
        if (d2 <= r * r) {
          const edge = clamp(r - Math.sqrt(d2) + 0.5, 0, 1);
          this.setPx(cx + xx, cy + yy, rgb[0], rgb[1], rgb[2], Math.round(a * edge));
        }
      }
  }
  /** Stroked line. */
  strokeLine(x1, y1, x2, y2, t, rgb, a = 255) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const px = x1 + dx * f, py = y1 + dy * f;
      this.fillCircle(px, py, t / 2, rgb, a);
    }
  }
  /** Polyline through points. */
  strokePolyline(points, t, rgb, a = 255) {
    for (let i = 0; i < points.length - 1; i++) {
      this.strokeLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], t, rgb, a);
    }
  }
  /** Filled polygon (simple fan triangulation from first point). */
  fillPolygon(points, rgb, a = 255) {
    if (points.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of points) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if ((yi > y) !== (yj > y) && yj !== yi) {
          xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length; i += 2) {
        const x1 = Math.max(0, Math.ceil(xs[i]));
        const x2 = Math.min(this.w - 1, Math.floor(xs[i + 1] ?? xs[i]));
        for (let x = x1; x <= x2; x++) this.setPx(x, y, rgb[0], rgb[1], rgb[2], a);
      }
    }
  }
  /** Approximated bitmap font for ASCII labels (5x7 per char). */
  text(x, y, str, rgb, size = 1, weight = 400) {
    const lines = String(str).split('\n');
    lines.forEach((line, li) => {
      let cx = Math.round(x);
      for (const ch of line) {
        const g = FONT[ch] || FONT['?'];
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 5; col++) {
            const on = (g[row] >> (4 - col)) & 1;
            if (!on) continue;
            if (weight >= 600) this.fillRect(cx + col * size, y + li * 9 * size + row * size, size, size, rgb);
            else this.setPx(cx + col * size + size / 2, y + li * 9 * size + row * size + size / 2, rgb[0], rgb[1], rgb[2], 220);
          }
        }
        cx += 6 * size;
      }
    });
  }
  /** Right- or centre-aligned text. */
  textAlign(x, y, str, rgb, size = 1, align = 'left', weight = 400) {
    const w = str.length * 6 * size - size;
    let x0 = x;
    if (align === 'right') x0 = x - w;
    if (align === 'center') x0 = x - w / 2;
    this.text(x0, y, str, rgb, size, weight);
  }
  /* Soft drop shadow for cards. */
  shadow(x, y, w, h, rad, blur = 12) {
    for (let yy = y - blur; yy < y + h + blur; yy++) {
      for (let xx = x - blur; xx < x + w + blur; xx++) {
        const insideX = clamp(xx, x, x + w - 1);
        const insideY = clamp(yy, y, y + h - 1);
        if (insideX === xx && insideY === yy) continue;
        const dx = insideX - xx, dy = insideY - yy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = clamp(1 - d / blur, 0, 1) * 30;
        this.setPx(xx, yy, 0, 0, 0, Math.round(a));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5x7 bitmap font (subset sufficient for UI labels).                  */
/* ------------------------------------------------------------------ */
const FONT = {
  ' ': [0,0,0,0,0,0,0],
  '!': [4,4,4,4,4,0,4],
  '"': [10,10,10,0,0,0,0],
  "'": [4,4,8,0,0,0,0],
  '(': [2,4,8,8,8,4,2],
  ')': [8,4,2,2,2,4,8],
  '+': [0,4,4,31,4,4,0],
  ',': [0,0,0,0,0,4,8],
  '-': [0,0,0,31,0,0,0],
  '.': [0,0,0,0,0,4,4],
  '/': [1,2,4,8,16,0,0],
  ':': [0,4,0,0,0,4,0],
  '0': [14,17,17,17,17,17,14],
  '1': [4,12,4,4,4,4,14],
  '2': [14,17,1,2,4,8,31],
  '3': [14,17,1,6,1,17,14],
  '4': [2,6,10,18,31,2,2],
  '5': [31,16,30,1,1,17,14],
  '6': [6,8,16,30,17,17,14],
  '7': [31,1,2,4,8,16,16],
  '8': [14,17,17,14,17,17,14],
  '9': [14,17,17,15,1,2,12],
  'A': [14,17,17,17,31,17,17],
  'B': [30,17,17,30,17,17,30],
  'C': [14,17,16,16,16,17,14],
  'D': [30,17,17,17,17,17,30],
  'E': [31,16,16,30,16,16,31],
  'F': [31,16,16,30,16,16,16],
  'G': [14,17,16,23,17,17,14],
  'H': [17,17,17,31,17,17,17],
  'I': [14,4,4,4,4,4,14],
  'J': [7,2,2,2,2,18,12],
  'K': [17,18,20,24,20,18,17],
  'L': [16,16,16,16,16,16,31],
  'M': [17,27,21,21,17,17,17],
  'N': [17,25,21,19,17,17,17],
  'O': [14,17,17,17,17,17,14],
  'P': [30,17,17,30,16,16,16],
  'Q': [14,17,17,17,21,18,13],
  'R': [30,17,17,30,20,18,17],
  'S': [14,17,16,14,1,17,14],
  'T': [31,4,4,4,4,4,4],
  'U': [17,17,17,17,17,17,14],
  'V': [17,17,17,17,17,10,4],
  'W': [17,17,17,21,21,21,10],
  'X': [17,17,10,4,10,17,17],
  'Y': [17,17,10,4,4,4,4],
  'Z': [31,1,2,4,8,16,31],
  'a': [0,0,14,1,15,17,15],
  'b': [16,16,30,17,17,17,30],
  'c': [0,0,14,16,16,17,14],
  'd': [1,1,15,17,17,17,15],
  'e': [0,0,14,17,31,16,14],
  'f': [6,9,8,28,8,8,8],
  'g': [0,15,17,17,15,1,14],
  'h': [16,16,30,17,17,17,17],
  'i': [4,0,12,4,4,4,14],
  'j': [2,0,6,2,2,18,12],
  'k': [16,16,18,20,24,20,18],
  'l': [12,4,4,4,4,4,14],
  'm': [0,0,26,21,21,17,17],
  'n': [0,0,30,17,17,17,17],
  'o': [0,0,14,17,17,17,14],
  'p': [0,0,30,17,17,30,16],
  'q': [0,0,15,17,17,15,1],
  'r': [0,0,22,25,16,16,16],
  's': [0,0,14,16,14,1,30],
  't': [8,8,28,8,8,9,6],
  'u': [0,0,17,17,17,17,15],
  'v': [0,0,17,17,17,10,4],
  'w': [0,0,17,17,21,21,10],
  'x': [0,0,17,10,4,10,17],
  'y': [0,0,17,17,15,1,14],
  'z': [0,0,31,2,4,8,31],
  '?': [14,17,1,2,4,0,4],
  '=': [0,0,31,0,31,0,0],
  '[': [14,8,8,8,8,8,14],
  ']': [14,2,2,2,2,2,14],
  '_': [0,0,0,0,0,0,31],
  '{': [6,8,8,16,8,8,6],
  '}': [12,2,2,1,2,2,12],
  '|': [4,4,4,0,4,4,4],
  '<': [2,4,8,16,8,4,2],
  '>': [8,4,2,1,2,4,8],
  '%': [18,19,2,4,8,25,1].map ? null : null, // unused
  '#': [10,10,31,10,31,10,10],
  '~': [0,0,9,21,18,0,0],
  '!': [4,4,4,4,4,0,4],
  '@': [14,17,21,21,16,17,14],
  ' ': [0,0,0,0,0,0,0],
};

/* ------------------------------------------------------------------ */
/* PNG encoder                                                          */
/* ------------------------------------------------------------------ */
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, c]);
}
function save(c, name) {
  const png = encodePNG(c.w, c.h, c.buf);
  const p = join(OUT, name);
  writeFileSync(p, png);
  process.stdout.write(`wrote ${name} (${png.length} bytes)\n`);
}

/* ------------------------------------------------------------------ */
/* Reusable UI fragments                                                */
/* ------------------------------------------------------------------ */

/** Draw the "Loadix" mark. */
function drawMark(c, cx, cy, size) {
  // size = full diameter
  const s = size / 1024;
  const x0 = cx - size / 2, y0 = cy - size / 2;
  // bg
  c.fillRoundRect(x0, y0, size, size, 224 * s, C.primary);
  c.fillRoundRect(x0, y0, size, size / 2, 224 * s, C.white, 16);
  // L stem
  c.fillRoundRect(x0 + 270 * s, y0 + 200 * s, 120 * s, 500 * s, 60 * s, C.white);
  // L base
  c.fillRoundRect(x0 + 270 * s, y0 + 640 * s, 420 * s, 120 * s, 60 * s, C.white);
  // curve
  const pts = [
    [305, 820], [410, 760], [500, 700], [580, 640],
    [660, 580], [760, 500], [870, 420],
  ].map(([x, y]) => [x0 + x * s, y0 + y * s]);
  c.strokePolyline(pts, 56 * s, C.white, 230);
  // endpoint
  c.fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 46 * s, C.white);
  c.fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 22 * s, C.primary);
}

function drawBrowserChrome(c, x, y, w, h) {
  // Outer shadow + body
  c.fillRoundRect(x, y, w, h, 16, C.white);
  c.fillRoundRect(x, y, w, 28, 16, C.panelAlt);
  c.fillRect(x, y + 14, w, 14, C.panelAlt);
  // traffic lights
  c.fillCircle(x + 18,  y + 14, 5, [0xff, 0x5f, 0x57]);
  c.fillCircle(x + 36,  y + 14, 5, [0xfe, 0xbc, 0x2e]);
  c.fillCircle(x + 54,  y + 14, 5, [0x28, 0xc8, 0x40]);
  // address bar
  c.fillRoundRect(x + 90, y + 6, w - 200, 16, 8, C.bg);
  c.fillRoundRect(x + 90, y + 6, w - 200, 16, 8, C.lineSoft, 80);
  c.fillRect(x + 90, y + 6, w - 200, 1, C.line);
  c.fillRect(x + 90, y + 21, w - 200, 1, C.line);
  c.text(x + 100, y + 9, 'chrome-extension://loadix/dashboard.html', C.muted, 1);
  // tab indicator
  c.fillRoundRect(x + w - 100, y + 6, 90, 16, 8, C.hover);
  c.text(x + w - 92, y + 9, 'Loadix', C.ink, 1, 'left', 600);
}

/** Sidebar with section list (active = highlighted). */
function drawSidebar(c, x, y, w, h, active) {
  c.fillRect(x, y, w, h, C.panel);
  c.fillRect(x + w - 1, y, 1, h, C.line);
  // Top brand
  drawMark(c, x + 30, y + 26, 28);
  c.text(x + 56, y + 22, 'Loadix', C.ink, 2, 'left', 700);
  // Tabs
  const tabs = ['Load Test', 'Tools'];
  let ty = y + 60;
  for (const t of tabs) {
    const isActive = t.toLowerCase() === (active.startsWith('load') ? 'load test' : 'tools');
    if (isActive) c.fillRoundRect(x + 10, ty, w - 20, 26, 6, C.hover);
    c.text(x + 24, ty + 9, t, C.ink, 1, 'left', t === 'Load Test' ? 700 : 400);
    ty += 32;
  }
  // Sections
  const sections = ['request', 'load', 'assertions', 'variables', 'history'];
  ty += 8;
  c.text(x + 24, ty, 'SECTIONS', C.muted, 1, 'left', 600);
  ty += 18;
  for (const s of sections) {
    const isActive = s === active;
    if (isActive) c.fillRoundRect(x + 10, ty, w - 20, 28, 6, C.primary);
    c.fillCircle(x + 24, ty + 14, 3, isActive ? C.white : C.muted);
    c.text(x + 36, ty + 11,
      s.charAt(0).toUpperCase() + s.slice(1),
      isActive ? C.white : C.ink, 1, 'left', 500);
    ty += 34;
  }
  // Footer status
  c.fillRect(x, y + h - 1, w, 1, C.line);
  c.fillCircle(x + 24, y + h - 20, 4, C.success);
  c.text(x + 36, y + h - 24, 'Engine idle', C.muted, 1);
}

function drawField(c, x, y, w, h, label, value, opts = {}) {
  c.text(x, y - 6, label, C.muted, 1, 'left', 600);
  c.fillRoundRect(x, y, w, h, 6, C.panel);
  c.fillRoundRect(x, y, w, h, 6, C.line, 0);   // border (no alpha)
  c.fillRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 6, C.line, 255);
  if (opts.primary) {
    c.fillRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 6, C.primary, 0);
  }
  c.text(x + 10, y + Math.round(h / 2) - 3, value, C.ink, 1, 'left', 400);
  if (opts.suffix) {
    c.textAlign(x + w - 10, y + Math.round(h / 2) - 3, opts.suffix, C.muted, 1, 'right');
  }
}

function drawButton(c, x, y, w, h, label, kind = 'primary') {
  const bg = kind === 'primary' ? C.primary
           : kind === 'ghost'   ? C.panel
           : kind === 'danger'  ? C.dangerBg
           : C.panel;
  c.fillRoundRect(x, y, w, h, 8, bg);
  if (kind !== 'primary' && kind !== 'danger') {
    c.fillRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8, C.line, 255);
  }
  const fg = kind === 'primary' ? C.white
           : kind === 'danger'  ? C.danger
           : C.ink;
  c.textAlign(x + w / 2, y + Math.round(h / 2) - 3, label, fg, 1, 'center', 600);
}

function drawMetricCard(c, x, y, w, h, label, value, trend) {
  c.fillRoundRect(x, y, w, h, 8, C.panel);
  c.fillRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8, C.line, 255);
  c.text(x + 12, y + 12, label.toUpperCase(), C.muted, 1, 'left', 600);
  c.text(x + 12, y + 30, value, C.ink, 2, 'left', 700);
  if (trend) c.textAlign(x + w - 12, y + 12, trend, C.success, 1, 'right', 600);
}

/* ------------------------------------------------------------------ */
/* 1. Small promo tile — 440 x 280                                      */
/* ------------------------------------------------------------------ */
function smallPromo() {
  const c = new Canvas(440, 280);
  // Background gradient (top→bottom).
  for (let y = 0; y < c.h; y++) {
    const t = y / c.h;
    const rgb = lerp([0xf5, 0xf7, 0xfc], [0xe9, 0xef, 0xfb], t);
    c.fillRect(0, y, c.w, 1, rgb);
  }
  // Decorative dotted grid
  for (let y = 0; y < c.h; y += 8)
    for (let x = 0; x < c.w; x += 8)
      c.setPx(x, y, 0x00, 0x7a, 0xff, 14);
  // Big mark
  drawMark(c, 90, 140, 120);
  // Right text
  c.text(180, 80,  'Loadix', C.ink, 4, 'left', 700);
  c.text(180, 120, 'API Load Testing', C.ink2, 2, 'left', 600);
  c.text(180, 142, 'in your browser', C.ink2, 2, 'left', 600);
  // tag pills
  c.fillRoundRect(180, 168, 90, 22, 11, C.primary, 30);
  c.text(190, 173, '18 tools', C.primary, 1, 'left', 600);
  c.fillRoundRect(280, 168, 130, 22, 11, C.success, 30);
  c.text(290, 173, 'No tracking', C.success, 1, 'left', 600);
  c.text(180, 200, 'Local HTTP load tester + dev toolkit', C.muted, 1, 'left', 400);
  c.text(180, 214, 'Run from the background worker.', C.muted, 1, 'left', 400);
  c.text(180, 228, 'Your data never leaves the browser.', C.muted, 1, 'left', 400);
  // CTA pill
  c.fillRoundRect(180, 246, 90, 22, 11, C.primary);
  c.textAlign(225, 251, 'Add to Chrome', C.white, 1, 'center', 600);
  save(c, 'promo-small-440x280.png');
}

/* ------------------------------------------------------------------ */
/* 2. Marquee promo tile — 1400 x 560                                   */
/* ------------------------------------------------------------------ */
function marqueePromo() {
  const c = new Canvas(1400, 560);
  // Background — vertical brand gradient
  for (let y = 0; y < c.h; y++) {
    const t = y / c.h;
    const rgb = lerp([0x0a, 0x40, 0xc0], [0x05, 0x20, 0x80], t);
    c.fillRect(0, y, c.w, 1, rgb);
  }
  // Subtle highlight
  c.fillRect(0, 0, c.w, 280, [0xff, 0xff, 0xff], 18);
  // Dot grid overlay
  for (let y = 0; y < c.h; y += 12)
    for (let x = 0; x < c.w; x += 12)
      c.setPx(x, y, 0xff, 0xff, 0xff, 12);
  // Large mark
  drawMark(c, 220, 280, 280);
  // Headline
  c.text(440, 130, 'Loadix', C.white, 8, 'left', 800);
  c.text(440, 230, 'API load testing', C.white, 4, 'left', 700);
  c.text(440, 280, '& a 18-tool developer workbench', C.white, 3, 'left', 500);
  // Feature pills
  const pills = [
    ['Concurrent VUs + RPS',  C.primary],
    ['P50 / P95 / P99',       C.success],
    ['Status / latency / body assertions', C.warning],
    ['JWT, Base64, JSON, ...', C.primary2],
    ['Runs in service worker', C.success],
    ['No account. No tracking.', C.danger],
  ];
  let px = 440, py = 330;
  for (const [txt, col] of pills) {
    const w = txt.length * 7 + 24;
    if (px + w > 1340) { px = 440; py += 38; }
    c.fillRoundRect(px, py, w, 28, 14, col, 50);
    c.fillRoundRect(px + 0.5, py + 0.5, w - 1, 27, 14, [0xff, 0xff, 0xff], 0);
    c.text(px + 12, py + 10, txt, C.white, 1, 'left', 600);
    px += w + 12;
  }
  // CTA
  c.fillRoundRect(440, 450, 200, 48, 24, C.white);
  c.textAlign(540, 466, 'Add to Chrome — Free', C.primary, 2, 'center', 700);
  c.text(660, 466, 'Works offline once installed', C.white, 2, 'left', 500);
  // Footer line
  c.text(440, 522, 'loadix.dev  ·  MIT licensed  ·  open source on GitHub', C.white, 1, 'left', 400);
  save(c, 'promo-marquee-1400x560.png');
}

/* ------------------------------------------------------------------ */
/* Screenshots — 1280 x 800 each, with browser chrome + sidebar         */
/* ------------------------------------------------------------------ */
function screenshotBase(title, section) {
  const c = new Canvas(1280, 800);
  // Window background
  c.fillRect(0, 0, c.w, c.h, C.bg);
  // Browser chrome
  drawBrowserChrome(c, 20, 20, 1240, 760);
  // Sidebar
  drawSidebar(c, 20, 48, 200, 732, section);
  return c;
}

function drawChart(c, x, y, w, h, points) {
  c.fillRoundRect(x, y, w, h, 8, C.panel);
  c.fillRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8, C.line, 255);
  // grid lines
  for (let i = 1; i < 4; i++) {
    c.fillRect(x + 12, y + (h - 20) * i / 4 + 8, w - 24, 1, C.lineSoft);
  }
  // area
  const min = 0, max = 100;
  const px = (i) => x + 16 + (w - 32) * i / (points.length - 1);
  const py = (v) => y + h - 14 - (h - 28) * (v - min) / (max - min);
  const area = [[x + 16, y + h - 14]];
  for (let i = 0; i < points.length; i++) area.push([px(i), py(points[i])]);
  area.push([x + w - 16, y + h - 14]);
  c.fillPolygon(area, [0x00, 0x7a, 0xff], 38);
  // line
  const lp = points.map((v, i) => [px(i), py(v)]);
  c.strokePolyline(lp, 2.5, C.chartLine, 255);
  // last dot
  c.fillCircle(lp[lp.length - 1][0], lp[lp.length - 1][1], 3.5, C.primary);
  // title
  c.text(x + 12, y + 10, 'RPS / SEC', C.muted, 1, 'left', 600);
  c.textAlign(x + w - 12, y + 10, 'live', C.success, 1, 'right', 600);
}

/* Screenshot 1 — Dashboard hero (request panel) */
function screenshot1() {
  const c = screenshotBase('Dashboard', 'request');
  const lx = 240, ly = 70, lw = 1000, lh = 700;
  // Heading
  c.text(lx, ly + 14, 'Request', C.ink, 3, 'left', 700);
  c.text(lx + 110, ly + 22, 'Configure the target endpoint, method, headers and body.', C.muted, 1);
  // Method dropdown + URL field
  drawField(c, lx, ly + 60, 130, 36, 'METHOD', 'GET');
  drawField(c, lx + 145, ly + 60, lw - 145, 36, 'URL', 'https://api.example.com/v1/users');
  // Headers
  c.text(lx, ly + 120, 'Headers', C.ink, 2, 'left', 700);
  c.text(lx, ly + 142, 'Per-request headers, sent as-is. {{variables}} are interpolated.', C.muted, 1);
  c.fillRoundRect(lx, ly + 160, lw, 110, 8, C.panel);
  c.fillRoundRect(lx + 0.5, ly + 160.5, lw - 1, 109, 8, C.line, 255);
  const headerRows = [
    ['Accept', 'application/json'],
    ['Authorization', 'Bearer eyJhbGciOi...{{token}}'],
    ['X-Request-Id', '{{uuid}}'],
  ];
  let hy = ly + 170;
  for (const [k, v] of headerRows) {
    c.fillRoundRect(lx + 12, hy, 200, 28, 6, C.bg);
    c.fillRoundRect(lx + 12.5, hy + 0.5, 199, 27, 6, C.line, 255);
    c.text(lx + 22, hy + 10, k, C.ink, 1, 'left', 500);
    c.fillRoundRect(lx + 220, hy, lw - 232, 28, 6, C.panel);
    c.fillRoundRect(lx + 220.5, hy + 0.5, lw - 233, 27, 6, C.line, 255);
    c.text(lx + 230, hy + 10, v, C.ink, 1);
    hy += 32;
  }
  // Body
  c.text(lx, ly + 290, 'Body', C.ink, 2, 'left', 700);
  c.text(lx + 60, ly + 298, 'application/json', C.muted, 1);
  c.fillRoundRect(lx, ly + 310, lw, 200, 8, C.panel);
  c.fillRoundRect(lx + 0.5, ly + 310.5, lw - 1, 199, 8, C.line, 255);
  // JSON snippet
  const json = [
    '{',
    '  "userId": "{{userId}}",',
    '  "page": 1,',
    '  "limit": 20,',
    '  "filter": { "active": true }',
    '}',
  ];
  let jy = ly + 322;
  for (const line of json) {
    c.text(lx + 16, jy, line, C.ink, 1, 'left', 500);
    jy += 14;
  }
  // Right column: presets + run
  const rx = lx + lw - 220, ry = ly + 60;
  c.fillRoundRect(rx, ry, 200, 130, 10, C.panel);
  c.fillRoundRect(rx + 0.5, ry + 0.5, 199, 129, 10, C.line, 255);
  c.text(rx + 14, ry + 14, 'PRESET', C.muted, 1, 'left', 600);
  ['Smoke', 'Normal', 'Stress', 'Spike'].forEach((p, i) => {
    const y = ry + 34 + i * 22;
    const active = p === 'Normal';
    if (active) c.fillRoundRect(rx + 10, y, 180, 18, 4, C.primary);
    c.text(rx + 20, y + 5, p, active ? C.white : C.ink, 1, 'left', active ? 700 : 400);
  });
  // Run button (large)
  drawButton(c, rx, ry + 180, 200, 44, 'Start Load Test', 'primary');
  c.textAlign(rx + 100, ry + 240, 'Tab close? Test keeps running.', C.muted, 1, 'center');
  save(c, 'screenshot-1-dashboard.png');
}

/* Screenshot 2 — Live metrics & chart */
function screenshot2() {
  const c = screenshotBase('Live metrics', 'load');
  const lx = 240, ly = 70, lw = 1000;
  // Header
  c.text(lx, ly + 14, 'Live Metrics', C.ink, 3, 'left', 700);
  // Engine state pill
  c.fillRoundRect(lx + 200, ly + 6, 80, 24, 12, C.success, 30);
  c.fillRoundRect(lx + 200.5, ly + 6.5, 79, 23, 12, [0xff, 0xff, 0xff], 0);
  c.fillCircle(lx + 212, ly + 18, 4, C.success);
  c.text(lx + 222, ly + 12, 'RUNNING', C.success, 1, 'left', 700);
  // Stop button
  drawButton(c, lx + lw - 100, ly + 4, 100, 30, 'Stop', 'danger');
  // Metric cards 2 rows × 5
  const metrics = [
    ['Requests', '12,481', '+24/s'],
    ['Success', '12,398', '99.4%'],
    ['Errors', '83', '0.6%'],
    ['RPS', '127.4', ''],
    ['Avg', '186', 'ms'],
    ['P50', '142', 'ms'],
    ['P90', '298', 'ms'],
    ['P95', '402', 'ms'],
    ['P99', '688', 'ms'],
    ['Max', '1,204', 'ms'],
  ];
  const cardW = (lw - 9 * 12) / 10, cardH = 70;
  let cx = lx;
  for (let i = 0; i < metrics.length; i++) {
    if (i === 5) { cx = lx; }
    const y = i < 5 ? ly + 60 : ly + 60 + cardH + 12;
    drawMetricCard(c, cx, y, cardW, cardH, metrics[i][0], metrics[i][1], metrics[i][2]);
    cx += cardW + 12;
  }
  // Chart
  const chy = ly + 60 + 2 * cardH + 30;
  const series = [12, 18, 24, 32, 41, 55, 60, 58, 64, 72, 80, 85, 78, 82, 90, 95, 100, 96, 88, 84];
  drawChart(c, lx, chy, lw / 2 - 6, 200, series);
  // Latency chart
  const lat = [10, 12, 14, 13, 16, 18, 20, 22, 21, 25, 28, 30, 32, 30, 28, 26, 27, 25, 24, 22];
  const lat2 = lat.map(v => v * 4 + 10); // P95 above P50
  const lx2 = lx + lw / 2 + 6;
  c.fillRoundRect(lx2, chy, lw / 2 - 6, 200, 8, C.panel);
  c.fillRoundRect(lx2 + 0.5, chy + 0.5, lw / 2 - 13, 199, 8, C.line, 255);
  c.text(lx2 + 12, chy + 10, 'LATENCY  P50 / P95', C.muted, 1, 'left', 600);
  // axis
  for (let i = 1; i < 4; i++) c.fillRect(lx2 + 12, chy + (200 - 20) * i / 4 + 8, lw / 2 - 24, 1, C.lineSoft);
  const min = 0, max = 200;
  const w = lw / 2 - 24, h = 200;
  const xp = (i) => lx2 + 16 + w * i / (lat.length - 1);
  const yp = (v) => chy + h - 14 - (h - 28) * (v - min) / (max - min);
  c.strokePolyline(lat.map((v, i) => [xp(i), yp(v)]), 2, C.success, 255);
  c.strokePolyline(lat2.map((v, i) => [xp(i), yp(v)]), 2, C.warning, 255);
  c.fillCircle(xp(0),  yp(lat[0]),  3, C.success);
  c.fillCircle(xp(0),  yp(lat2[0]), 3, C.warning);
  c.text(lx2 + 12, chy + h - 18, 'P50', C.success, 1, 'left', 600);
  c.text(lx2 + 50, chy + h - 18, 'P95', C.warning, 1, 'left', 600);

  // Status breakdown strip
  const sby = chy + 220;
  c.fillRoundRect(lx, sby, lw, 110, 10, C.panel);
  c.fillRoundRect(lx + 0.5, sby + 0.5, lw - 1, 109, 10, C.line, 255);
  c.text(lx + 16, sby + 14, 'STATUS BREAKDOWN', C.muted, 1, 'left', 600);
  // bar
  const total = 12481;
  const segs = [
    [200, total * 0.992, C.success],
    [404, total * 0.004, C.warning],
    [500, total * 0.004, C.danger],
  ];
  let bx = lx + 16;
  const barW = lw - 32;
  for (const [code, n, col] of segs) {
    const w = barW * (n / total);
    c.fillRect(bx, sby + 40, w, 18, col);
    bx += w;
  }
  c.text(lx + 16, sby + 70, '200  12,398  (99.4%)', C.success, 1, 'left', 600);
  c.text(lx + 200, sby + 70, '404  47  (0.4%)', C.warning, 1, 'left', 600);
  c.text(lx + 360, sby + 70, '500  36  (0.3%)', C.danger, 1, 'left', 600);
  c.text(lx + 520, sby + 70, 'Asserts  failed: 0 / 3', C.muted, 1, 'left', 600);
  save(c, 'screenshot-2-metrics.png');
}

/* Screenshot 3 — Request panel (closer view) */
function screenshot3() {
  const c = screenshotBase('Request', 'request');
  const lx = 240, ly = 70, lw = 1000;
  c.text(lx, ly + 14, 'Request', C.ink, 3, 'left', 700);
  c.text(lx + 110, ly + 22, 'Configure the target endpoint, method, headers and body.', C.muted, 1);
  // Two columns
  drawField(c, lx, ly + 60, 200, 36, 'METHOD', 'POST');
  drawField(c, lx + 220, ly + 60, 580, 36, 'URL', 'https://httpbin.org/post');
  drawField(c, lx + 820, ly + 60, 180, 36, 'TIMEOUT', '10', { suffix: 's' });
  // Headers
  c.text(lx, ly + 120, 'Headers', C.ink, 2, 'left', 700);
  c.text(lx + 100, ly + 128, 'Pair editor with {{var}} interpolation', C.muted, 1);
  c.fillRoundRect(lx, ly + 140, lw, 200, 10, C.panel);
  c.fillRoundRect(lx + 0.5, ly + 140.5, lw - 1, 199, 10, C.line, 255);
  const rows = [
    ['Content-Type', 'application/json', true],
    ['Authorization', 'Bearer {{token}}', false],
    ['X-Trace-Id', '{{uuid}}', false],
    ['Accept-Language', 'en-US,en;q=0.9', false],
    ['User-Agent', 'Loadix/1.23', false],
  ];
  let hy = ly + 154;
  for (const [k, v, primary] of rows) {
    c.fillRoundRect(lx + 16, hy, 220, 28, 6, C.bg);
    c.fillRoundRect(lx + 16.5, hy + 0.5, 219, 27, 6, C.line, 255);
    c.text(lx + 26, hy + 10, k, C.ink, 1, 'left', 500);
    c.fillRoundRect(lx + 244, hy, lw - 260, 28, 6, primary ? C.primary : C.panel, primary ? 30 : 255);
    c.fillRoundRect(lx + 244.5, hy + 0.5, lw - 261, 27, 6, C.line, 255);
    c.text(lx + 254, hy + 10, v, primary ? C.primary : C.ink, 1, 'left', primary ? 600 : 400);
    hy += 32;
  }
  // Body
  c.text(lx, ly + 360, 'Body', C.ink, 2, 'left', 700);
  c.text(lx + 60, ly + 368, 'Content-Type: application/json', C.muted, 1);
  c.fillRoundRect(lx, ly + 380, lw, 240, 10, C.panel);
  c.fillRoundRect(lx + 0.5, ly + 380.5, lw - 1, 239, 10, C.line, 255);
  const json = [
    '{',
    '  "userId": "{{userId}}",',
    '  "action": "load-test",',
    '  "tags": ["api", "v1"],',
    '  "metadata": {',
    '    "trace": "{{uuid}}",',
    '    "issuedAt": "{{now}}",',
    '    "client": "loadix/1.23"',
    '  }',
    '}',
  ];
  let jy = ly + 394;
  for (const line of json) {
    c.text(lx + 18, jy, line, C.ink, 1);
    jy += 16;
  }
  // Run button
  drawButton(c, lx, ly + 640, 180, 40, 'Run', 'primary');
  drawButton(c, lx + 200, ly + 640, 140, 40, 'Save preset', 'ghost');
  drawButton(c, lx + 360, ly + 640, 140, 40, 'Reset', 'ghost');
  save(c, 'screenshot-3-request.png');
}

/* Screenshot 4 — Load panel (VU / RPS / duration) */
function screenshot4() {
  const c = screenshotBase('Load', 'load');
  const lx = 240, ly = 70, lw = 1000;
  c.text(lx, ly + 14, 'Load', C.ink, 3, 'left', 700);
  c.text(lx + 70, ly + 22, 'Pick a model, set pacing, and a duration.', C.muted, 1);
  // Model selector
  const models = ['Constant', 'Ramp', 'Step', 'Spike'];
  let mx = lx;
  for (const m of models) {
    const active = m === 'Ramp';
    c.fillRoundRect(mx, ly + 60, 160, 40, 8, active ? C.primary : C.panel);
    if (!active) c.fillRoundRect(mx + 0.5, ly + 60.5, 159, 39, 8, C.line, 255);
    c.textAlign(mx + 80, ly + 75, m, active ? C.white : C.ink, 1, 'center', 600);
    mx += 172;
  }
  // Inputs
  drawField(c, lx,       ly + 130, 240, 44, 'USERS',     '20',  { suffix: 'VU' });
  drawField(c, lx + 260, ly + 130, 240, 44, 'TARGET RPS', '50',  { suffix: 'req/s' });
  drawField(c, lx + 520, ly + 130, 240, 44, 'DURATION',   '60',  { suffix: 's' });
  drawField(c, lx + 780, ly + 130, 200, 44, 'RAMP-UP',    '10',  { suffix: 's' });
  // Ramp curve preview
  const px0 = lx, py0 = ly + 210, pw = 600, ph = 280;
  c.fillRoundRect(px0, py0, pw, ph, 10, C.panel);
  c.fillRoundRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1, 10, C.line, 255);
  c.text(px0 + 16, py0 + 16, 'RAMP CURVE  (0s → 60s,  0 → 20 VU, target 50 RPS)', C.muted, 1, 'left', 600);
  for (let i = 1; i < 4; i++) c.fillRect(px0 + 16, py0 + (ph - 40) * i / 4 + 20, pw - 32, 1, C.lineSoft);
  // ramp line: 0 → 20 VU over 10s, hold
  const rampPts = [];
  for (let s = 0; s <= 60; s += 2) {
    const v = Math.min(20, (s / 10) * 20);
    rampPts.push([px0 + 24 + (pw - 48) * s / 60, py0 + ph - 24 - (ph - 60) * v / 20]);
  }
  // area
  const area = [[px0 + 24, py0 + ph - 24], ...rampPts, [px0 + pw - 24, py0 + ph - 24]];
  c.fillPolygon(area, [0x00, 0x7a, 0xff], 40);
  c.strokePolyline(rampPts, 2.5, C.primary, 255);
  // axis labels
  c.text(px0 + 16, py0 + ph - 14, '0s', C.muted, 1);
  c.text(px0 + pw - 28, py0 + ph - 14, '60s', C.muted, 1);
  c.text(px0 + 16, py0 + 32, '20 VU', C.muted, 1);
  // Right column: assertions + run
  const rx = lx + pw + 20, ry = py0;
  c.fillRoundRect(rx, ry, lw - pw - 20, 280, 10, C.panel);
  c.fillRoundRect(rx + 0.5, ry + 0.5, lw - pw - 21, 279, 10, C.line, 255);
  c.text(rx + 16, ry + 16, 'ASSERTIONS', C.muted, 1, 'left', 600);
  const ass = [
    ['Status',  '= 200',          true],
    ['Latency', '<= 1000 ms',     true],
    ['Body',    'contains "ok"',  true],
  ];
  let ay = ry + 42;
  for (const [k, v, on] of ass) {
    c.fillRoundRect(rx + 16, ay, 18, 18, 4, on ? C.success : C.line);
    c.text(rx + 22, ay + 4, '✓', C.white, 1, 'left', 700);
    c.text(rx + 44, ay + 4, k, C.ink, 1, 'left', 600);
    c.text(rx + 130, ay + 4, v, C.muted, 1, 'left');
    ay += 28;
  }
  // Stop-on-fail toggle
  c.fillRoundRect(rx + 16, ay + 10, 32, 18, 9, C.primary);
  c.fillCircle(rx + 38, ay + 19, 7, C.white);
  c.text(rx + 60, ay + 14, 'Stop on first failure', C.ink, 1, 'left', 500);
  // Run
  drawButton(c, rx, ry + 320, lw - pw - 20, 48, 'Start Load Test', 'primary');
  c.textAlign(rx + (lw - pw - 20) / 2, ry + 384, 'Background service worker', C.muted, 1, 'center');
  c.textAlign(rx + (lw - pw - 20) / 2, ry + 398, 'Survives tab close', C.muted, 1, 'center');
  save(c, 'screenshot-4-load.png');
}

/* Screenshot 5 — Tools (JWT, Base64, JSON) */
function screenshot5() {
  const c = screenshotBase('Tools', 'tools');
  const lx = 240, ly = 70, lw = 1000, lh = 700;
  // Heading
  c.text(lx, ly + 14, 'Developer Tools', C.ink, 3, 'left', 700);
  c.text(lx + 220, ly + 22, '⌘K to search', C.muted, 1);
  // Left column: tool list
  const tlx = lx, tly = ly + 60, tlw = 220, tlh = 600;
  c.fillRoundRect(tlx, tly, tlw, tlh, 10, C.panel);
  c.fillRoundRect(tlx + 0.5, tly + 0.5, tlw - 1, tlh - 1, 10, C.line, 255);
  c.text(tlx + 14, tly + 16, 'TOOLS', C.muted, 1, 'left', 600);
  const tools = [
    ['Base64',         false],
    ['URL Encode',     false],
    ['JWT',            true],
    ['Hash',           false],
    ['JSON Formatter', false],
    ['Regex Tester',   false],
    ['UUID Generator', false],
    ['Timestamp',      false],
    ['Cron Parser',    false],
    ['Color Picker',   false],
    ['JSONPath',       false],
    ['Base Converter', false],
    ['HTML Entities',  false],
    ['Markdown',       false],
    ['Diff Checker',   false],
  ];
  let ty = tly + 38;
  for (const [name, active] of tools) {
    if (active) c.fillRoundRect(tlx + 8, ty, tlw - 16, 26, 6, C.primary);
    c.fillCircle(tlx + 22, ty + 13, 3, active ? C.white : C.muted);
    c.text(tlx + 36, ty + 10, name, active ? C.white : C.ink, 1, 'left', active ? 700 : 500);
    ty += 32;
  }
  // Right area: JWT tool
  const trx = tlx + tlw + 20, try_ = tly, trw = lw - tlw - 20, trh = tlh;
  c.fillRoundRect(trx, try_, trw, trh, 10, C.panel);
  c.fillRoundRect(trx + 0.5, try_ + 0.5, trw - 1, trh - 1, 10, C.line, 255);
  c.text(trx + 16, try_ + 16, 'JWT  ·  Decode & verify', C.ink, 2, 'left', 700);
  c.text(trx + 16, try_ + 38, 'Paste a JWT to inspect header, payload, and signature.', C.muted, 1);
  // Input
  c.fillRoundRect(trx + 16, try_ + 60, trw - 32, 80, 8, C.bg);
  c.fillRoundRect(trx + 16.5, try_ + 60.5, trw - 33, 79, 8, C.line, 255);
  const jwt = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
    'eyJzdWIiOiJ1c2VyXzEyMyIsIm5hbWUiOiJBbGljZSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.',
    '4f7d8b9a2c1e0d5b6a8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f',
  ];
  let jy = try_ + 76;
  for (const line of jwt) c.text(trx + 26, jy, line, C.ink, 1); jy += 14;
  // Header card
  const hy = try_ + 160;
  c.fillRoundRect(trx + 16, hy, trw - 32, 80, 8, C.panelAlt);
  c.fillRoundRect(trx + 16.5, hy + 0.5, trw - 33, 79, 8, C.line, 255);
  c.text(trx + 28, hy + 14, 'HEADER', C.muted, 1, 'left', 600);
  c.text(trx + 28, hy + 30, 'alg   HS256', C.ink, 1, 'left', 500);
  c.text(trx + 28, hy + 46, 'typ   JWT', C.ink, 1, 'left', 500);
  // Payload card
  c.fillRoundRect(trx + 16, hy + 100, trw - 32, 200, 8, C.panelAlt);
  c.fillRoundRect(trx + 16.5, hy + 100.5, trw - 33, 199, 8, C.line, 255);
  c.text(trx + 28, hy + 114, 'PAYLOAD', C.muted, 1, 'left', 600);
  const payload = [
    'sub     user_123',
    'name    Alice',
    'iat     1700000000',
    'exp     1700003600',
  ];
  let py = hy + 132;
  for (const line of payload) { c.text(trx + 28, py, line, C.ink, 1, 'left', 500); py += 18; }
  // Signature pill
  c.fillRoundRect(trx + 16, hy + 320, trw - 32, 44, 8, C.successBg);
  c.fillRoundRect(trx + 16.5, hy + 320.5, trw - 33, 43, 8, C.success, 60);
  c.fillCircle(trx + 36, hy + 342, 8, C.success);
  c.text(trx + 36, hy + 338, '✓', C.white, 1, 'left', 700);
  c.text(trx + 52, hy + 328, 'Signature verified', C.success, 1, 'left', 700);
  c.text(trx + 52, hy + 344, 'HS256 · key matches', C.success, 1, 'left', 500);
  // History strip
  c.fillRoundRect(trx + 16, hy + 380, trw - 32, 80, 8, C.panel);
  c.fillRoundRect(trx + 16.5, hy + 380.5, trw - 33, 79, 8, C.line, 255);
  c.text(trx + 28, hy + 394, 'HISTORY', C.muted, 1, 'left', 600);
  c.text(trx + 28, hy + 412, '3 decoded tokens · click to restore', C.muted, 1);
  save(c, 'screenshot-5-tools.png');
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
mkdirSync(OUT, { recursive: true });
smallPromo();
marqueePromo();
screenshot1();
screenshot2();
screenshot3();
screenshot4();
screenshot5();
