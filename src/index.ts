/**
 * Umbra Bridge Bot — Entry point.
 *
 * Discord ↔ Umbra bidirectional message bridge.
 * Connects to Discord Gateway and Umbra Relay WebSocket,
 * proxying messages between platforms.
 */

import { loadConfig } from './config';
import { initLogger, getLogger } from './util/logger';
import { loadOrCreateIdentity } from './util/identity';
import { BridgeController } from './core/bridge-controller';

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();

  // Initialize logging
  initLogger(config.logLevel);
  const log = getLogger();

  log.info({
    relayUrl: config.relayUrl,
    relayApiUrl: config.relayApiUrl,
    dataDir: config.dataDir,
  }, 'Umbra Bridge Bot starting');

  // Load or generate identity (uses bridge-specific writable volume)
  const identity = await loadOrCreateIdentity(config.bridgeDataDir);
  log.info({ did: identity.did }, 'Bridge identity ready');

  // Create and start the bridge controller
  const controller = new BridgeController(config, identity);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received');
    await controller.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Catch unhandled errors
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });

  // Start
  await controller.start();

  log.info('Umbra Bridge Bot is running');
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
