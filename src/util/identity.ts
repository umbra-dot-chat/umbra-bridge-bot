/**
 * Bridge bot DID identity management.
 *
 * Generates an Ed25519 keypair on first run and persists it to disk.
 * The DID is used to identify the bridge bot on the relay — the relay
 * accepts any well-formed DID without signature challenge.
 */

import * as ed from '@noble/ed25519';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from './logger';
import type { BridgeIdentity } from '../types';

const IDENTITY_FILE = 'bridge-identity.json';

/**
 * Base58btc alphabet (same as multibase 'z' prefix).
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Uint8Array): string {
  let num = BigInt(0);
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  let encoded = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  // Leading zeros
  for (const b of bytes) {
    if (b === 0) {
      encoded = '1' + encoded;
    } else {
      break;
    }
  }

  return encoded;
}

/**
 * Convert an Ed25519 public key to a did:key DID.
 *
 * Format: did:key:z + base58btc(multicodec_prefix + public_key)
 * Ed25519 multicodec prefix is 0xed01.
 */
function publicKeyToDid(publicKey: Uint8Array): string {
  // Multicodec prefix for Ed25519 public key: 0xed 0x01
  const multicodec = new Uint8Array([0xed, 0x01, ...publicKey]);
  return `did:key:z${base58btcEncode(multicodec)}`;
}

/**
 * Load or generate the bridge bot's Ed25519 identity.
 *
 * On first run, generates a new keypair and saves to
 * `{dataDir}/bridge-identity.json`. Subsequent runs load from disk.
 */
export async function loadOrCreateIdentity(dataDir: string): Promise<BridgeIdentity> {
  const log = getLogger();
  const filePath = join(dataDir, IDENTITY_FILE);

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const stored = JSON.parse(raw) as BridgeIdentity;
      log.info({ did: stored.did }, 'Loaded bridge identity from disk');
      return stored;
    } catch (err) {
      log.warn({ err, path: filePath }, 'Failed to load identity, generating new one');
    }
  }

  // Generate new Ed25519 keypair
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  const identity: BridgeIdentity = {
    did: publicKeyToDid(publicKey),
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    privateKeyHex: Buffer.from(privateKey).toString('hex'),
  };

  // Persist to disk
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8');
    log.info({ did: identity.did, path: filePath }, 'Generated and saved new bridge identity');
  } catch (err) {
    log.warn({ err }, 'Failed to persist identity to disk (will regenerate on restart)');
  }

  return identity;
}
