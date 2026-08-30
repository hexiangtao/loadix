import { useEffect, useRef } from 'react';

interface LineChartProps {
  values: number[];
  color?: string;
  /** Optional unit suffix shown on the Y-axis labels (e.g. " ms"). */
  unit?: string;
}

/** Compact number formatter: 1200 -> "1.2k", 1.5e6 -> "1.5M". */
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

/** Lightweight canvas line chart (no third-party dependency). */
export function LineChart({ values, color, unit = '' }: LineChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // Measure the parent element instead of the canvas itself, to avoid a
    // feedback loop where the canvas' own width attribute inflates clientWidth.
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const W = parent?.clientWidth ?? canvas.clientWidth;
    const H = parent?.clientHeight ?? canvas.clientHeight;
    if (W <= 0 || H <= 0) return;

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Read theme colors from CSS variables so the chart follows light/dark.
    const styles = getComputedStyle(document.documentElement);
    const gridColor = styles.getPropertyValue('--color-line').trim() || '#e5e5e5';
    const lineColor = color || styles.getPropertyValue('--color-primary').trim() || '#16a34a';
    const labelColor = styles.getPropertyValue('--color-muted').trim() || '#6b6b6b';

    // Layout: leave room on the left for Y labels and bottom for X labels.
    const padL = 40;
    const padR = 6;
    const padT = 6;
    const padB = 18;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    if (plotW <= 0 || plotH <= 0) return;

    const max = values.length ? Math.max(1, ...values) : 1;
    // Round the axis max up to a "nice" value so the top label is clean.
    const niceMax = niceCeil(max);

    const xFor = (i: number) =>
      values.length === 1 ? padL : padL + (i * plotW) / (values.length - 1);
    const yFor = (v: number) => padT + plotH - (v / niceMax) * plotH;

    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Horizontal gridlines + Y-axis labels (4 divisions).
    const divisions = 4;
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = labelColor;
    for (let i = 0; i <= divisions; i++) {
      const v = (niceMax * i) / divisions;
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmt(v) + unit, padL - 6, y);
    }

    // X-axis labels (first / middle / last index).
    ctx.textAlign = 'center';
    ctx.fillText('0', padL, H - 7);
    if (values.length > 1) {
      ctx.fillText(String(Math.floor(values.length / 2)), xFor(Math.floor(values.length / 2)), H - 7);
      ctx.fillText(String(values.length - 1), xFor(values.length - 1), H - 7);
    }

    if (!values.length) {
      ctx.textAlign = 'center';
      ctx.fillText('—', W / 2, H / 2);
      return;
    }

    // Line.
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Latest value dot + label.
    const lastX = xFor(values.length - 1);
    const lastY = yFor(values[values.length - 1] ?? 0);
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [values, color, unit]);

  return <canvas ref={ref} className="block h-full w-full" />;
}

/** Round a value up to the nearest "nice" number (1/2/5 × 10^n). */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}
