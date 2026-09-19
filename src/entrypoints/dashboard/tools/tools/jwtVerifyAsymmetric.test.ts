import { describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { verifyJwtAsymmetric } from './jwtVerifyAsymmetric';

describe('verifyJwtAsymmetric', () => {
  it('verifies an RS256 token signed with a matching JWK public key', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt()
      .sign(privateKey);

    const res = await verifyJwtAsymmetric(token, 'RS256', JSON.stringify(jwk));
    expect(res).toEqual({ ok: true });
  });

  it('rejects an RS256 token with the wrong key', async () => {
    const { publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    const { privateKey: otherKey } = await generateKeyPair('RS256', { extractable: true });
    const token = await new SignJWT({ sub: 'u1' }).setProtectedHeader({ alg: 'RS256' }).sign(otherKey);

    const res = await verifyJwtAsymmetric(token, 'RS256', JSON.stringify(jwk));
    expect(res).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('verifies an ES256 token', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    const token = await new SignJWT({ sub: 'u1' }).setProtectedHeader({ alg: 'ES256' }).sign(privateKey);

    const res = await verifyJwtAsymmetric(token, 'ES256', JSON.stringify(jwk));
    expect(res).toEqual({ ok: true });
  });

  it('rejects unsupported algorithms and malformed tokens', async () => {
    expect(await verifyJwtAsymmetric('a.b.c', 'HS256', 'x')).toMatchObject({ ok: false });
    expect(await verifyJwtAsymmetric('not-a-token', 'RS256', 'x')).toMatchObject({ ok: false });
  });
});
