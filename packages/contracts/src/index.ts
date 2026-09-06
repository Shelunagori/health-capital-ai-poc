import { z } from 'zod';

export * from './audit.js';
export * from './auth.js';
export * from './members.js';

/**
 * Shared request/response contracts between the API and the web client.
 * Only DTO schemas belong here; no business logic.
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  appEnv: z.enum(['local', 'test', 'demo']),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
