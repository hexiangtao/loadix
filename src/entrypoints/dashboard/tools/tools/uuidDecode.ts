import { useState } from 'react';

/**
 * Decode a UUID: validate, detect the version, and for time-ordered
 * versions (v1, v7) extract the embedded timestamp — invaluable when
 * debugging "when was this row created".
 */

export interface UuidInfo {
  valid: boolean;
  version: number | null;
  variant: string;
  timestamp?: {
    iso: string;
    agoMs: number;
  };
}

const GREG_OFFSET_100NS = 0x01b21dd213814000n;

export function decodeUuid(input: string): UuidInfo | null {
  const cleaned = input.trim().toLowerCase().replace(/^urn:uuid:/, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cleaned)) return null;

  const version = parseInt(cleaned[14]!, 16);
  const variantBits = parseInt(cleaned[19]!, 16);
  const variant =
    (variantBits & 0x8) === 0 ? 'NCS (backward compat)' : (variantBits & 0xc) === 8 ? 'RFC 9562 / RFC 4122' : (variantBits & 0xc) === 12 ? 'Microsoft' : 'reserved';

  const info: UuidInfo = { valid: true, version: Number.isFinite(version) ? version : null, variant };

  try {
    if (version === 7) {
      // 48-bit big-endian unix ms in the first 12 hex chars
      const hex = cleaned.replace(/-/g, '').slice(0, 12);
      const ms = Number.parseInt(hex, 16);
      if (Number.isFinite(ms)) {
        info.timestamp = { iso: new Date(ms).toISOString(), agoMs: Date.now() - ms };
      }
    } else if (version === 1) {
      // v1 layout: time_low[0:8] + time_mid[8:12] + ver+time_hi[12:16]
      // Rebuild the 60-bit ts: drop the version nibble, then hi(12)+mid(16)+low(32).
      const x = cleaned.replace(/-/g, '');
      const tsHex = x.slice(13, 16) + x.slice(8, 12) + x.slice(0, 8);
      const ts100ns = (BigInt('0x' + tsHex) - GREG_OFFSET_100NS) / 10000n;
      const ms = Number(ts100ns);
      if (Number.isFinite(ms)) {
        info.timestamp = { iso: new Date(ms).toISOString(), agoMs: Date.now() - ms };
      }
    }
  } catch {
    // timestamp extraction is best-effort
  }

  return info;
}

export function formatAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
