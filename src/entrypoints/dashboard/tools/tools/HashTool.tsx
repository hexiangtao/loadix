import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Algo = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512';

const ALGOS: Algo[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'];

/** Compute a hex digest using the Web Crypto API (or a tiny MD5 fallback). */
async function digest(algo: Algo, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (algo !== 'MD5') {
    const hash = await crypto.subtle.digest(algo, bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // MD5 is not in SubtleCrypto. Use a small pure-JS implementation.
  return md5Hex(text);
}

/** Minimal RFC1321 MD5 — sufficient for fingerprint / cache-key use. */
function md5Hex(s: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  const N = bytes.length;
  const x = new Uint32Array(((N + 8) >> 6) * 16 + 16);
  for (let i = 0; i < N; i++) {
    const w = x[i >> 2] ?? 0;
    x[i >> 2] = w | ((bytes[i] ?? 0) << ((i % 4) * 8));
  }
  const off = N >> 2;
  if (off < x.length) x[off] = (x[off] ?? 0) | (0x80 << ((N % 4) * 8));
  const idx = ((N + 8) >> 6) * 16 + 14;
  if (idx < x.length) x[idx] = N * 8;

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const rol = (v: number, s: number) => (v << s) | (v >>> (32 - s));
  const add = (x: number, y: number) => (x + y) | 0;

  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = add(a, (b & c) | (~b & d)); a = add(add(rol(a, 7), 0xd76aa478), add(x[i + 0] ?? 0, b));
    d = add(d, (a & b) | (~a & c)); d = add(add(rol(d, 12), 0xe8c7b756), add(x[i + 1] ?? 0, a));
    c = add(c, (d & a) | (~d & b)); c = add(add(rol(c, 17), 0x242070db), add(x[i + 2] ?? 0, d));
    b = add(b, (c & d) | (~c & a)); b = add(add(rol(b, 22), 0xc1bdceee), add(x[i + 3] ?? 0, c));
    a = add(a, (b & c) | (~b & d)); a = add(add(rol(a, 7), 0xf57c0faf), add(x[i + 4] ?? 0, b));
    d = add(d, (a & b) | (~a & c)); d = add(add(rol(d, 12), 0x4787c62a), add(x[i + 5] ?? 0, a));
    c = add(c, (d & a) | (~d & b)); c = add(add(rol(c, 17), 0xa8304613), add(x[i + 6] ?? 0, d));
    b = add(b, (c & d) | (~c & a)); b = add(add(rol(b, 22), 0xfd469501), add(x[i + 7] ?? 0, c));
    a = add(a, (b & c) | (~b & d)); a = add(add(rol(a, 7), 0x698098d8), add(x[i + 8] ?? 0, b));
    d = add(d, (a & b) | (~a & c)); d = add(add(rol(d, 12), 0x8b44f7af), add(x[i + 9] ?? 0, a));
    c = add(c, (d & a) | (~d & b)); c = add(add(rol(c, 17), 0xffff5bb1), add(x[i + 10] ?? 0, d));
    b = add(b, (c & d) | (~c & a)); b = add(add(rol(b, 22), 0x895cd7be), add(x[i + 11] ?? 0, c));
    a = add(a, (b & c) | (~b & d)); a = add(add(rol(a, 7), 0x6b901122), add(x[i + 12] ?? 0, b));
    d = add(d, (a & b) | (~a & c)); d = add(add(rol(d, 12), 0xfd987193), add(x[i + 13] ?? 0, a));
    c = add(c, (d & a) | (~d & b)); c = add(add(rol(c, 17), 0xa679438e), add(x[i + 14] ?? 0, d));
    b = add(b, (c & d) | (~c & a)); b = add(add(rol(b, 22), 0x49b40821), add(x[i + 15] ?? 0, c));

    a = add(a, (b & d) | (c & ~d)); a = add(add(rol(a, 5), 0xf61e2562), add(x[i + 1] ?? 0, b));
    d = add(d, (a & c) | (b & ~c)); d = add(add(rol(d, 9), 0xc040b340), add(x[i + 6] ?? 0, a));
    c = add(c, (d & b) | (a & ~b)); c = add(add(rol(c, 14), 0x265e5a51), add(x[i + 11] ?? 0, d));
    b = add(b, (c & a) | (d & ~a)); b = add(add(rol(b, 20), 0xe9b6c7aa), add(x[i + 0] ?? 0, c));
    a = add(a, (b & d) | (c & ~d)); a = add(add(rol(a, 5), 0xd62f105d), add(x[i + 5] ?? 0, b));
    d = add(d, (a & c) | (b & ~c)); d = add(add(rol(d, 9), 0x02441453), add(x[i + 10] ?? 0, a));
    c = add(c, (d & b) | (a & ~b)); c = add(add(rol(c, 14), 0xd8a1e681), add(x[i + 15] ?? 0, d));
    b = add(b, (c & a) | (d & ~a)); b = add(add(rol(b, 20), 0xe7d3fbc8), add(x[i + 4] ?? 0, c));
    a = add(a, (b & d) | (c & ~d)); a = add(add(rol(a, 5), 0x21e1cde6), add(x[i + 9] ?? 0, b));
    d = add(d, (a & c) | (b & ~c)); d = add(add(rol(d, 9), 0xc33707d6), add(x[i + 14] ?? 0, a));
    c = add(c, (d & b) | (a & ~b)); c = add(add(rol(c, 14), 0xf4d50d87), add(x[i + 3] ?? 0, d));
    b = add(b, (c & a) | (d & ~a)); b = add(add(rol(b, 20), 0x455a14ed), add(x[i + 8] ?? 0, c));
    a = add(a, (b & d) | (c & ~d)); a = add(add(rol(a, 5), 0xa9e3e905), add(x[i + 13] ?? 0, b));
    d = add(d, (a & c) | (b & ~c)); d = add(add(rol(d, 9), 0xfcefa3f8), add(x[i + 2] ?? 0, a));
    c = add(c, (d & b) | (a & ~b)); c = add(add(rol(c, 14), 0x676f02d9), add(x[i + 7] ?? 0, d));
    b = add(b, (c & a) | (d & ~a)); b = add(add(rol(b, 20), 0x8d2a4c8a), add(x[i + 12] ?? 0, c));

    a = add(a, b ^ c ^ d); a = add(add(rol(a, 4), 0xfffa3942), add(x[i + 5] ?? 0, b));
    d = add(d, a ^ b ^ c); d = add(add(rol(d, 11), 0x8771f681), add(x[i + 8] ?? 0, a));
    c = add(c, d ^ a ^ b); c = add(add(rol(c, 16), 0x6d9d6122), add(x[i + 11] ?? 0, d));
    b = add(b, c ^ d ^ a); b = add(add(rol(b, 23), 0xfde5380c), add(x[i + 14] ?? 0, c));
    a = add(a, b ^ c ^ d); a = add(add(rol(a, 4), 0xa4beea44), add(x[i + 1] ?? 0, b));
    d = add(d, a ^ b ^ c); d = add(add(rol(d, 11), 0x4bdecfa9), add(x[i + 4] ?? 0, a));
    c = add(c, d ^ a ^ b); c = add(add(rol(c, 16), 0xf6bb4b60), add(x[i + 7] ?? 0, d));
    b = add(b, c ^ d ^ a); b = add(add(rol(b, 23), 0xbebfbc70), add(x[i + 10] ?? 0, c));
    a = add(a, b ^ c ^ d); a = add(add(rol(a, 4), 0x289b7ec6), add(x[i + 13] ?? 0, b));
    d = add(d, a ^ b ^ c); d = add(add(rol(d, 11), 0xeaa127fa), add(x[i + 0] ?? 0, a));
    c = add(c, d ^ a ^ b); c = add(add(rol(c, 16), 0xd4ef3085), add(x[i + 3] ?? 0, d));
    b = add(b, c ^ d ^ a); b = add(add(rol(b, 23), 0x04881d05), add(x[i + 6] ?? 0, c));
    a = add(a, b ^ c ^ d); a = add(add(rol(a, 4), 0xd9d4d039), add(x[i + 9] ?? 0, b));
    d = add(d, a ^ b ^ c); d = add(add(rol(d, 11), 0xe6db99e5), add(x[i + 12] ?? 0, a));
    c = add(c, d ^ a ^ b); c = add(add(rol(c, 16), 0x1fa27cf8), add(x[i + 15] ?? 0, d));
    b = add(b, c ^ d ^ a); b = add(add(rol(b, 23), 0xc4ac5665), add(x[i + 2] ?? 0, c));

    a = add(a, c ^ (b | ~d)); a = add(add(rol(a, 6), 0xf4292244), add(x[i + 0] ?? 0, b));
    d = add(d, b ^ (a | ~c)); d = add(add(rol(d, 10), 0x432aff97), add(x[i + 7] ?? 0, a));
    c = add(c, a ^ (d | ~b)); c = add(add(rol(c, 15), 0xab9423a7), add(x[i + 14] ?? 0, d));
    b = add(b, d ^ (c | ~a)); b = add(add(rol(b, 21), 0xfc93a039), add(x[i + 5] ?? 0, c));
    a = add(a, c ^ (b | ~d)); a = add(add(rol(a, 6), 0x655b59c3), add(x[i + 12] ?? 0, b));
    d = add(d, b ^ (a | ~c)); d = add(add(rol(d, 10), 0x8f0ccc92), add(x[i + 3] ?? 0, a));
    c = add(c, a ^ (d | ~b)); c = add(add(rol(c, 15), 0xffeff47d), add(x[i + 10] ?? 0, d));
    b = add(b, d ^ (c | ~a)); b = add(add(rol(b, 21), 0x85845dd1), add(x[i + 1] ?? 0, c));
    a = add(a, c ^ (b | ~d)); a = add(add(rol(a, 6), 0x6fa87e4f), add(x[i + 8] ?? 0, b));
    d = add(d, b ^ (a | ~c)); d = add(add(rol(d, 10), 0xfe2ce6e0), add(x[i + 15] ?? 0, a));
    c = add(c, a ^ (d | ~b)); c = add(add(rol(c, 15), 0xa3014314), add(x[i + 6] ?? 0, d));
    b = add(b, d ^ (c | ~a)); b = add(add(rol(b, 21), 0x4e0811a1), add(x[i + 13] ?? 0, c));
    a = add(a, c ^ (b | ~d)); a = add(add(rol(a, 6), 0xf7537e82), add(x[i + 4] ?? 0, b));
    d = add(d, b ^ (a | ~c)); d = add(add(rol(d, 10), 0xbd3af235), add(x[i + 11] ?? 0, a));
    c = add(c, a ^ (d | ~b)); c = add(add(rol(c, 15), 0x2ad7d2bb), add(x[i + 2] ?? 0, d));
    b = add(b, d ^ (c | ~a)); b = add(add(rol(b, 21), 0xeb86d391), add(x[i + 9] ?? 0, c));

    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }

  const toHex = (n: number) => {
    let s = '';
    for (let k = 0; k < 4; k++) s += ((n >> (k * 8)) & 0xff).toString(16).padStart(2, '0');
    return s;
  };
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

interface HashToolProps {
  initialPayload?: string;
}

export function HashTool({ initialPayload }: HashToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('hash.input', initialPayload ?? '');
  const [hashes, setHashes] = useState<Record<Algo, string>>({
    MD5: '',
    'SHA-1': '',
    'SHA-256': '',
    'SHA-512': '',
  });

  // Recompute all hashes whenever input changes.
  useMemo(() => {
    if (!input) {
      setHashes({ MD5: '', 'SHA-1': '', 'SHA-256': '', 'SHA-512': '' });
      return;
    }
    let cancelled = false;
    Promise.all(ALGOS.map((a) => digest(a, input).then((h) => [a, h] as const))).then((entries) => {
      if (cancelled) return;
      setHashes({ MD5: '', 'SHA-1': '', 'SHA-256': '', 'SHA-512': '', ...Object.fromEntries(entries) });
    });
    return () => {
      cancelled = true;
    };
  }, [input]);

  return (
    <ToolShell icon={Hash} title={t('tools.hash.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="min-h-[120px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Hello, World!"
      />

      <div className="mt-4 flex flex-col gap-2">
        {ALGOS.map((algo) => (
          <div key={algo} className="flex items-center gap-2.5 rounded-lg border border-line bg-hover px-3 py-2">
            <span className="w-20 shrink-0 text-xs font-semibold text-muted">{algo}</span>
            <span className="flex-1 truncate font-mono text-xs">{hashes[algo] || '—'}</span>
            {hashes[algo] && <CopyButton text={hashes[algo]} className="shrink-0" />}
          </div>
        ))}
      </div>
    </ToolShell>
  );
}
