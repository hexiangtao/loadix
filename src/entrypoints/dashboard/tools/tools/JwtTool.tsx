import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface JwtSegment {
  key: 'header' | 'payload' | 'signature';
  label: string;
  raw: string;
  decoded: string;
  obj: Record<string, unknown> | null;
}

function base64UrlDecode(seg: string): string {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

interface JwtToolProps {
  /** Content routed from the smart-paste box (pre-fills the input). */
  initialPayload?: string;
}

export function JwtTool({ initialPayload }: JwtToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('jwt.input', initialPayload ?? '');

  const segments = useMemo<JwtSegment[]>(() => {
    const token = input.trim();
    if (!token) return [];
    const parts = token.split('.');
    if (parts.length !== 3) return [];

    const [h, p, s] = parts as [string, string, string];
    const decode = (raw: string) => {
      try {
        return { decoded: base64UrlDecode(raw), obj: JSON.parse(base64UrlDecode(raw)) as Record<string, unknown> };
      } catch {
        return { decoded: '', obj: null };
      }
    };
    const header = decode(h);
    const payload = decode(p);

    return [
      { key: 'header', label: t('tools.jwt.header'), raw: h, decoded: header.decoded, obj: header.obj },
      { key: 'payload', label: t('tools.jwt.payload'), raw: p, decoded: payload.decoded, obj: payload.obj },
      { key: 'signature', label: t('tools.jwt.signature'), raw: s, decoded: '', obj: null },
    ];
  }, [input, t]);

  const payload = segments.find((s) => s.key === 'payload');
  const invalid = input.trim() && segments.length === 0;

  return (
    <ToolShell icon={KeyRound} title={t('tools.jwt.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.jwt.input')}</label>
      <input
        autoFocus
        className="field w-full font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"
      />

      {invalid && <p className="mt-2 text-xs text-danger">{t('tools.jwt.invalid')}</p>}

      {segments.length > 0 && (
        <>
          {/* Color-coded segment preview */}
          <div className="mt-4 flex flex-wrap gap-2">
            {segments.map((s) => (
              <span
                key={s.key}
                className={`rounded px-2 py-0.5 font-mono text-xs ${
                  s.key === 'header'
                    ? 'bg-primary/10 text-primary'
                    : s.key === 'payload'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-line/50 text-muted'
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>

          {/* Header + payload as JSON, signature as raw */}
          {segments
            .filter((s) => s.key !== 'signature')
            .map((s) => (
              <div key={s.key} className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">{s.label}</span>
                  {s.decoded && <CopyButton text={s.decoded} />}
                </div>
                <pre className="field min-h-[60px] w-full overflow-auto font-mono text-sm">{s.decoded || '—'}</pre>
              </div>
            ))}

          {/* Claims table */}
          {payload?.obj && (
            <div className="mt-4">
              <span className="text-xs font-semibold text-muted">{t('tools.jwt.claims')}</span>
              <table className="mt-2 w-full border-collapse text-sm">
                <tbody>
                  {Object.entries(payload.obj).map(([k, v]) => (
                    <tr key={k} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 align-top font-mono text-xs font-semibold text-primary">{k}</td>
                      <td className="py-1.5 font-mono text-xs break-all">
                        {renderClaim(k, v, t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-muted">{t('tools.jwt.unverified')}</p>
        </>
      )}
    </ToolShell>
  );
}

function renderClaim(key: string, value: unknown, t: (k: string) => string): string {
  const str = String(value);
  // Human-readable timestamp for exp / iat / nbf.
  if (key === 'exp' || key === 'iat' || key === 'nbf') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      const date = new Date(num * 1000);
      const expired = key === 'exp' && date.getTime() < Date.now();
      const label = `${str}  →  ${date.toISOString()}${expired ? `  ⚠ ${t('tools.jwt.expired')}` : ''}`;
      return label;
    }
  }
  return str;
}
