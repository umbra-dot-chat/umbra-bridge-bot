/**
 * Relay REST API client for bridge config management.
 *
 * Fetches bridge configs from the relay's HTTP API so the bridge bot
 * knows which communities/guilds to bridge.
 */

import { getLogger } from '../util/logger';
import type { BridgeConfig, BridgeConfigSummary } from '../types';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class RelayApiClient {
  private baseUrl: string;
  private log = getLogger().child({ module: 'relay-api' });

  constructor(baseUrl: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** List all bridge configs (summaries). */
  async listBridges(): Promise<BridgeConfigSummary[]> {
    const resp = await this.get<BridgeConfigSummary[]>('/api/bridge/list');
    return resp ?? [];
  }

  /** Get full bridge config for a community. */
  async getBridge(communityId: string): Promise<BridgeConfig | null> {
    return this.get<BridgeConfig>(`/api/bridge/${communityId}`);
  }

  /** Register or update a bridge config. */
  async registerBridge(config: {
    communityId: string;
    guildId: string;
    channels: BridgeConfig['channels'];
    seats: BridgeConfig['seats'];
    memberDids: string[];
    bridgeDid?: string;
  }): Promise<BridgeConfig | null> {
    return this.post<BridgeConfig>('/api/bridge/register', config);
  }

  /** Update the member DIDs list for a bridge. */
  async updateMembers(communityId: string, memberDids: string[]): Promise<BridgeConfig | null> {
    return this.put<BridgeConfig>(`/api/bridge/${communityId}/members`, { memberDids });
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`);
      if (!res.ok) {
        this.log.warn({ path, status: res.status }, 'API request failed');
        return null;
      }
      const body = (await res.json()) as ApiResponse<T>;
      if (!body.ok) {
        this.log.warn({ path, error: body.error }, 'API returned error');
        return null;
      }
      return body.data ?? null;
    } catch (err) {
      this.log.error({ err, path }, 'API request error');
      return null;
    }
  }

  private async post<T>(path: string, data: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        this.log.warn({ path, status: res.status }, 'API POST failed');
        return null;
      }
      const body = (await res.json()) as ApiResponse<T>;
      if (!body.ok) {
        this.log.warn({ path, error: body.error }, 'API POST returned error');
        return null;
      }
      return body.data ?? null;
    } catch (err) {
      this.log.error({ err, path }, 'API POST error');
      return null;
    }
  }

  private async put<T>(path: string, data: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        this.log.warn({ path, status: res.status }, 'API PUT failed');
        return null;
      }
      const body = (await res.json()) as ApiResponse<T>;
      if (!body.ok) {
        this.log.warn({ path, error: body.error }, 'API PUT returned error');
        return null;
      }
      return body.data ?? null;
    } catch (err) {
      this.log.error({ err, path }, 'API PUT error');
      return null;
    }
  }
}
