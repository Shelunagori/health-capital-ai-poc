import { describe, expect, it } from 'vitest';
import { ARGON2_OPTIONS, hashPassword, isArgon2idHash, verifyPassword } from './password.js';

describe('password handling', () => {
  it('produces an Argon2id hash that is not the password', async () => {
    const password = 'a-synthetic-development-password';
    const hash = await hashPassword(password);
    expect(isArgon2idHash(hash)).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(hash, password)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-batteryX')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts each hash, so the same password stores differently', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);
    expect(first).not.toBe(second);
  });

  it('treats a malformed stored hash as a failed verification, not an error', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    // A password stored in plaintext by mistake must never verify.
    await expect(verifyPassword('plaintext-password', 'plaintext-password')).resolves.toBe(false);
  });

  it('states its cost parameters explicitly', () => {
    expect(ARGON2_OPTIONS).toEqual({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  });

  it('recognises only Argon2id hashes', () => {
    expect(isArgon2idHash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')).toBe(false);
    expect(isArgon2idHash('$2b$12$abcdefghijklmnopqrstuv')).toBe(false);
  });
});
