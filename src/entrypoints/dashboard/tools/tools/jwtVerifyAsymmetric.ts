/**
 * Asymmetric JWT verification via WebCrypto (RS256/RS384/RS512, ES256/384/512).
 *
 * Accepts a PEM SPKI public key, or a JWK pasted as JSON. Nothing leaves the
 * browser — verification runs entirely with crypto.subtle.
 */

type VerifyResult = { ok: true } | { ok: false; reason: string };

const HASH_BY_ALG: Record<string, string> = {
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
  ES256: 'SHA-256',
  ES384: 'SHA-384',
  ES512: 'SHA-512',
};

const NAMED_CURVE_BY_ALG: Record<string, string> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

function base64UrlToBytes(seg: string): Uint8Array<ArrayBuffer> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importPublicKey(publicKeyText: string, alg: string): Promise<CryptoKey> {
  const trimmed = publicKeyText.trim();
  const hash = HASH_BY_ALG[alg] ?? 'SHA-256';

  // JWK pasted as JSON
  if (trimmed.startsWith('{')) {
    const jwk = JSON.parse(trimmed) as JsonWebKey;
    if (alg.startsWith('RS')) {
      return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
    }
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: NAMED_CURVE_BY_ALG[alg] ?? 'P-256' }, false, [
      'verify',
    ]);
  }

  // PEM SPKI
  const bytes = pemToBytes(trimmed);
  if (alg.startsWith('RS')) {
    return crypto.subtle.importKey('spki', bytes, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  }
  return crypto.subtle.importKey('spki', bytes, { name: 'ECDSA', namedCurve: NAMED_CURVE_BY_ALG[alg] ?? 'P-256' }, false, [
    'verify',
  ]);
}

/** Convert a raw JOSE signature (r||s) to DER for ECDSA WebCrypto verify. */
function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const half = raw.length / 2;
  const toDer = (part: Uint8Array): number[] => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    const mag = [...part.slice(start)];
    if (mag[0]! & 0x80) mag.unshift(0);
    return [0x02, mag.length, ...mag];
  };
  const rDer = toDer(raw.slice(0, half));
  const sDer = toDer(raw.slice(half));
  const out = new Uint8Array(new ArrayBuffer(rDer.length + sDer.length + 2));
  out.set([0x30, rDer.length + sDer.length]);
  out.set(rDer, 2);
  out.set(sDer, 2 + rDer.length);
  return out;
}

export async function verifyJwtAsymmetric(
  token: string,
  alg: string,
  publicKeyText: string,
): Promise<VerifyResult> {
  const hash = HASH_BY_ALG[alg];
  if (!hash) return { ok: false, reason: `unsupported algorithm: ${alg}` };

  const parts = token.trim().split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [h, p, sig] = parts as [string, string, string];

  let key: CryptoKey;
  try {
    key = await importPublicKey(publicKeyText, alg);
  } catch (e) {
    return { ok: false, reason: `cannot import public key: ${(e as Error).message}` };
  }

  const data = new TextEncoder().encode(`${h}.${p}`);
  const raw = base64UrlToBytes(sig);
  const isEs = alg.startsWith('ES');
  const candidates = isEs ? [rawToDer(raw), raw] : [raw];
  for (const sigBytes of candidates) {
    try {
      const ok = await crypto.subtle.verify(
        isEs ? { name: 'ECDSA', hash } : 'RSASSA-PKCS1-v1_5',
        key,
        sigBytes,
        data,
      );
      if (ok) return { ok: true };
    } catch {
      // try the next encoding
    }
  }
  return { ok: false, reason: 'signature mismatch' };
}
