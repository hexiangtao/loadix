import { useTranslation } from 'react-i18next';

export type LoadModelKind = 'constant' | 'ramp' | 'step' | 'spike' | 'soak';

export interface LoadFormValue {
  loadModel: LoadModelKind;
  users: number;
  rps: number;
  duration: number;
  ramp: number;
  stepUsers: number;
  stepDuration: number;
  spikeUsers: number;
  spikeDuration: number;
  maxErrorRate: number;
  maxP95: number;
}

interface LoadPanelProps {
  value: LoadFormValue;
  onChange: (value: LoadFormValue) => void;
}

const MODELS: LoadModelKind[] = ['constant', 'ramp', 'step', 'spike', 'soak'];

export function LoadPanel({ value, onChange }: LoadPanelProps) {
  const { t } = useTranslation();
  const patch = (partial: Partial<LoadFormValue>) => onChange({ ...value, ...partial });

  const selectModel = (kind: LoadModelKind) => {
    const defaults: Partial<LoadFormValue> = {
      loadModel: kind,
      ramp: kind === 'ramp' ? 5 : 0,
      stepUsers: kind === 'step' ? 10 : 0,
      stepDuration: kind === 'step' ? 10 : 0,
      spikeUsers: kind === 'spike' ? 100 : 0,
      spikeDuration: kind === 'spike' ? 10 : 0,
    };
    onChange({ ...value, ...defaults });
  };

  return (
    <section className="panel">
      {/* Load model selector */}
      <div className="mb-4 flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted">{t('load.model')}</label>
        <div className="flex flex-wrap gap-1.5">
          {MODELS.map((kind) => (
            <button
              key={kind}
              onClick={() => selectModel(kind)}
              className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
                value.loadModel === kind
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {t(`load.model_${kind}`)}
            </button>
          ))}
        </div>
      </div>

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
        {value.loadModel === 'ramp' && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('load.ramp')}
            <input className="field" type="number" min={0} value={value.ramp} onChange={(e) => patch({ ramp: +e.target.value || 0 })} />
          </label>
        )}
      </div>

      {/* Model-specific fields */}
      {value.loadModel === 'step' && (
        <div className="mt-3 grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('load.stepUsers')}
            <input
              className="field"
              type="number"
              min={1}
              value={value.stepUsers}
              onChange={(e) => patch({ stepUsers: +e.target.value || 1 })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('load.stepDuration')}
            <input
              className="field"
              type="number"
              min={1}
              value={value.stepDuration}
              onChange={(e) => patch({ stepDuration: +e.target.value || 1 })}
            />
          </label>
        </div>
      )}
      {value.loadModel === 'spike' && (
        <div className="mt-3 grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('load.spikeUsers')}
            <input
              className="field"
              type="number"
              min={1}
              value={value.spikeUsers}
              onChange={(e) => patch({ spikeUsers: +e.target.value || 1 })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('load.spikeDuration')}
            <input
              className="field"
              type="number"
              min={1}
              value={value.spikeDuration}
              onChange={(e) => patch({ spikeDuration: +e.target.value || 1 })}
            />
          </label>
        </div>
      )}

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
      <div className="mt-3.5 text-xs leading-relaxed text-muted">{t('load.hint')}</div>
    </section>
  );
}
