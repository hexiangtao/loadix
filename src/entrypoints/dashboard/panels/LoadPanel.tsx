import { useTranslation } from 'react-i18next';

export interface LoadFormValue {
  users: number;
  rps: number;
  duration: number;
  ramp: number;
  maxErrorRate: number;
  maxP95: number;
}

interface LoadPanelProps {
  value: LoadFormValue;
  onChange: (value: LoadFormValue) => void;
}

const PRESETS: { label: string; users: number; rps: number; duration: number }[] = [
  { label: 'Smoke', users: 1, rps: 1, duration: 10 },
  { label: 'Normal', users: 10, rps: 5, duration: 30 },
  { label: 'Stress', users: 50, rps: 25, duration: 60 },
  { label: 'Spike', users: 100, rps: 50, duration: 120 },
];

export function LoadPanel({ value, onChange }: LoadPanelProps) {
  const { t } = useTranslation();
  const patch = (partial: Partial<LoadFormValue>) => onChange({ ...value, ...partial });

  return (
    <section className="panel">
      <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.users')}
          <input className="field" type="number" min={1} value={value.users} onChange={(e) => patch({ users: +e.target.value || 1 })} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.rps')}
          <input className="field" type="number" min={0} value={value.rps} onChange={(e) => patch({ rps: +e.target.value || 0 })} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.duration')}
          <input
            className="field"
            type="number"
            min={1}
            value={value.duration}
            onChange={(e) => patch({ duration: +e.target.value || 10 })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.ramp')}
          <input className="field" type="number" min={0} value={value.ramp} onChange={(e) => patch({ ramp: +e.target.value || 0 })} />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-muted">
        <span>{t('load.autoStop')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.maxErrorRate')}
          <input
            className="field"
            type="number"
            min={0}
            max={100}
            value={value.maxErrorRate}
            onChange={(e) => patch({ maxErrorRate: +e.target.value || 0 })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('load.maxP95')}
          <input
            className="field"
            type="number"
            min={0}
            value={value.maxP95}
            onChange={(e) => patch({ maxP95: +e.target.value || 0 })}
          />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} className="ghost-btn" onClick={() => patch({ users: p.users, rps: p.rps, duration: p.duration })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-3.5 text-xs leading-relaxed text-muted">{t('load.hint')}</div>
    </section>
  );
}
