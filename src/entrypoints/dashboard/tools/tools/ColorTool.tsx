import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Format = 'hex' | 'rgb' | 'hsl';

interface ColorToolProps {
  initialPayload?: string;
}

function isHex(s: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(s);
}

function isRgb(s: string): boolean {
  return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padStart(6, '0');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clamp(n, 0, 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(conv(h + 1 / 3) * 255), Math.round(conv(h) * 255), Math.round(conv(h - 1 / 3) * 255)];
}

export function ColorTool({ initialPayload }: ColorToolProps) {
  const { t } = useTranslation();
  const [hex, setHex] = usePersistedState('color.hex', initialPayload ?? '#16a34a');
  const [format, setFormat] = useState<Format>('hex');

  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const colorValues: Record<Format, string> = {
    hex: hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
  };

  const onPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => setHex(e.target.value);

  const onHexInput = (s: string) => {
    const clean = s.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    if (clean.length === 6) setHex('#' + clean);
    else if (clean.length === 0) setHex('');
    else setHex('#' + clean);
  };

  return (
    <ToolShell icon={Palette} title={t('tools.color.name')}>
      <div className="mb-4 flex items-center gap-4">
        <input
          type="color"
          value={hex || '#000000'}
          onChange={onPickerChange}
          className="h-16 w-16 cursor-pointer rounded-lg border border-line bg-panel"
        />
        <div className="flex-1">
          <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.color.hex')}</label>
          <input
            className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={hex}
            onChange={(e) => onHexInput(e.target.value)}
            placeholder="#16a34a"
          />
        </div>
      </div>

      <div className="mb-2 flex gap-1.5">
        {(['hex', 'rgb', 'hsl'] as Format[]).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold uppercase transition-colors duration-150 ${
              format === f ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-hover px-3 py-2.5">
        <span className="font-mono text-sm break-all">{colorValues[format]}</span>
        <CopyButton text={colorValues[format]} className="ml-auto shrink-0" />
      </div>

      {/* Sliders for direct color tweaking */}
      <div className="mt-4 flex flex-col gap-2.5">
        <ChannelSlider label="R" max={255} value={r} onChange={(v) => setHex(rgbToHex(v, g, b))} />
        <ChannelSlider label="G" max={255} value={g} onChange={(v) => setHex(rgbToHex(r, v, b))} />
        <ChannelSlider label="B" max={255} value={b} onChange={(v) => setHex(rgbToHex(r, g, v))} />
      </div>

      {/* HSL hint */}
      <p className="mt-3 text-xs text-muted">
        HSL({h}, {s}%, {l}%) · {t('tools.color.preview')}
      </p>
    </ToolShell>
  );
}

function ChannelSlider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-6 shrink-0 text-xs font-semibold text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-primary"
      />
      <span className="w-10 shrink-0 text-right font-mono text-xs">{value}</span>
    </div>
  );
}
