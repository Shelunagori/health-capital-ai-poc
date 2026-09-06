import { hash, verify } from '@node-rs/argon2';

/**
 * Password handling. Argon2id only: passwords are never reversibly encrypted, never logged and
 * never returned. Parameters are stated explicitly rather than taken from library defaults so a
 * change is visible in review.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * A valid hash of a value no account uses. Verifying against it on a missing account keeps the
 * failure path's cost similar to the success path, so response time does not reveal whether an
 * address is registered.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Y2FuYXJ5c2FsdHZhbHVl$mIvJDHDvcVlG7hUAP1kIrjc7ZLQrM6Rf8YCVI4Bkr0Q';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A malformed or unsupported hash is a failed verification, never an error to the caller.
    return false;
  }
}

/** Spends comparable effort when no account matched, so timing does not disclose existence. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}

export function isArgon2idHash(value: string): boolean {
  return /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(value);
}
