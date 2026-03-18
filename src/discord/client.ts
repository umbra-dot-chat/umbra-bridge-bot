/**
 * Discord Gateway client.
 *
 * Manages the discord.js client with the minimal set of intents needed
 * for message bridging. Emits bridge-relevant events to the controller.
 */

import { Client, GatewayIntentBits, Events, type Message, Partials } from 'discord.js';
import { EventEmitter } from 'events';
import { getLogger } from '../util/logger';
import type { DiscordToUmbraMessage } from '../types';

export declare interface DiscordClient {
  on(event: 'message', listener: (msg: DiscordToUmbraMessage) => void): this;
  on(event: 'ready', listener: (guilds: string[]) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class DiscordClient extends EventEmitter {
  private client: Client;
  private log = getLogger().child({ module: 'discord' });

  /** Set of webhook IDs we manage (for echo guard). */
  private ownWebhookIds = new Set<string>();

  constructor() {
    super();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Message],
    });

    this.setupEventHandlers();
  }

  /** Connect to Discord Gateway. */
  async login(token: string): Promise<void> {
    this.log.info('Logging into Discord');
    await this.client.login(token);
  }

  /** Gracefully disconnect. */
  async destroy(): Promise<void> {
    this.log.info('Disconnecting from Discord');
    this.client.destroy();
  }

  /** Register a webhook ID as ours (for echo guard). */
  registerWebhookId(id: string): void {
    this.ownWebhookIds.add(id);
  }

  /** Get the underlying discord.js client (for webhook manager). */
  get raw(): Client {
    return this.client;
  }

  // ── Event Handlers ─────────────────────────────────────────────────────

  private setupEventHandlers(): void {
    this.client.on(Events.ClientReady, (client) => {
      const guilds = client.guilds.cache.map((g) => g.id);
      this.log.info(
        { user: client.user.tag, guilds: guilds.length },
        'Discord bot ready',
      );
      this.emit('ready', guilds);
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message);
    });

    this.client.on(Events.Error, (err) => {
      this.log.error({ err }, 'Discord client error');
      this.emit('error', err);
    });
  }

  private handleMessage(message: Message): void {
    // Skip bot messages
    if (message.author.bot) return;

    // Skip webhook messages from our own webhooks (echo guard layer 1)
    if (message.webhookId && this.ownWebhookIds.has(message.webhookId)) return;

    // Skip DMs
    if (!message.guild) return;

    // Skip empty messages (e.g. embeds only)
    if (!message.content && !message.cleanContent) return;

    const bridgeMsg: DiscordToUmbraMessage = {
      guildId: message.guild.id,
      discordChannelId: message.channel.id,
      discordUserId: message.author.id,
      discordUsername: message.author.displayName ?? message.author.username,
      avatarUrl: message.author.displayAvatarURL({ size: 128 }),
      content: message.cleanContent || message.content,
      messageId: message.id,
    };

    this.emit('message', bridgeMsg);
  }
}
