import type { FastifyInstance } from 'fastify';

/**
 * Signs in as a seeded identity and returns the bearer header. Tests go through the real login
 * route so a token used in a test is a token the API actually issues.
 */
export const SEEDED = {
  memberSarah: 'sarah.thompson@example.test',
  memberMiguel: 'miguel.alvarez@example.test',
  memberPriya: 'priya.raman@example.test',
  memberJonas: 'jonas.weber@example.test',
  adminNorthstar: 'admin.northstar@example.test',
  adminHarbor: 'admin.harbor@example.test',
  support: 'support.desk@example.test',
} as const;

export function seedPassword(): string {
  const password = process.env['SEED_USER_PASSWORD'];
  if (password === undefined || password === '') {
    throw new Error('SEED_USER_PASSWORD must be set to the value used when seeding.');
  }
  return password;
}

export async function authHeader(
  app: FastifyInstance,
  email: string,
): Promise<{ authorization: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: seedPassword() },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${res.statusCode}`);
  }
  return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
}
