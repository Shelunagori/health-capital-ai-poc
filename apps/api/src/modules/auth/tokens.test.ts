import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_TTL_SECONDS,
  TokenError,
  bearerToken,
  createTokenSigner,
} from './tokens.js';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);

const principal = {
  userId: '77777777-7777-4777-8777-000000000001',
  role: 'MEMBER' as const,
  memberId: '33333333-3333-4333-8333-000000000001',
  employerId: null,
};

describe('access tokens', () => {
  it('round-trips a principal', async () => {
    const signer = createTokenSigner(SECRET);
    const { token, expiresInSeconds } = await signer.sign(principal);
    expect(expiresInSeconds).toBe(TOKEN_TTL_SECONDS);
    expect(await signer.verify(token)).toEqual(principal);
  });

  it('expires after fifteen minutes', () => {
    expect(TOKEN_TTL_SECONDS).toBe(900);
  });

  it('carries no personal data in its claims', async () => {
    const signer = createTokenSigner(SECRET);
    const { token } = await signer.sign(principal);
    const payloadSegment = token.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'eid',
      'exp',
      'iat',
      'iss',
      'mid',
      'role',
      'sub',
    ]);
    expect(JSON.stringify(claims)).not.toMatch(/@|thompson|sarah/i);
  });

  it('rejects a token signed with a different secret', async () => {
    const { token } = await createTokenSigner(OTHER_SECRET).sign(principal);
    await expect(createTokenSigner(SECRET).verify(token)).rejects.toThrow(TokenError);
  });

  it('rejects a tampered payload', async () => {
    const signer = createTokenSigner(SECRET);
    const { token } = await signer.sign(principal);
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    claims['role'] = 'SUPPORT';
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
    await expect(signer.verify(`${header}.${forged}.${signature}`)).rejects.toThrow(TokenError);
  });

  it('rejects an expired token', async () => {
    const signer = createTokenSigner(SECRET, 1);
    const expired = await new SignJWT({ role: 'MEMBER', mid: null, eid: null })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.userId)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3_600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(signer.verify(expired)).rejects.toThrow(TokenError);
  });

  it('rejects an unsigned token that claims the "none" algorithm', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: principal.userId,
        role: 'SUPPORT',
        iss: TOKEN_ISSUER,
        aud: TOKEN_AUDIENCE,
      }),
    ).toString('base64url');
    await expect(createTokenSigner(SECRET).verify(`${header}.${payload}.`)).rejects.toThrow(
      TokenError,
    );
  });

  it('rejects a token issued for another audience or issuer', async () => {
    const foreign = await new SignJWT({ role: 'MEMBER', mid: null, eid: null })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.userId)
      .setIssuer('somewhere-else')
      .setAudience('somewhere-else')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(createTokenSigner(SECRET).verify(foreign)).rejects.toThrow(TokenError);
  });

  it('refuses to build a signer with a short secret', () => {
    expect(() => createTokenSigner('too-short')).toThrow(TokenError);
  });
});

describe('bearerToken', () => {
  it('reads a bearer value and ignores anything else', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('  Bearer   abc  ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
