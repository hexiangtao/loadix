import { useTranslation } from 'react-i18next';
import type { Assertion, AssertionType } from '@/shared/types';

interface AssertionsPanelProps {
  value: Assertion[];
  onChange: (value: Assertion[]) => void;
}

const TYPES: AssertionType[] = ['status', 'latency', 'contains'];

export function AssertionsPanel({ value, onChange }: AssertionsPanelProps) {
  const { t } = useTranslation();
  const label = (type: AssertionType) => t(`assertions.${type}`);

  return (
    <section className="panel">
      {value.map((a, i) => (
        <div className="mb-1.5 grid grid-cols-[1fr_1.8fr_28px] items-center gap-1.5" key={i}>
          <select
            className="field min-w-0 text-[12px]"
            value={a.type}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, type: e.target.value as AssertionType } : x)))}
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {label(ty)}
              </option>
            ))}
          </select>
          <input
            className="field min-w-0 text-[12px]"
            value={a.value}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button
            className="icon-btn"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            title="Remove"
            aria-label="Remove assertion"
          >
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => onChange([...value, { type: 'status', value: '200' }])}>
        {t('assertions.add')}
      </button>
      {/* The "assertions.hint" paragraph used to live here. It was
          filler ("Supports HTTP status code, response time and response
          body text assertions.") — the three select options already
          advertise what each assertion type does. Removed. */}
    </section>
  );
}
