import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

export const API_VERSION = '0.1.0';

/**
 * Liveness only: the process is up and configuration was accepted. Touches no dependency.
 * Readiness (`/ready`, database + migrations) arrives with the data layer milestone.
 */
export function registerHealth(app: FastifyInstance, config: AppConfig): void {
  app.get('/health', () => ({
    status: 'ok' as const,
    appEnv: config.appEnv,
    version: API_VERSION,
  }));
}
