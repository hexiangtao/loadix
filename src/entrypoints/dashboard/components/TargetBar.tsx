import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import type { HttpMethod } from '@/shared/types';

interface TargetBarProps {
  method: HttpMethod;
  url: string;
  timeout: number;
  busy: boolean;
  onChange: (partial: { method?: HttpMethod; url?: string; timeout?: number }) => void;
  onStart: () => void;
  onStop: () => void;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/**
 * "Target API" execution bar.
 *
 * Sits at the top of the right-hand work area (above the live results
 * timeline) so the user sees the URL they're testing in the same column
 * as the metrics that result from it. Visual flow becomes:
 *
 *   [Method] [URL................] [Timeout] [▶ Start]
 *   ↓
 *   progress / verdict / hero metrics / charts / recent requests
 *
 * cURL paste and Test Connection belong with the *request details*
 * (headers / body) so they live back in <RequestPanel />. This bar
 * stays focused on the single most important thing: the URL + the
 * primary execution action.
 */
export function TargetBar({ method, url, timeout, busy, onChange, onStart, onStop }: TargetBarProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Method select — narrow, fixed width so the URL gets the rest. */}
        <select
          className="field w-24 shrink-0 font-mono text-[13px] font-semibold"
          value={method}
          onChange={(e) => onChange({ method: e.target.value as HttpMethod })}
          aria-label={t('request.method')}
        >
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>

        {/* URL — flexes to fill. `min-w-0` lets it shrink below its
            min-content so very long URLs scroll horizontally inside
            the field rather than pushing the action group off-screen. */}
        <input
          className="field min-w-0 flex-1 font-mono text-[13px]"
          value={url}
          placeholder={t('request.urlPlaceholder')}
          onChange={(e) => onChange({ url: e.target.value })}
          onKeyDown={(e) => {
            // Enter on the URL field is a power-user shortcut to start
            // the test. Skip if the user is composing IME input.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && url.trim()) {
              e.preventDefault();
              onStart();
            }
          }}
          aria-label={t('request.url')}
        />

        {/* Timeout — narrow numeric field with a "ms" suffix so the
            user doesn't have to remember the unit. */}
        <div className="relative shrink-0">
          <input
            className="field w-24 pr-7 text-right font-mono"
            type="number"
            min={100}
            value={timeout}
            onChange={(e) => onChange({ timeout: +e.target.value || 10000 })}
            aria-label={t('request.timeout')}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">ms</span>
        </div>

        {/* The primary CTA. Start / Stop swap based on engine state. */}
        {busy ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onStop}
            // The icon is part of the i18n string (e.g. "■ Stop") so we
            // render it as a single text node — adding a separate
            // <span>▶</span> here would duplicate the icon.
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-danger px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-danger/90"
            title={t('results.stop')}
            aria-label={t('results.stop')}
          >
            {t('results.stop')}
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={!url.trim()}
            onClick={onStart}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            title={t('results.start')}
            aria-label={t('results.start')}
          >
            {t('results.start')}
          </motion.button>
        )}
      </div>
    </div>
  );
}
