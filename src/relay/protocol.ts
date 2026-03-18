/**
 * Relay protocol helpers.
 *
 * Builds community event envelopes in the exact format expected by
 * the Umbra relay and client-side event handlers.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CommunityEventEnvelope, CommunityMessageSentEvent } from '../types';

/**
 * Build a community_event envelope for a bridged message.
 *
 * This is what the bridge bot sends via the relay to each community member.
 * It includes inline content fields so the client can render the message
 * without needing to look it up in the local WASM DB.
 */
export function buildCommunityMessageEnvelope(opts: {
  communityId: string;
  channelId: string;
  senderDid: string;
  content: string;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  messageId?: string;
  /** Platform user ID (e.g. Discord user ID) for ghost seat lookup. */
  platformUserId?: string;
  /** Platform identifier (e.g. "discord"). */
  platform?: string;
}): CommunityEventEnvelope {
  const messageId = opts.messageId ?? uuidv4();

  const event: CommunityMessageSentEvent = {
    type: 'communityMessageSent',
    channelId: opts.channelId,
    messageId,
    senderDid: opts.senderDid,
    content: opts.content,
    senderDisplayName: opts.senderDisplayName,
    senderAvatarUrl: opts.senderAvatarUrl ?? undefined,
    platformUserId: opts.platformUserId,
    platform: opts.platform,
  };

  return {
    envelope: 'community_event',
    version: 1,
    payload: {
      communityId: opts.communityId,
      event,
      senderDid: opts.senderDid,
      timestamp: Date.now(),
    },
  };
}

/**
 * Serialize an envelope to JSON string for sending via relay.
 */
export function serializeEnvelope(envelope: CommunityEventEnvelope): string {
  return JSON.stringify(envelope);
}
