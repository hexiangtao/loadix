import { useTranslation } from 'react-i18next';

interface VariablesPanelProps {
  value: [string, string][];
  onChange: (value: [string, string][]) => void;
}

export function VariablesPanel({ value, onChange }: VariablesPanelProps) {
  const { t } = useTranslation();
  return (
    <section className="panel">
      {value.map(([k, v], i) => (
        <div className="mb-2 grid grid-cols-[1fr_1.5fr_36px] items-center gap-2" key={i}>
          <input
            className="field"
            placeholder={t('variables.name')}
            value={k}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? [e.target.value, x[1]] as [string, string] : x)))}
          />
          <input
            className="field"
            placeholder={t('variables.value')}
            value={v}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? [x[0], e.target.value] as [string, string] : x)))}
          />
          <button className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => onChange([...value, ['', '']])}>
        {t('variables.add')}
      </button>
      <div className="mt-3.5 text-xs leading-relaxed text-muted">{t('variables.hint')}</div>
    </section>
  );
}
