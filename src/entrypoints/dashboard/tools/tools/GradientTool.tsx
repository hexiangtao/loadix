import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paintbrush, Plus, Trash2 } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface GradientToolProps {
  initialPayload?: string;
}

interface ColorStop {
  color: string;
  /** 0-100, position along the gradient line. */
  pos: number;
}

interface Preset {
  name: string;
  kind: 'linear' | 'radial';
  angle: number;
  stops: ColorStop[];
}

const PRESETS: Preset[] = [
  {
    name: 'Sunset',
    kind: 'linear',
    angle: 135,
    stops: [
      { color: '#ff7e5f', pos: 0 },
      { color: '#feb47b', pos: 50 },
      { color: '#ffafbd', pos: 100 },
    ],
  },
  {
    name: 'Ocean',
    kind: 'linear',
    angle: 90,
    stops: [
      { color: '#2193b0', pos: 0 },
      { color: '#6dd5ed', pos: 100 },
    ],
  },
  {
    name: 'Forest',
    kind: 'linear',
    angle: 180,
    stops: [
      { color: '#134e5e', pos: 0 },
      { color: '#71b280', pos: 100 },
    ],
  },
  {
    name: 'Sunrise glow',
    kind: 'radial',
    angle: 0,
    stops: [
      { color: '#fceabb', pos: 0 },
      { color: '#f8b500', pos: 100 },
    ],
  },
  {
    name: 'Mesh mint',
    kind: 'linear',
    angle: 45,
    stops: [
      { color: '#16a085', pos: 0 },
      { color: '#1abc9c', pos: 50 },
      { color: '#a8e6cf', pos: 100 },
    ],
  },
];

function buildCss(kind: 'linear' | 'radial', angle: number, stops: ColorStop[]): string {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const stopsStr = sorted.map((s) => `${s.color} ${s.pos}%`).join(', ');
  if (kind === 'linear') return `linear-gradient(${angle}deg, ${stopsStr})`;
  return `radial-gradient(circle, ${stopsStr})`;
}

export function GradientTool({ initialPayload }: GradientToolProps) {
  const { t } = useTranslation();
  const [kind, setKind] = usePersistedState<'linear' | 'radial'>('gradient.kind', 'linear');
  const [angle, setAngle] = usePersistedState<number>('gradient.angle', 135);
  const [stops, setStops] = usePersistedState<ColorStop[]>('gradient.stops', PRESETS[0]!.stops);

  void initialPayload;

  const css = useMemo(() => buildCss(kind, angle, stops), [kind, angle, stops]);
  const inlineStyle = { backgroundImage: css };

  const updateStop = (i: number, patch: Partial<ColorStop>) => {
    setStops(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addStop = () => {
    if (stops.length >= 6) return;
    const last = stops[stops.length - 1]!;
    const next: ColorStop = { color: last.color, pos: Math.min(100, last.pos + 10) };
    setStops([...stops, next]);
  };
  const removeStop = (i: number) => {
    if (stops.length <= 2) return;
    setStops(stops.filter((_, idx) => idx !== i));
  };
  const applyPreset = (p: Preset) => {
    setKind(p.kind);
    setAngle(p.angle);
    setStops(p.stops);
  };

  return (
    <ToolShell icon={Paintbrush} title={t('tools.gradient.name')}>
      <div
        className="mb-4 h-40 w-full rounded-xl border border-line"
        style={inlineStyle}
        aria-label="Gradient preview"
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="self-center text-xs text-muted">{t('tools.gradient.type')}:</span>
        {(['linear', 'radial'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition-colors duration-150 ${
              kind === k ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {k}
          </button>
        ))}
        {kind === 'linear' && (
          <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-muted">
            {t('tools.gradient.angle')}
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={angle}
              onChange={(e) => setAngle(+e.target.value)}
              className="w-32"
            />
            <span className="w-10 text-right font-mono">{angle}°</span>
          </label>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="self-center text-xs text-muted">{t('tools.gradient.presets')}:</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            <span
              className="inline-block h-3 w-6 rounded-sm border border-line"
              style={{ backgroundImage: buildCss(p.kind, p.angle, p.stops) }}
            />
            {p.name}
          </button>
        ))}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">
          {t('tools.gradient.stops')} ({stops.length})
        </span>
        <button
          onClick={addStop}
          disabled={stops.length >= 6}
          className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary disabled:opacity-40"
        >
          <Plus size={11} />
          {t('tools.gradient.add')}
        </button>
      </div>
      <div className="space-y-1.5">
        {stops.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-hover px-2 py-1">
            <input
              type="color"
              value={s.color}
              onChange={(e) => updateStop(i, { color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border border-line"
            />
            <input
              type="text"
              value={s.color}
              onChange={(e) => updateStop(i, { color: e.target.value })}
              className="w-24 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none focus:border-primary"
              spellCheck={false}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={s.pos}
              onChange={(e) => updateStop(i, { pos: +e.target.value })}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-xs">{s.pos}%</span>
            <button
              onClick={() => removeStop(i)}
              disabled={stops.length <= 2}
              className="rounded p-0.5 text-muted transition-colors duration-150 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
              title={t('tools.gradient.remove')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-muted">CSS</span>
        <code className="min-w-0 flex-1 truncate rounded border border-line bg-hover px-2 py-1 font-mono text-xs">
          background-image: {css};
        </code>
        <CopyButton text={`background-image: ${css};`} />
      </div>
    </ToolShell>
  );
}
