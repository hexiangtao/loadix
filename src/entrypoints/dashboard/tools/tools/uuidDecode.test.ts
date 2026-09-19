import { describe, expect, it } from 'vitest';
import { decodeUuid, formatAgo } from './uuidDecode';

describe('decodeUuid', () => {
  it('rejects invalid input', () => {
    expect(decodeUuid('not-a-uuid')).toBeNull();
    expect(decodeUuid('')).toBeNull();
    expect(decodeUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBeNull();
  });

  it('detects a v4 uuid and its variant', () => {
    const info = decodeUuid('9b2f1c5e-3a4d-4c6b-8f2a-1d3e5f7a9b0c');
    expect(info).not.toBeNull();
    expect(info!.version).toBe(4);
    expect(info!.variant).toContain('RFC');
    expect(info!.timestamp).toBeUndefined();
  });

  it('extracts the embedded timestamp from a v7 uuid', () => {
    // v7 first 48 bits = unix ms. 2024-01-01T00:00:00Z = 1704067200000
    const ms = 1704067200000;
    const hex = ms.toString(16).padStart(12, '0');
    // version nibble must be 7 → position 14 of the dashed form
    const u = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-bdef-123456789abc`;
    const info = decodeUuid(u);
    expect(info!.version).toBe(7);
    expect(info!.timestamp!.iso).toBe(new Date(ms).toISOString());
  });

  it('extracts the embedded timestamp from a v1 uuid', () => {
    // Canonical RFC 4122 example: 2021-01-01-ish. Build one from a known ms.
    const ms = 1609459200000; // 2021-01-01T00:00:00Z
    const ts = BigInt(ms) * 10000n + 0x01b21dd213814000n;
    const hex = ts.toString(16).padStart(16, '0');
    const u = `${hex.slice(8)}-${hex.slice(4, 8)}-1${hex.slice(1, 4)}-8abc-123456789abc`;
    const info = decodeUuid(u);
    expect(info!.version).toBe(1);
    expect(info!.timestamp!.iso).toBe(new Date(ms).toISOString());
  });

  it('formats relative time', () => {
    expect(formatAgo(30_000)).toBe('30s');
    expect(formatAgo(5 * 60_000)).toBe('5m');
    expect(formatAgo(3 * 3600_000)).toBe('3h');
    expect(formatAgo(2 * 86400_000)).toBe('2d');
  });
});
