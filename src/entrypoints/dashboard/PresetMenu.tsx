import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Zap } from 'lucide-react';
import type { LoadFormValue, LoadModelKind } from './panels/LoadPanel';

interface PresetMenuProps {
  onApply: (value: LoadFormValue) => void;
}

/**
 * A small load-only preset dropdown: smoke / normal / stress / spike / soak.
 * Picking one overwrites the current load configuration but leaves the
 * request (method / URL / headers / body) untouched — that's the whole point:
 * "apply a workload, keep my request". Each preset uses the most appropriate
 * load model (e.g. spike preset switches loadModel to 'spike').
 */
export function PresetMenu({ onApply }: PresetMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const presets: Array<{
    id: 'smoke' | 'normal' | 'stress' | 'spike' | 'soak';
    labelKey: string;
    build: () => LoadFormValue;
  }> = [
    {
      id: 'smoke',
      labelKey: 'app.preset_smoke',
      build: () => ({
        loadModel: 'constant',
        users: 1,
        rps: 1,
        duration: 10,
        ramp: 0,
        stepUsers: 10,
        stepDuration: 10,
        spikeUsers: 100,
        spikeDuration: 10,
        maxErrorRate: 0,
        maxP95: 0,
      }),
    },
    {
      id: 'normal',
      labelKey: 'app.preset_normal',
      build: () => ({
        loadModel: 'constant',
        users: 10,
        rps: 5,
        duration: 30,
        ramp: 0,
        stepUsers: 10,
        stepDuration: 10,
        spikeUsers: 100,
        spikeDuration: 10,
        maxErrorRate: 0,
        maxP95: 0,
      }),
    },
    {
      id: 'stress',
      labelKey: 'app.preset_stress',
      build: () => ({
        loadModel: 'constant',
        users: 50,
        rps: 20,
        duration: 60,
        ramp: 10,
        stepUsers: 10,
        stepDuration: 10,
        spikeUsers: 100,
        spikeDuration: 10,
        maxErrorRate: 5,
        maxP95: 0,
      }),
    },
    {
      id: 'spike',
      labelKey: 'app.preset_spike',
      build: () => ({
        loadModel: 'spike',
        users: 20,
        rps: 10,
        duration: 30,
        ramp: 0,
        stepUsers: 10,
        stepDuration: 10,
        spikeUsers: 200,
        spikeDuration: 10,
        maxErrorRate: 10,
        maxP95: 1000,
      }),
    },
    {
      id: 'soak',
      labelKey: 'app.preset_soak',
      build: () => ({
        loadModel: 'soak',
        users: 20,
        rps: 10,
        duration: 600,
        ramp: 0,
        stepUsers: 10,
        stepDuration: 10,
        spikeUsers: 100,
        spikeDuration: 10,
        maxErrorRate: 1,
        maxP95: 500,
      }),
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('app.preset_hint')}
        className="nav-btn flex items-center gap-1"
      >
        <Zap size={13} />
        {t('app.preset')}
        <ChevronDown size={12} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onApply(p.build());
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-hover"
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export so consumers can satisfy TS without reaching into LoadPanel.
export type { LoadFormValue, LoadModelKind };
