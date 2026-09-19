/** RFC 1321 MD5 implemented without platform-specific crypto APIs. */
export function md5(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  const rotl = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount));
  const add = (a: number, b: number) => (a + b) >>> 0;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < data.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      const sum = add(add(add(a, f >>> 0), constants[i]!), words[g]!);
      d = c;
      c = b;
      b = add(b, rotl(sum, shifts[i]!));
      a = next;
    }

    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }

  const out = new Uint8Array(16);
  const result = new DataView(out.buffer);
  result.setUint32(0, a0, true);
  result.setUint32(4, b0, true);
  result.setUint32(8, c0, true);
  result.setUint32(12, d0, true);
  return out;
}

export function md5Hex(input: string | Uint8Array): string {
  return Array.from(md5(input), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
