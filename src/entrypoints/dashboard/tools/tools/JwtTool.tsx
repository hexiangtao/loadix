import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck, ShieldAlert, FileSearch, Lock } from 'lucide-react';
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

type Mode = 'decode' | 'encode';
type SignMode = 'hs256' | 'none';

function base64UrlDecode(seg: string): string {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function base64UrlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toBase64UrlJson(obj: unknown): string {
  return base64UrlEncode(JSON.stringify(obj));
}

async function signHs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
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

function encodeNone(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  return `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}.`;
}

interface JwtToolProps {
  initialPayload?: string;
}

const DEFAULT_HEADER = '{\n  "alg": "HS256",\n  "typ": "JWT"\n}';
const DEFAULT_PAYLOAD = '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}';

export function JwtTool({ initialPayload }: JwtToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('decode');
  const [token, setToken] = usePersistedState('jwt.input', initialPayload ?? '');
  const [signMode, setSignMode] = useState<SignMode>('hs256');
  const [headerJson, setHeaderJson] = usePersistedState('jwt.header', DEFAULT_HEADER);
  const [payloadJson, setPayloadJson] = usePersistedState('jwt.payload', DEFAULT_PAYLOAD);
  const [secret, setSecret] = usePersistedState('jwt.secret', '');
  const [signedToken, setSignedToken] = useState('');
  const [encodeError, setEncodeError] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'ok' | 'bad' | 'alg' | 'err'>('idle');
  const [verifyMsg, setVerifyMsg] = useState('');

  // Reset verification whenever the token changes so the old verdict doesn't linger.
  useEffect(() => {
    setVerifyStatus('idle');
    setVerifyMsg('');
  }, [token]);

  const segments = useMemo<JwtSegment[]>(() => {
    const trimmed = token.trim();
    if (!trimmed) return [];
    const parts = trimmed.split('.');
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
  }, [token, t]);

  const payload = segments.find((s) => s.key === 'payload');
  const invalid = token.trim() && segments.length === 0;

  /** Pull the decoded payload into the encode form for round-trip editing. */
  const transferToEncode = () => {
    if (segments[0]?.decoded) setHeaderJson(segments[0].decoded);
    if (payload?.obj) setPayloadJson(JSON.stringify(payload.obj, null, 2));
    setMode('encode');
  };

  const build = async () => {
    setEncodeError('');
    setSignedToken('');
    let header: Record<string, unknown>;
    let payloadObj: Record<string, unknown>;
    try {
      header = JSON.parse(headerJson);
      payloadObj = JSON.parse(payloadJson);
    } catch (e) {
      setEncodeError((e as Error).message);
      return;
    }
    try {
      if (signMode === 'hs256') {
        if (!secret) {
          setEncodeError(t('tools.jwt.needSecret'));
          return;
        }
        setSignedToken(await signHs256(header, payloadObj, secret));
      } else {
        setSignedToken(encodeNone(header, payloadObj));
      }
    } catch (e) {
      setEncodeError((e as Error).message);
    }
  };

  /** Recompute the signature with the provided secret and compare it to the token. */
  const verify = async () => {
    const sig = segments.find((s) => s.key === 'signature');
    const headerObj = segments.find((s) => s.key === 'header')?.obj;
    const payloadObj = payload?.obj;
    if (!sig || !headerObj || !payloadObj) return;
    const alg = String(headerObj.alg ?? '').toUpperCase();
    if (alg !== 'HS256') {
      setVerifyStatus('alg');
      setVerifyMsg(t('tools.jwt.algMismatch', { alg }));
      return;
    }
    if (!secret) {
      setVerifyStatus('err');
      setVerifyMsg(t('tools.jwt.needSecret'));
      return;
    }
    try {
      const recomputed = await signHs256(headerObj, payloadObj, secret);
      const expected = recomputed.split('.')[2];
      if (expected === sig.raw) {
        setVerifyStatus('ok');
        setVerifyMsg(t('tools.jwt.verified'));
      } else {
        setVerifyStatus('bad');
        setVerifyMsg(t('tools.jwt.invalidSignature'));
      }
    } catch (e) {
      setVerifyStatus('err');
      setVerifyMsg((e as Error).message);
    }
  };

  return (
    <ToolShell icon={KeyRound} title={t('tools.jwt.name')}>
      <div className="mb-3 flex gap-1.5">
        <button
          onClick={() => setMode('decode')}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-150 ${
            mode === 'decode' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <FileSearch size={14} />
          {t('tools.jwt.decode')}
        </button>
        <button
          onClick={() => setMode('encode')}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-150 ${
            mode === 'encode' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <Lock size={14} />
          {t('tools.jwt.encode')}
        </button>
      </div>

      {mode === 'decode' ? (
        <>
          <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.jwt.input')}</label>
          <input
            autoFocus
            className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"
          />

          {invalid && <p className="mt-2 text-xs text-danger">{t('tools.jwt.invalid')}</p>}

          {segments.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
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
                {payload?.obj && (
                  <button
                    onClick={transferToEncode}
                    className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
                  >
                    <Lock size={12} />
                    {t('tools.jwt.editEncode')}
                  </button>
                )}
              </div>

              {segments
                .filter((s) => s.key !== 'signature')
                .map((s) => (
                  <div key={s.key} className="mt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted">{s.label}</span>
                      {s.decoded && <CopyButton text={s.decoded} />}
                    </div>
                    <pre className="min-h-[60px] w-full overflow-auto rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-sm">
                      {s.decoded || '—'}
                    </pre>
                  </div>
                ))}

              {payload?.obj && (
                <div className="mt-4">
                  <span className="text-xs font-semibold text-muted">{t('tools.jwt.claims')}</span>
                  <table className="mt-2 w-full border-collapse text-sm">
                    <tbody>
                      {Object.entries(payload.obj).map(([k, v]) => (
                        <tr key={k} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-3 align-top font-mono text-xs font-semibold text-primary">{k}</td>
                          <td className="py-1.5 font-mono text-xs break-all">{renderClaim(k, v, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <details className="group mt-4">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted transition-colors duration-150 hover:text-ink">
                  <span className="text-base leading-none transition-transform duration-150 group-open:rotate-90">▸</span>
                  {t('tools.jwt.verify')}
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-muted">{t('tools.jwt.verifyHint')}</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="my-very-secret-key"
                    />
                    <button
                      onClick={verify}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
                    >
                      <ShieldCheck size={14} />
                      {t('tools.jwt.verify')}
                    </button>
                  </div>
                  {verifyStatus === 'ok' && (
                    <div className="flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
                      <ShieldCheck size={12} /> {verifyMsg}
                    </div>
                  )}
                  {verifyStatus === 'bad' && (
                    <div className="flex items-center gap-1.5 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs font-semibold text-danger">
                      <ShieldAlert size={12} /> {verifyMsg}
                    </div>
                  )}
                  {(verifyStatus === 'alg' || verifyStatus === 'err') && verifyMsg && (
                    <div className="flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs font-semibold text-warning">
                      <ShieldAlert size={12} /> {verifyMsg}
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-1.5">
            {(['hs256', 'none'] as SignMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setSignMode(m)}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold uppercase transition-colors duration-150 ${
                  signMode === m ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {m === 'hs256' ? 'HS256' : 'none'}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted">Header</label>
              <textarea
                className="min-h-[120px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
                value={headerJson}
                onChange={(e) => setHeaderJson(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted">Payload</label>
              <textarea
                className="min-h-[120px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
                value={payloadJson}
                onChange={(e) => setPayloadJson(e.target.value)}
              />
            </div>
          </div>

          {signMode === 'hs256' && (
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

          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={build}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
            >
              <ShieldCheck size={14} />
              {t('tools.jwt.generate')}
            </button>
            {signedToken && (
              <span className="truncate font-mono text-xs text-muted">
                {signedToken.slice(0, 48)}…
              </span>
            )}
          </div>

          {encodeError && <p className="mt-2 text-xs text-danger">{encodeError}</p>}

          {signedToken && (
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-line bg-hover px-3 py-2.5">
              <span className="flex-1 break-all font-mono text-xs">{signedToken}</span>
              <CopyButton text={signedToken} className="shrink-0" />
            </div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function renderClaim(key: string, value: unknown, t: (k: string) => string): string {
  const str = String(value);
  if (key === 'exp' || key === 'iat' || key === 'nbf') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      const date = new Date(num * 1000);
      const expired = key === 'exp' && date.getTime() < Date.now();
      return `${str}  →  ${date.toISOString()}${expired ? `  ⚠ ${t('tools.jwt.expired')}` : ''}`;
    }
  }
  return str;
}
