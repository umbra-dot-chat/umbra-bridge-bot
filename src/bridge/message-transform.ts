/**
 * Message content transformation between Discord and Umbra.
 *
 * Discord → Umbra:
 *   - Convert Discord user mentions (<@userId>) to display names
 *   - Convert channel mentions (<#channelId>) to #channel-name
 *   - Strip Discord-specific markdown that doesn't render in Umbra
 *
 * Umbra → Discord:
 *   - Passthrough (community messages are already plaintext)
 */

import type { Client } from 'discord.js';

/**
 * Transform a Discord message for display in Umbra.
 *
 * discord.js already provides `message.cleanContent` which handles
 * most transformations. This function handles any additional cleanup.
 */
export function discordToUmbra(content: string): string {
  // cleanContent from discord.js already converts:
  // - @user mentions → @DisplayName
  // - @role mentions → @RoleName
  // - #channel mentions → #channel-name
  // - @everyone / @here → @everyone / @here

  // Strip any remaining raw mention patterns that cleanContent missed
  let cleaned = content;

  // Remove animated emoji format: <a:name:id> → :name:
  cleaned = cleaned.replace(/<a?:(\w+):\d+>/g, ':$1:');

  // Remove timestamp formatting: <t:1234567890:R> → the number
  cleaned = cleaned.replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (_match, ts) => {
    try {
      return new Date(parseInt(ts, 10) * 1000).toLocaleString();
    } catch {
      return ts;
    }
  });

  return cleaned.trim();
}

/**
 * Transform an Umbra message for display in Discord.
 *
 * Currently a passthrough since Umbra community messages are plaintext.
 * Future: could convert Umbra markdown to Discord markdown if formats differ.
 */
export function umbraToDiscord(content: string): string {
  return content;
}
