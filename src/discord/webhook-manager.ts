/**
 * Discord webhook manager.
 *
 * Manages per-channel webhooks for sending messages to Discord with
 * custom usernames and avatars (Umbra user identity).
 */

import { type Client, type Webhook, type TextChannel } from 'discord.js';
import { getLogger } from '../util/logger';

const WEBHOOK_NAME = 'Umbra Bridge';

export class WebhookManager {
  private webhooks = new Map<string, Webhook>();
  private client: Client;
  private log = getLogger().child({ module: 'webhooks' });
  /** Callback to register webhook IDs for echo guard. */
  private onWebhookCreated?: (id: string) => void;

  constructor(client: Client, onWebhookCreated?: (id: string) => void) {
    this.client = client;
    this.onWebhookCreated = onWebhookCreated;
  }

  /**
   * Send a message to a Discord channel as a specific user.
   *
   * Uses webhooks to show the Umbra user's name and avatar.
   */
  async sendAsUser(
    channelId: string,
    content: string,
    displayName: string,
    avatarUrl: string | null,
  ): Promise<void> {
    const webhook = await this.getOrCreateWebhook(channelId);
    if (!webhook) {
      this.log.warn({ channelId }, 'Cannot send: no webhook available');
      return;
    }

    try {
      await webhook.send({
        content,
        username: displayName,
        avatarURL: avatarUrl ?? undefined,
      });
    } catch (err) {
      this.log.error({ err, channelId, displayName }, 'Failed to send webhook message');

      // If webhook was deleted externally, clear cache and retry once
      this.webhooks.delete(channelId);
      try {
        const retryWebhook = await this.getOrCreateWebhook(channelId);
        if (retryWebhook) {
          await retryWebhook.send({
            content,
            username: displayName,
            avatarURL: avatarUrl ?? undefined,
          });
        }
      } catch (retryErr) {
        this.log.error({ err: retryErr, channelId }, 'Retry failed');
      }
    }
  }

  /**
   * Get or create the bridge webhook for a channel.
   *
   * First checks cache, then fetches existing webhooks from Discord,
   * and finally creates one if none exists.
   */
  private async getOrCreateWebhook(channelId: string): Promise<Webhook | null> {
    // Check cache
    const cached = this.webhooks.get(channelId);
    if (cached) return cached;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('fetchWebhooks' in channel)) {
        this.log.warn({ channelId }, 'Channel not found or not a text channel');
        return null;
      }

      const textChannel = channel as TextChannel;

      // Check for existing Umbra Bridge webhook
      const existing = await textChannel.fetchWebhooks();
      const ours = existing.find(
        (wh) => wh.name === WEBHOOK_NAME && wh.owner?.id === this.client.user?.id,
      );

      if (ours) {
        this.webhooks.set(channelId, ours);
        this.onWebhookCreated?.(ours.id);
        this.log.debug({ channelId, webhookId: ours.id }, 'Found existing webhook');
        return ours;
      }

      // Create new webhook
      const webhook = await textChannel.createWebhook({
        name: WEBHOOK_NAME,
        reason: 'Umbra bridge bot — proxies messages between Discord and Umbra',
      });

      this.webhooks.set(channelId, webhook);
      this.onWebhookCreated?.(webhook.id);
      this.log.info({ channelId, webhookId: webhook.id }, 'Created new webhook');

      return webhook;
    } catch (err) {
      this.log.error({ err, channelId }, 'Failed to get/create webhook');
      return null;
    }
  }

  /** Clear the webhook cache (e.g. on config reload). */
  clearCache(): void {
    this.webhooks.clear();
  }
}
