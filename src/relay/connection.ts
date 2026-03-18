/**
 * Relay WebSocket client.
 *
 * Connects to the Umbra relay server and handles:
 * - Registration with the bridge bot's DID
 * - Sending messages to community members
 * - Receiving community events
 * - Keepalive pings with exponential backoff reconnection
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { getLogger } from '../util/logger';
import type { RelayOutbound, RelayInbound, CommunityEventEnvelope } from '../types';

export interface RelayConnectionOptions {
  url: string;
  did: string;
  keepaliveInterval: number;
  maxReconnectDelay: number;
}

export declare interface RelayConnection {
  on(event: 'community_event', listener: (envelope: CommunityEventEnvelope, fromDid: string) => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class RelayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: RelayConnectionOptions;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private isRegistered = false;
  private shouldReconnect = true;
  private log = getLogger().child({ module: 'relay' });

  constructor(options: RelayConnectionOptions) {
    super();
    this.options = options;
  }

  /** Start the WebSocket connection. */
  connect(): void {
    this.shouldReconnect = true;
    this._connect();
  }

  /** Gracefully disconnect and stop reconnecting. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopKeepalive();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Bridge shutting down');
      this.ws = null;
    }
  }

  /** Send a message envelope to a specific DID via the relay. */
  sendToDid(toDid: string, payload: string): boolean {
    return this._send({ type: 'send', to_did: toDid, payload });
  }

  /** Whether the connection is open and registered. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isRegistered;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    this.log.info({ url: this.options.url }, 'Connecting to relay');

    try {
      this.ws = new WebSocket(this.options.url);
    } catch (err) {
      this.log.error({ err }, 'Failed to create WebSocket');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.log.info('WebSocket connected, registering');
      this.reconnectDelay = 1000; // Reset backoff on successful connect
      this.isRegistered = false;

      // Register with the relay
      this._send({ type: 'register', did: this.options.did });
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as RelayInbound;
        this.handleMessage(msg);
      } catch (err) {
        this.log.warn({ err, data: data.toString().slice(0, 200) }, 'Failed to parse relay message');
      }
    });

    this.ws.on('close', (code, reason) => {
      this.log.info({ code, reason: reason.toString() }, 'WebSocket closed');
      this.isRegistered = false;
      this.stopKeepalive();
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.log.error({ err }, 'WebSocket error');
      this.emit('error', err);
    });
  }

  private handleMessage(msg: RelayInbound): void {
    switch (msg.type) {
      case 'registered':
        this.log.info({ did: msg.did }, 'Registered with relay');
        this.isRegistered = true;
        this.startKeepalive();
        this.emit('connected');
        break;

      case 'message': {
        // Try to parse the payload as a community event
        try {
          const envelope = JSON.parse(msg.payload) as CommunityEventEnvelope;
          if (envelope.envelope === 'community_event') {
            this.emit('community_event', envelope, msg.from_did);
          }
        } catch {
          this.log.debug({ from: msg.from_did }, 'Received non-community message, ignoring');
        }
        break;
      }

      case 'pong':
        // Keepalive response, nothing to do
        break;

      case 'error':
        this.log.warn({ message: msg.message }, 'Relay error');
        break;

      default:
        this.log.debug({ msg }, 'Unknown relay message type');
    }
  }

  private _send(msg: RelayOutbound): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log.warn({ type: msg.type }, 'Cannot send, WebSocket not open');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      this.log.error({ err, type: msg.type }, 'Failed to send message');
      return false;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this._send({ type: 'ping' });
    }, this.options.keepaliveInterval);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.log.info({ delay: this.reconnectDelay }, 'Scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectDelay);

    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2 + Math.random() * 1000,
      this.options.maxReconnectDelay,
    );
  }
}
