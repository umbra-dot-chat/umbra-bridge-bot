/**
 * Seat resolver — maps Discord users to Umbra identities.
 *
 * When a Discord user sends a message:
 * - If their seat has a `seatDid` (claimed), use that DID as the sender
 * - Otherwise, use the bridge bot's own DID (ghost seat / unclaimed)
 *
 * Display names and avatars always come from Discord regardless of claim status.
 */

import type { BridgeSeat } from '../types';

export interface ResolvedSeat {
  /** DID to use as the sender (either the user's own DID or the bridge bot's). */
  did: string;
  /** Discord display name. */
  displayName: string;
  /** Discord avatar URL. */
  avatarUrl: string | null;
  /** Whether this is a ghost seat (unclaimed, using bridge DID). */
  isGhost: boolean;
}

export class SeatResolver {
  /** Discord user ID → BridgeSeat */
  private seats = new Map<string, BridgeSeat>();
  /** DID → Discord user ID (for reverse lookups) */
  private didToDiscord = new Map<string, string>();
  /** The bridge bot's own DID (used for ghost seats). */
  private bridgeDid: string;

  constructor(bridgeDid: string, seats: BridgeSeat[] = []) {
    this.bridgeDid = bridgeDid;
    this.load(seats);
  }

  /** Reload seat mappings from config. */
  load(seats: BridgeSeat[]): void {
    this.seats.clear();
    this.didToDiscord.clear();

    for (const seat of seats) {
      this.seats.set(seat.discordUserId, seat);
      if (seat.seatDid) {
        this.didToDiscord.set(seat.seatDid, seat.discordUserId);
      }
    }
  }

  /** Update the bridge DID. */
  setBridgeDid(did: string): void {
    this.bridgeDid = did;
  }

  /**
   * Resolve a Discord user to an Umbra identity.
   *
   * Falls back to the message's Discord info if no seat mapping exists.
   */
  resolveDiscordUser(
    discordUserId: string,
    fallbackName: string,
    fallbackAvatar: string | null,
  ): ResolvedSeat {
    const seat = this.seats.get(discordUserId);

    if (seat) {
      return {
        did: seat.seatDid ?? this.bridgeDid,
        displayName: seat.discordUsername,
        avatarUrl: seat.avatarUrl,
        isGhost: !seat.seatDid,
      };
    }

    // Unknown Discord user — not in seat list, use bridge DID
    return {
      did: this.bridgeDid,
      displayName: fallbackName,
      avatarUrl: fallbackAvatar,
      isGhost: true,
    };
  }

  /**
   * Look up a Discord user by their Umbra DID.
   *
   * Used for Umbra → Discord direction to find the sender's Discord identity.
   */
  resolveUmbraDid(did: string): BridgeSeat | null {
    const discordUserId = this.didToDiscord.get(did);
    if (!discordUserId) return null;
    return this.seats.get(discordUserId) ?? null;
  }

  /** Number of seats. */
  get size(): number {
    return this.seats.size;
  }
}
