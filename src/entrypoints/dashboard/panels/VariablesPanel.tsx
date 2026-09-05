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
        <div className="mb-1.5 grid grid-cols-[1fr_1.8fr_28px] items-center gap-1.5" key={i}>
          <input
            className="field min-w-0 text-[12px]"
            placeholder={t('variables.name')}
            value={k}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? [e.target.value, x[1]] as [string, string] : x)))}
          />
          <input
            className="field min-w-0 text-[12px]"
            placeholder={t('variables.value')}
            value={v}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? [x[0], e.target.value] as [string, string] : x)))}
          />
          <button
            className="icon-btn"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            title="Remove"
            aria-label="Remove variable"
          >
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => onChange([...value, ['', '']])}>
        {t('variables.add')}
      </button>
      {/* The "variables.hint" paragraph used to live here ("Use
          {{variable}} in URL, headers or body..."). The interpolation
          syntax is a power-user feature; surfacing it to every user as
          a paragraph was noise. Removed; if we ever need to teach it
          we can show a one-time tooltip the first time the user types
          `{{` in a field. */}
    </section>
  );
}
