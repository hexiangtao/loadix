import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { md5 } from '../md5';

type UuidVersion = 'v1' | 'v3' | 'v4' | 'v5' | 'v7';

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';
const NAMESPACE_X500 = '6ba7b814-9dad-11d1-80b4-00c04fd430c8';

const NAMESPACES = [
  { value: NAMESPACE_DNS, label: 'DNS' },
  { value: NAMESPACE_URL, label: 'URL' },
  { value: NAMESPACE_OID, label: 'OID' },
  { value: NAMESPACE_X500, label: 'X.500' },
];

function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  if (bytes[6] !== undefined) bytes[6] = (bytes[6] & 0x0f) | 0x40;
  if (bytes[8] !== undefined) bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidV7(): string {
  const ts = Date.now();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  if (bytes[6] !== undefined) bytes[6] = (bytes[6] & 0x0f) | 0x70;
  if (bytes[8] !== undefined) bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * UUIDv1: 60-bit Gregorian timestamp (100ns intervals since 1582-10-15) +
 * 14-bit clock sequence + 48-bit "node" (we seed with 14 random bytes so the
 * result is at least stable within the same ms; we don't have a real MAC).
 */
function uuidV1(): string {
  const GREG_OFFSET_100NS = 0x01b21dd213814000n;
  const now100ns = BigInt(Date.now()) * 10000n + GREG_OFFSET_100NS;
  const tsHex = now100ns.toString(16).padStart(16, '0');
  const tsLow = tsHex.slice(8);
  const tsMid = tsHex.slice(4, 8);
  const tsHigh = tsHex.slice(0, 4);
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const clkSeq = ((rand[0]! & 0x3f) | 0x80).toString(16).padStart(2, '0') + (rand[1]!.toString(16).padStart(2, '0'));
  const node = Array.from(rand.slice(2), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${tsLow}-${tsMid}-1${tsHigh.slice(1)}-${clkSeq}-${node}`;
}

function parseUuid(s: string): Uint8Array {
  const hex = s.replace(/-/g, '');
  return new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function stampAndFormat(hex: string, version: number): string {
  const chars = hex.slice(0, 32).split('');
  chars[12] = version.toString(16);
  chars[16] = ((parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`;
}

async function uuidV3(namespace: string, name: string): Promise<string> {
  const nsBytes = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);
  const hash = md5(combined);
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return stampAndFormat(hex, 3);
}

async function uuidV5(namespace: string, name: string): Promise<string> {
  const nsBytes = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', combined));
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return stampAndFormat(hex, 5);
}

interface UuidToolProps {
  initialPayload?: string;
}

export function UuidTool({ initialPayload }: UuidToolProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<UuidVersion>('v4');
  const [count, setCount] = useState(5);
  const [items, setItems] = useState<string[]>(() => Array.from({ length: 5 }, () => uuidV4()));
  const [name, setName] = useState('example.com');
  const [namespace, setNamespace] = useState(NAMESPACE_DNS);
  const [customNs, setCustomNs] = useState('');
  const [singleUuid, setSingleUuid] = useState('');
  void initialPayload;

  const isBulk = version === 'v4' || version === 'v7';

  const generateBulk = () => {
    const gen = version === 'v4' ? uuidV4 : uuidV7;
    setItems(Array.from({ length: count }, () => gen()));
  };

  const generateSingle = useCallback(async () => {
    const ns = customNs.trim() || namespace;
    try {
      if (version === 'v1') setSingleUuid(uuidV1());
      else if (version === 'v3') setSingleUuid(await uuidV3(ns, name));
      else if (version === 'v5') setSingleUuid(await uuidV5(ns, name));
    } catch {
      setSingleUuid('');
    }
  }, [version, name, namespace, customNs]);

  return (
    <ToolShell icon={Fingerprint} title={t('tools.uuid.name')}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['v1', 'v3', 'v4', 'v5', 'v7'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setVersion(v)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
              version === v ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      {isBulk ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              {t('tools.uuid.count')}
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.min(100, Math.max(1, +e.target.value || 1)))}
                className="w-20 rounded-lg border border-line bg-panel px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <button onClick={generateBulk} className="primary-btn text-sm">
              {t('tools.uuid.generate')}
            </button>
            {items.length > 0 && <CopyButton text={items.join('\n')} className="ml-auto" />}
          </div>

          <div className="flex flex-col gap-1.5">
            {items.map((u, i) => (
              <div key={`${u}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-hover px-3 py-2">
                <span className="flex-1 font-mono text-sm break-all">{u}</span>
                <CopyButton text={u} className="shrink-0" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-muted">
              {t('tools.uuid.nameLabel')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none focus:border-primary"
                placeholder="example.com"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {t('tools.uuid.namespace')}
              <select
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                className="rounded-lg border border-line bg-panel px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {NAMESPACES.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
                <option value="">Custom…</option>
              </select>
            </label>
          </div>
          {!namespace && (
            <label className="mb-3 flex flex-col gap-1 text-xs font-semibold text-muted">
              {t('tools.uuid.customNamespace')}
              <input
                value={customNs}
                onChange={(e) => setCustomNs(e.target.value)}
                className="rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none focus:border-primary"
                placeholder="00000000-0000-0000-0000-000000000000"
                spellCheck={false}
              />
            </label>
          )}
          <div className="flex items-center gap-2">
            <button onClick={generateSingle} className="primary-btn text-sm">
              {t('tools.uuid.generate')}
            </button>
            {singleUuid && <CopyButton text={singleUuid} className="ml-auto" />}
          </div>
          {singleUuid && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-hover px-3 py-2">
              <span className="flex-1 font-mono text-sm break-all">{singleUuid}</span>
              <CopyButton text={singleUuid} className="shrink-0" />
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-xs text-muted">{t('tools.uuid.hint')}</p>
    </ToolShell>
  );
}
