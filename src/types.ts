/**
 * Bridge bot shared types.
 *
 * These mirror the relay's BridgeConfig JSON schema so the bot
 * can read configs from the relay's REST API.
 */

// ── Bridge Config (matches relay's /api/bridge/:id response) ─────────────────

export interface BridgeChannel {
  discordChannelId: string;
  umbraChannelId: string;
  name: string;
}

export interface BridgeSeat {
  discordUserId: string;
  discordUsername: string;
  avatarUrl: string | null;
  /** The Umbra DID for this seat, if claimed. */
  seatDid: string | null;
}

export interface BridgeConfig {
  communityId: string;
  guildId: string;
  enabled: boolean;
  /** The DID the bridge bot uses for this community. */
  bridgeDid: string | null;
  channels: BridgeChannel[];
  seats: BridgeSeat[];
  /** DIDs of all community members (for fan-out delivery). */
  memberDids: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BridgeConfigSummary {
  communityId: string;
  guildId: string;
  enabled: boolean;
  channelCount: number;
  seatCount: number;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

// ── Relay Protocol ───────────────────────────────────────────────────────────

/** Message sent over WebSocket to the relay. */
export type RelayOutbound =
  | { type: 'register'; did: string }
  | { type: 'send'; to_did: string; payload: string }
  | { type: 'ping' };

/** Message received from the relay over WebSocket. */
export type RelayInbound =
  | { type: 'registered'; did: string }
  | { type: 'message'; from_did: string; payload: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ── Community Event Envelope ─────────────────────────────────────────────────

export interface CommunityEventEnvelope {
  envelope: 'community_event';
  version: 1;
  payload: CommunityEvent;
}

export interface CommunityEvent {
  communityId: string;
  event: CommunityEventData;
  senderDid: string;
  timestamp: number;
}

export type CommunityEventData =
  | CommunityMessageSentEvent
  | { type: string; [key: string]: unknown };

export interface CommunityMessageSentEvent {
  type: 'communityMessageSent';
  channelId: string;
  messageId: string;
  senderDid: string;
  /** Inline content for bridge messages (bypasses WASM DB lookup). */
  content?: string;
  /** Display name of sender (for bridge identity). */
  senderDisplayName?: string;
  /** Avatar URL of sender (for bridge identity). */
  senderAvatarUrl?: string;
  /** Platform user ID (e.g. Discord user ID) for ghost seat lookup on the client. */
  platformUserId?: string;
  /** Platform identifier (e.g. "discord") for ghost seat lookup. */
  platform?: string;
}

// ── Bridge Bot Identity ──────────────────────────────────────────────────────

export interface BridgeIdentity {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

// ── Internal Message Types ───────────────────────────────────────────────────

/** A message flowing from Discord into Umbra. */
export interface DiscordToUmbraMessage {
  guildId: string;
  discordChannelId: string;
  discordUserId: string;
  discordUsername: string;
  avatarUrl: string | null;
  content: string;
  messageId: string;
}

/** A message flowing from Umbra into Discord. */
export interface UmbraToDiscordMessage {
  communityId: string;
  umbraChannelId: string;
  senderDid: string;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  content: string;
  messageId: string;
}
