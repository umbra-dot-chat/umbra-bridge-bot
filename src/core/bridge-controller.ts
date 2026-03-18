/**
 * Bridge controller — central orchestrator for Discord ↔ Umbra bridging.
 *
 * Wires together all modules:
 * - Discord client (Gateway events)
 * - Webhook manager (sending to Discord)
 * - Relay connection (WebSocket events + sending)
 * - Channel map (bidirectional lookup)
 * - Seat resolver (Discord user → DID)
 * - Echo guard (loop prevention)
 * - Message transform (content conversion)
 *
 * Manages multiple bridge configs (one per community/guild pair).
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../util/logger';
import { DiscordClient } from '../discord/client';
import { WebhookManager } from '../discord/webhook-manager';
import { RelayConnection } from '../relay/connection';
import { RelayApiClient } from '../relay/api-client';
import { buildCommunityMessageEnvelope, serializeEnvelope } from '../relay/protocol';
import { ChannelMap } from '../bridge/channel-map';
import { SeatResolver } from '../bridge/seat-resolver';
import { EchoGuard } from '../bridge/echo-guard';
import { discordToUmbra, umbraToDiscord } from '../bridge/message-transform';
import type {
  BridgeConfig,
  BridgeIdentity,
  DiscordToUmbraMessage,
  CommunityEventEnvelope,
  CommunityMessageSentEvent,
} from '../types';
import type { BridgeBotConfig } from '../config';

interface ActiveBridge {
  config: BridgeConfig;
  channelMap: ChannelMap;
  seatResolver: SeatResolver;
}

export class BridgeController {
  private discord: DiscordClient;
  private webhookManager: WebhookManager;
  private relay: RelayConnection;
  private relayApi: RelayApiClient;
  private echoGuard: EchoGuard;
  private identity: BridgeIdentity;
  private botConfig: BridgeBotConfig;
  private log = getLogger().child({ module: 'controller' });

  /** Active bridges keyed by guildId (Discord → Umbra lookups). */
  private bridgesByGuild = new Map<string, ActiveBridge>();
  /** Active bridges keyed by communityId (Umbra → Discord lookups). */
  private bridgesByCommunity = new Map<string, ActiveBridge>();

  /** Polling timer for config refresh. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(botConfig: BridgeBotConfig, identity: BridgeIdentity) {
    this.botConfig = botConfig;
    this.identity = identity;

    // Initialize Discord client
    this.discord = new DiscordClient();
    this.webhookManager = new WebhookManager(
      this.discord.raw,
      (id) => this.discord.registerWebhookId(id),
    );

    // Initialize relay connection
    this.relay = new RelayConnection({
      url: botConfig.relayUrl,
      did: identity.did,
      keepaliveInterval: botConfig.keepaliveInterval,
      maxReconnectDelay: botConfig.maxReconnectDelay,
    });

    // Initialize relay API client
    this.relayApi = new RelayApiClient(botConfig.relayApiUrl);

    // Initialize echo guard
    this.echoGuard = new EchoGuard(identity.did);

    this.setupEventHandlers();
  }

  /** Start the bridge controller. */
  async start(): Promise<void> {
    this.log.info({ did: this.identity.did }, 'Starting bridge controller');

    // Load bridge configs from relay
    await this.loadConfigs();

    // Connect to Discord and relay in parallel
    await Promise.all([
      this.discord.login(this.botConfig.discordBotToken),
      this.connectRelay(),
    ]);

    // Start config polling
    this.pollTimer = setInterval(async () => {
      try {
        await this.loadConfigs();
      } catch (err) {
        this.log.error({ err }, 'Config poll failed');
      }
    }, this.botConfig.configPollInterval);

    this.log.info('Bridge controller started');
  }

  /** Gracefully shut down. */
  async stop(): Promise<void> {
    this.log.info('Stopping bridge controller');

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.echoGuard.destroy();
    this.relay.disconnect();
    await this.discord.destroy();

    this.log.info('Bridge controller stopped');
  }

  // ── Config Loading ─────────────────────────────────────────────────────

  private async loadConfigs(): Promise<void> {
    const summaries = await this.relayApi.listBridges();
    if (!summaries.length) {
      this.log.debug('No bridge configs found');
      return;
    }

    for (const summary of summaries) {
      if (!summary.enabled) {
        // Remove disabled bridges
        this.bridgesByGuild.delete(summary.guildId);
        this.bridgesByCommunity.delete(summary.communityId);
        continue;
      }

      // Skip if already loaded and not updated
      const existing = this.bridgesByCommunity.get(summary.communityId);
      if (existing && existing.config.updatedAt >= summary.updatedAt) {
        continue;
      }

      // Fetch full config
      const config = await this.relayApi.getBridge(summary.communityId);
      if (!config) continue;

      // Ensure the bridge bot's DID is registered in the config
      if (!config.bridgeDid || config.bridgeDid !== this.identity.did) {
        this.log.info(
          { communityId: config.communityId, bridgeDid: this.identity.did },
          'Registering bridge DID in config',
        );
        await this.relayApi.registerBridge({
          communityId: config.communityId,
          guildId: config.guildId,
          channels: config.channels,
          seats: config.seats,
          memberDids: config.memberDids,
          bridgeDid: this.identity.did,
        });
        config.bridgeDid = this.identity.did;
      }

      // Ensure the bridge bot's DID is in the memberDids list
      if (!config.memberDids.includes(this.identity.did)) {
        config.memberDids.push(this.identity.did);
        this.log.info(
          {
            communityId: config.communityId,
            bridgeDid: this.identity.did,
            members: config.memberDids.length,
          },
          'Adding bridge DID to member list',
        );
        await this.relayApi.updateMembers(config.communityId, config.memberDids);
      }

      const bridge: ActiveBridge = {
        config,
        channelMap: new ChannelMap(config.channels),
        seatResolver: new SeatResolver(this.identity.did, config.seats),
      };

      this.bridgesByGuild.set(config.guildId, bridge);
      this.bridgesByCommunity.set(config.communityId, bridge);

      this.log.info(
        {
          communityId: config.communityId,
          guildId: config.guildId,
          channels: config.channels.length,
          seats: config.seats.length,
          members: config.memberDids.length,
        },
        'Loaded bridge config',
      );
    }
  }

  private async connectRelay(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.relay.once('connected', () => resolve());
      this.relay.connect();

      // Resolve after timeout even if not connected (will retry)
      setTimeout(() => resolve(), 10000);
    });
  }

  // ── Event Wiring ───────────────────────────────────────────────────────

  private setupEventHandlers(): void {
    // Discord → Umbra
    this.discord.on('message', (msg) => this.handleDiscordMessage(msg));

    // Umbra → Discord
    this.relay.on('community_event', (envelope, fromDid) => {
      this.handleRelayEvent(envelope, fromDid);
    });

    // Logging
    this.relay.on('connected', () => {
      this.log.info('Relay connected');
    });

    this.relay.on('disconnected', () => {
      this.log.warn('Relay disconnected');
    });

    this.relay.on('error', (err) => {
      this.log.error({ err }, 'Relay error');
    });

    this.discord.on('error', (err) => {
      this.log.error({ err }, 'Discord error');
    });
  }

  // ── Discord → Umbra ────────────────────────────────────────────────────

  private handleDiscordMessage(msg: DiscordToUmbraMessage): void {
    // Find the bridge for this guild
    const bridge = this.bridgesByGuild.get(msg.guildId);
    if (!bridge) {
      this.log.debug(
        { guildId: msg.guildId, bridgedGuilds: Array.from(this.bridgesByGuild.keys()) },
        'Discord message from non-bridged guild',
      );
      return;
    }

    // Look up the Umbra channel
    const umbraChannelId = bridge.channelMap.getUmbraChannelId(msg.discordChannelId);
    if (!umbraChannelId) {
      this.log.debug(
        { discordChannelId: msg.discordChannelId },
        'Discord message from non-bridged channel',
      );
      return;
    }

    // Resolve the sender's Umbra identity
    const seat = bridge.seatResolver.resolveDiscordUser(
      msg.discordUserId,
      msg.discordUsername,
      msg.avatarUrl,
    );

    // Transform content
    const content = discordToUmbra(msg.content);
    if (!content) return; // Empty after transform

    // Generate message ID
    const messageId = uuidv4();

    // Build community event envelope (include Discord user ID for ghost seat lookup)
    const envelope = buildCommunityMessageEnvelope({
      communityId: bridge.config.communityId,
      channelId: umbraChannelId,
      senderDid: seat.did,
      content,
      senderDisplayName: seat.displayName,
      senderAvatarUrl: seat.avatarUrl,
      messageId,
      platformUserId: msg.discordUserId,
      platform: 'discord',
    });

    const payload = serializeEnvelope(envelope);

    // Fan out to all community members
    let sent = 0;
    let failed = 0;
    const targetMembers = bridge.config.memberDids.filter((d) => d !== this.identity.did);

    for (const memberDid of targetMembers) {
      if (this.relay.sendToDid(memberDid, payload)) {
        sent++;
      } else {
        failed++;
        this.log.warn({ memberDid }, 'Failed to send bridged message to member (relay not connected?)');
      }
    }

    // Record for echo guard
    this.echoGuard.recordBridged(messageId);

    if (sent === 0 && targetMembers.length > 0) {
      this.log.warn(
        {
          direction: 'discord→umbra',
          guild: msg.guildId,
          channel: msg.discordChannelId,
          sender: msg.discordUsername,
          totalMembers: bridge.config.memberDids.length,
          targetMembers: targetMembers.length,
          relayConnected: this.relay.connected,
        },
        'Bridged message sent to 0 recipients! Check relay connection.',
      );
    }

    this.log.info(
      {
        direction: 'discord→umbra',
        guild: msg.guildId,
        channel: msg.discordChannelId,
        sender: msg.discordUsername,
        senderDid: seat.did,
        ghost: seat.isGhost,
        recipients: sent,
        failed,
        messageId,
      },
      'Bridged message Discord → Umbra',
    );
  }

  // ── Umbra → Discord ────────────────────────────────────────────────────

  private handleRelayEvent(envelope: CommunityEventEnvelope, fromDid: string): void {
    const { payload } = envelope;
    const event = payload.event;

    // Only handle communityMessageSent events
    if (event.type !== 'communityMessageSent') return;

    const msgEvent = event as CommunityMessageSentEvent;

    // Find the bridge for this community
    const bridge = this.bridgesByCommunity.get(payload.communityId);
    if (!bridge) return; // Not a bridged community

    // Echo guard: skip if from the bridge bot or recently bridged
    if (!this.echoGuard.shouldBridgeToDiscord(payload.senderDid, msgEvent.messageId)) {
      return;
    }

    // Look up the Discord channel
    const discordChannelId = bridge.channelMap.getDiscordChannelId(msgEvent.channelId);
    if (!discordChannelId) return; // Not a bridged channel

    // Get content from inline field
    const content = msgEvent.content;
    if (!content) {
      this.log.debug(
        { communityId: payload.communityId, messageId: msgEvent.messageId },
        'No inline content in event, cannot bridge',
      );
      return;
    }

    // Transform content
    const discordContent = umbraToDiscord(content);
    if (!discordContent) return;

    // Resolve sender display name
    const displayName = msgEvent.senderDisplayName ?? payload.senderDid.slice(0, 16);
    const avatarUrl = msgEvent.senderAvatarUrl ?? null;

    // Send to Discord via webhook
    this.webhookManager
      .sendAsUser(discordChannelId, discordContent, displayName, avatarUrl)
      .then(() => {
        this.echoGuard.recordBridged(msgEvent.messageId);

        this.log.debug(
          {
            direction: 'umbra→discord',
            community: payload.communityId,
            channel: msgEvent.channelId,
            sender: displayName,
            messageId: msgEvent.messageId,
          },
          'Bridged message Umbra → Discord',
        );
      })
      .catch((err) => {
        this.log.error({ err, messageId: msgEvent.messageId }, 'Failed to bridge to Discord');
      });
  }
}
