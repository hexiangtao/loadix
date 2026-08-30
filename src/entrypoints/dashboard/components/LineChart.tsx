import { useEffect, useRef } from 'react';

interface LineChartProps {
  values: number[];
  color?: string;
}

/** Lightweight canvas line chart (no third-party dependency). */
export function LineChart({ values, color }: LineChartProps) {
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

    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const y = (i * H) / 5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    if (!values.length) return;
    const max = Math.max(1, ...values);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = values.length === 1 ? 0 : (i * (W - 8)) / (values.length - 1) + 4;
      const y = H - 8 - (v / max) * (H - 20);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [values, color]);

  return <canvas ref={ref} className="block h-full w-full" />;
}
