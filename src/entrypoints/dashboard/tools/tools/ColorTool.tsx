import { useMemo, useState } from 'react';
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

/** WCAG 2.x relative luminance. */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrastRatio(rgbA: [number, number, number], rgbB: [number, number, number]): number {
  const la = relativeLuminance(...rgbA);
  const lb = relativeLuminance(...rgbB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const TW_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * Generate a Tailwind-like ramp from one base color by mixing toward white
 * (lighter steps) or black (darker steps) in HSL space, keeping hue constant.
 */
function twRamp(hex: string): Record<(typeof TW_STEPS)[number], string> {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Target lightness per step — mirrors how Tailwind ramps are distributed.
  const targets: Record<(typeof TW_STEPS)[number], number> = {
    50: 97, 100: 94, 200: 86, 300: 77, 400: 66, 500: Math.round(Math.max(45, Math.min(60, l))),
    600: Math.max(35, l - 10), 700: Math.max(28, l - 18), 800: Math.max(20, l - 26),
    900: Math.max(14, l - 32), 950: Math.max(8, l - 40),
  };
  const out = {} as Record<(typeof TW_STEPS)[number], string>;
  for (const step of TW_STEPS) {
    const [rr, gg, bb] = hslToRgb(h, s, targets[step]);
    out[step] = rgbToHex(rr, gg, bb);
  }
  return out;
}

function grade(ratio: number): { label: string; ok: boolean } {
  return { label: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail', ok: ratio >= 4.5 };
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

  const rgb: [number, number, number] = [r, g, b];
  const vsWhite = useMemo(() => contrastRatio(rgb, [255, 255, 255]), [r, g, b]);
  const vsBlack = useMemo(() => contrastRatio(rgb, [0, 0, 0]), [r, g, b]);
  const ramp = useMemo(() => (isHex(hex) ? twRamp(hex) : null), [hex]);

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

      {/* WCAG contrast checks */}
      <div className="mt-4">
        <span className="text-xs font-semibold text-muted">{t('tools.color.contrast')}</span>
        <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <ContrastCard
            bg={rgbToHex(r, g, b)}
            fg="#FFFFFF"
            ratio={vsWhite}
            gLabel={t('tools.color.onWhite')}
          />
          <ContrastCard
            bg={rgbToHex(r, g, b)}
            fg="#000000"
            ratio={vsBlack}
            gLabel={t('tools.color.onBlack')}
          />
        </div>
      </div>

      {/* Tailwind-style ramp */}
      {ramp && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">{t('tools.color.ramp')}</span>
            <CopyButton
              text={TW_STEPS.map((st) => `${st}: ${ramp[st]}`).join('\n')}
              className="shrink-0"
            />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {TW_STEPS.map((step) => (
              <button
                key={step}
                onClick={() => setHex(ramp[step])}
                className="group flex-1"
                title={`${step} — ${ramp[step]}`}
              >
                <div className="h-12 w-full transition-transform duration-150 group-hover:scale-y-110" style={{ backgroundColor: ramp[step] }} />
                <div className="bg-panel px-0.5 py-1 text-center">
                  <div className="text-[10px] font-semibold text-muted">{step}</div>
                  <div className="truncate font-mono text-[9px] text-muted">{ramp[step].slice(1)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* HSL hint */}
      <p className="mt-3 text-xs text-muted">
        HSL({h}, {s}%, {l}%) · {t('tools.color.preview')}
      </p>
    </ToolShell>
  );
}

function ContrastCard({ bg, fg, ratio, gLabel }: { bg: string; fg: string; ratio: number; gLabel: string }) {
  const g = grade(ratio);
  return (
    <div className="rounded-lg border border-line" style={{ backgroundColor: bg }}>
      <div className="px-3 py-4" style={{ color: fg }}>
        <div className="text-sm font-semibold">Aa</div>
        <div className="text-[11px]">{gLabel} · {ratio.toFixed(2)}:1</div>
      </div>
      <div className="flex justify-between px-2.5 py-1 text-[10px]" style={{ color: fg, opacity: 0.85 }}>
        <span>{g.label}</span>
        <span className={g.ok ? 'font-semibold' : ''}>{g.ok ? '✓' : '✗'}</span>
      </div>
    </div>
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
