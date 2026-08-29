import { useEffect, useRef } from 'react';

interface LineChartProps {
  values: number[];
  color?: string;
}

/** Lightweight canvas line chart (no third-party dependency). */
export function LineChart({ values, color = '#635bff' }: LineChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = '#dfe3eb';
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const y = (i * H) / 5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    if (!values.length) return;
    const max = Math.max(1, ...values);
    ctx.strokeStyle = color;
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

  return <canvas ref={ref} className="h-full w-full flex-1" />;
}
