import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Zap } from 'lucide-react';
import { Popover } from './components/Popover';
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
 *
 * The list renders in a portal (shared Popover), so it can never be clipped
 * in half by the sidebar's `overflow` the way the old in-flow dropdown was.
 */
export function PresetMenu({ onApply }: PresetMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [btnRef, setBtnRef] = useState<HTMLButtonElement | null>(null);

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
    <>
      <button
        ref={setBtnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('app.preset_hint')}
        aria-expanded={open}
        className="nav-btn flex items-center gap-1"
      >
        <Zap size={13} />
        {t('app.preset')}
        <ChevronDown size={12} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover anchor={btnRef} onClose={() => setOpen(false)} width="w-44" matchAnchorWidth>
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
        </Popover>
      )}
    </>
  );
}

// Re-export so consumers can satisfy TS without reaching into LoadPanel.
export type { LoadFormValue, LoadModelKind };
