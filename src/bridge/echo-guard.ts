/**
 * Echo guard — prevents message loops between Discord and Umbra.
 *
 * Three layers of protection:
 * 1. **Webhook ID set** — skip Discord messages from our own webhooks
 * 2. **Bot flag** — skip messages from any bot (message.author.bot)
 * 3. **Bridge DID** — skip relay events where senderDid === bridgeDid
 *
 * Layer 1 and 2 are handled in DiscordClient. This module handles
 * layer 3 and provides a unified guard check for the controller.
 */

import { getLogger } from '../util/logger';

export class EchoGuard {
  private bridgeDid: string;
  private log = getLogger().child({ module: 'echo-guard' });

  /** Recent message IDs we've bridged (dedup within time window). */
  private recentIds = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(bridgeDid: string) {
    this.bridgeDid = bridgeDid;

    // Clean up recent IDs every 5 minutes
    this.cleanupTimer = setInterval(() => {
      this.recentIds.clear();
    }, 5 * 60 * 1000);
  }

  /** Update the bridge DID (e.g. after identity load). */
  setBridgeDid(did: string): void {
    this.bridgeDid = did;
  }

  /**
   * Check if a relay community event should be bridged to Discord.
   *
   * Returns false (skip) if:
   * - senderDid matches the bridge bot's DID
   * - messageId was recently bridged (dedup)
   */
  shouldBridgeToDiscord(senderDid: string, messageId: string): boolean {
    // Layer 3: skip messages from the bridge bot itself
    if (senderDid === this.bridgeDid) {
      this.log.debug({ senderDid, messageId }, 'Skipping own message (bridge DID match)');
      return false;
    }

    // Dedup: skip if we recently bridged this message ID
    if (this.recentIds.has(messageId)) {
      this.log.debug({ messageId }, 'Skipping duplicate message');
      return false;
    }

    return true;
  }

  /**
   * Record a message ID as recently bridged.
   *
   * Called after successfully bridging a message in either direction.
   */
  recordBridged(messageId: string): void {
    this.recentIds.add(messageId);
  }

  /** Cleanup on shutdown. */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.recentIds.clear();
  }
}
