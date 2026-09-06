import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './platform/config.js';
import { SAFE_LOG_FIELD_NAMES, createLogger } from './platform/logger.js';
import { classificationRedactPaths } from './modules/classification/index.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Configuration failures are the one place we write directly to stderr: no logger exists yet.
    process.stderr.write(
      `${err instanceof ConfigError ? err.message : 'Failed to load configuration'}\n`,
    );
    process.exit(1);
  }

  const logger = createLogger({
    level: config.logLevel,
    pretty: config.appEnv === 'local',
    // Second layer only. The primary control is the typed SafeLogFields shape.
    extraRedactPaths: classificationRedactPaths(SAFE_LOG_FIELD_NAMES),
  });
  const app = await buildApp({ config, logger });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ action: 'shutdown', code: signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  logger.info({ action: 'startup', code: config.appEnv }, 'api listening');
}

void main();
