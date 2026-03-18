/**
 * Bidirectional channel mapping.
 *
 * Maps Discord channel IDs ↔ Umbra channel IDs for a specific community/guild.
 * Loaded from bridge config at startup and refreshed on config changes.
 */

import type { BridgeChannel } from '../types';

export class ChannelMap {
  /** Discord channel ID → Umbra channel ID */
  private discordToUmbra = new Map<string, string>();
  /** Umbra channel ID → Discord channel ID */
  private umbraToDiscord = new Map<string, string>();
  /** Channel names by Discord channel ID */
  private names = new Map<string, string>();

  constructor(channels: BridgeChannel[] = []) {
    this.load(channels);
  }

  /** Reload mappings from config. */
  load(channels: BridgeChannel[]): void {
    this.discordToUmbra.clear();
    this.umbraToDiscord.clear();
    this.names.clear();

    for (const ch of channels) {
      this.discordToUmbra.set(ch.discordChannelId, ch.umbraChannelId);
      this.umbraToDiscord.set(ch.umbraChannelId, ch.discordChannelId);
      this.names.set(ch.discordChannelId, ch.name);
    }
  }

  /** Look up the Umbra channel ID for a Discord channel. */
  getUmbraChannelId(discordChannelId: string): string | null {
    return this.discordToUmbra.get(discordChannelId) ?? null;
  }

  /** Look up the Discord channel ID for an Umbra channel. */
  getDiscordChannelId(umbraChannelId: string): string | null {
    return this.umbraToDiscord.get(umbraChannelId) ?? null;
  }

  /** Get the channel name (from Discord). */
  getChannelName(discordChannelId: string): string | null {
    return this.names.get(discordChannelId) ?? null;
  }

  /** Whether a Discord channel is bridged. */
  hasDiscordChannel(discordChannelId: string): boolean {
    return this.discordToUmbra.has(discordChannelId);
  }

  /** Whether an Umbra channel is bridged. */
  hasUmbraChannel(umbraChannelId: string): boolean {
    return this.umbraToDiscord.has(umbraChannelId);
  }

  /** Number of bridged channels. */
  get size(): number {
    return this.discordToUmbra.size;
  }
}
