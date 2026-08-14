import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * Process entry point. Everything it does is start and stop cleanly — the
 * application itself is built by `buildServer`, which the tests drive directly.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { app, container } = await buildServer(config);

  if (config.watcherEnabled) {
    container.watcher.start();
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    container.watcher.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { rules: container.registry.size, watcher: config.watcherEnabled },
    'accessly api ready',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start the Accessly API:', error);
  process.exit(1);
});
