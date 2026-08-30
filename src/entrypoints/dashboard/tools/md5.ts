/**
 * Minimal RFC1321 MD5 — sufficient for fingerprint / cache-key use.
 * Returns the raw 16-byte digest so callers can use the bytes directly
 * (e.g. UUIDv3 namespace hashing) instead of formatting to hex first.
 */
export function md5(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
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

    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const out = new Uint8Array(16);
  const writeWord = (w: number, off: number) => {
    out[off] = w & 0xff;
    out[off + 1] = (w >>> 8) & 0xff;
    out[off + 2] = (w >>> 16) & 0xff;
    out[off + 3] = (w >>> 24) & 0xff;
  };
  writeWord(a, 0);
  writeWord(b, 4);
  writeWord(c, 8);
  writeWord(d, 12);
  return out;
}

/** Format a 16-byte MD5 digest as a lowercase hex string. */
export function md5Hex(input: string | Uint8Array): string {
  return Array.from(md5(input), (b) => b.toString(16).padStart(2, '0')).join('');
}
