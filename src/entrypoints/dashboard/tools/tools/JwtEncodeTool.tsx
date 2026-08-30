import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface JwtEncodeToolProps {
  initialPayload?: string;
}

function base64UrlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toBase64UrlJson(obj: unknown): string {
  return base64UrlEncode(JSON.stringify(obj));
}

/** Sign with HS256 using the Web Crypto API. Returns a complete JWT string. */
async function signHs256(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const data = `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${data}.${sigB64}`;
}

/** Encode without a signature (insecure token, useful for testing). */
function encodeNone(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  return `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}.`;
}

type SignMode = 'hs256' | 'none';

export function JwtEncodeTool({ initialPayload }: JwtEncodeToolProps) {
  const { t } = useTranslation();
  const [headerJson, setHeaderJson] = usePersistedState('jwt-encode.header', initialPayload ?? '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  const [payloadJson, setPayloadJson] = usePersistedState('jwt-encode.payload', '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}');
  const [secret, setSecret] = usePersistedState('jwt-encode.secret', '');
  const [mode, setMode] = useState<SignMode>('hs256');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const build = async () => {
    setError('');
    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(headerJson);
      payload = JSON.parse(payloadJson);
    } catch (e) {
      setError((e as Error).message);
      setToken('');
      return;
    }
    // Auto-add exp based on exp / ttl hint? Keep minimal — user provides JSON.
    try {
      if (mode === 'hs256') {
        if (!secret) {
          setError(t('tools.jwt-encode.needSecret'));
          setToken('');
          return;
        }
        setToken(await signHs256(header, payload, secret));
      } else {
        setToken(encodeNone(header, payload));
      }
    } catch (e) {
      setError((e as Error).message);
      setToken('');
    }
  };

  return (
    <ToolShell icon={KeyRound} title={t('tools.jwt-encode.name')}>
      <div className="mb-3 flex gap-1.5">
        {(['hs256', 'none'] as SignMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold uppercase transition-colors duration-150 ${
              mode === m ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {m === 'hs256' ? 'HS256' : 'none'}
          </button>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 max-lg:grid-cols-1">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Header</label>
          <textarea
            className="min-h-[140px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={headerJson}
            onChange={(e) => setHeaderJson(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Payload</label>
          <textarea
            className="min-h-[140px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.target.value)}
          />
        </div>
      </div>

      {mode === 'hs256' && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-semibold text-muted">Secret</label>
          <input
            type="password"
            className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="my-very-secret-key"
          />
        </div>
      )}

      <button onClick={build} className="primary-btn mt-4 flex items-center gap-1.5 text-sm">
        <ShieldCheck size={14} />
        {t('tools.jwt-encode.generate')}
      </button>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {token && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-line bg-hover px-3 py-2.5">
          <span className="flex-1 break-all font-mono text-xs">{token}</span>
          <CopyButton text={token} className="shrink-0" />
        </div>
      )}
    </ToolShell>
  );
}
