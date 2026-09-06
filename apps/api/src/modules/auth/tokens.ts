import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Principal, Role } from '@health-capital/contracts';

/**
 * Access tokens: HS256, short-lived, no refresh token and no server-side session table.
 *
 * Claims carry only what authorization needs: the user, the role and the single scope reference
 * for that role. No name, email or other personal data goes into a token, because a token is
 * readable by anyone holding it.
 */
export const TOKEN_TTL_SECONDS = 15 * 60;
export const TOKEN_ISSUER = 'health-capital-api';
export const TOKEN_AUDIENCE = 'health-capital-web';

const MIN_SECRET_BYTES = 32;

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface TokenSigner {
  sign(principal: Principal): Promise<{ token: string; expiresInSeconds: number }>;
  verify(token: string): Promise<Principal>;
}

interface AccessTokenClaims extends JWTPayload {
  role: Role;
  mid: string | null;
  eid: string | null;
}

function toKey(secret: string): Uint8Array {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new TokenError(`JWT secret must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  return bytes;
}

export function createTokenSigner(
  secret: string,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): TokenSigner {
  const key = toKey(secret);

  return {
    async sign(principal) {
      const token = await new SignJWT({
        role: principal.role,
        mid: principal.memberId,
        eid: principal.employerId,
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(principal.userId)
        .setIssuer(TOKEN_ISSUER)
        .setAudience(TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
      return { token, expiresInSeconds: ttlSeconds };
    },

    async verify(token) {
      let claims: AccessTokenClaims;
      try {
        const result = await jwtVerify<AccessTokenClaims>(token, key, {
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
          algorithms: ['HS256'],
        });
        claims = result.payload;
      } catch {
        // Expired, tampered, wrong algorithm, wrong issuer: all are simply "not authenticated".
        throw new TokenError('Invalid or expired token');
      }

      const { sub, role, mid, eid } = claims;
      if (
        typeof sub !== 'string' ||
        (role !== 'MEMBER' && role !== 'EMPLOYER_ADMIN' && role !== 'SUPPORT')
      ) {
        throw new TokenError('Invalid or expired token');
      }
      return {
        userId: sub,
        role,
        memberId: typeof mid === 'string' ? mid : null,
        employerId: typeof eid === 'string' ? eid : null,
      };
    },
  };
}

/** Reads a bearer token from an Authorization header value. Returns null when absent or malformed. */
export function bearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) return null;
  const match = /^Bearer (.+)$/.exec(headerValue.trim());
  return match?.[1]?.trim() ?? null;
}
