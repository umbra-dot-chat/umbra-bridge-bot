/**
 * Bridge bot configuration.
 *
 * Reads from environment variables with sensible defaults for
 * co-deployment with the relay (same docker-compose network).
 */

import dotenv from 'dotenv';

dotenv.config();

export interface BridgeBotConfig {
  /** Discord bot token (required). */
  discordBotToken: string;
  /** Relay WebSocket URL for message exchange. */
  relayUrl: string;
  /** Relay HTTP URL for REST API calls. */
  relayApiUrl: string;
  /** Log level (trace, debug, info, warn, error, fatal). */
  logLevel: string;
  /** Shared data directory for reading relay bridge configs (read-only). */
  dataDir: string;
  /** Bridge-specific writable directory for identity persistence. */
  bridgeDataDir: string;
  /** How often to poll relay for config changes (ms). */
  configPollInterval: number;
  /** WebSocket keepalive ping interval (ms). */
  keepaliveInterval: number;
  /** Max reconnection delay for WebSocket (ms). */
  maxReconnectDelay: number;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): BridgeBotConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  return {
    discordBotToken: requireEnv('DISCORD_BOT_TOKEN'),
    relayUrl: process.env.RELAY_URL ?? 'ws://localhost:8080/ws',
    relayApiUrl: process.env.RELAY_API_URL ?? 'http://localhost:8080',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    dataDir,
    bridgeDataDir: process.env.BRIDGE_DATA_DIR ?? dataDir,
    configPollInterval: parseInt(process.env.CONFIG_POLL_INTERVAL ?? '30000', 10),
    keepaliveInterval: parseInt(process.env.KEEPALIVE_INTERVAL ?? '30000', 10),
    maxReconnectDelay: parseInt(process.env.MAX_RECONNECT_DELAY ?? '60000', 10),
  };
}
