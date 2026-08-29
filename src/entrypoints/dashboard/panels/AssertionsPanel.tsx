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
        <div className="mb-2 grid grid-cols-[1fr_1.5fr_36px] items-center gap-2" key={i}>
          <select
            className="field"
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
            className="field"
            value={a.value}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => onChange([...value, { type: 'status', value: '200' }])}>
        {t('assertions.add')}
      </button>
      <div className="mt-3.5 text-xs leading-relaxed text-muted">{t('assertions.hint')}</div>
    </section>
  );
}
