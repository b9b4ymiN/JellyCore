/**
 * Encrypted Auth State for WhatsApp (Baileys)
 *
 * Wraps Baileys' useMultiFileAuthState with AES-256-GCM encryption.
 * Auth files are encrypted at rest — requires JELLYCORE_AUTH_PASSPHRASE to unlock.
 *
 * File format: [salt 32 bytes][iv 16 bytes][ciphertext][auth tag 16 bytes]
 * Key derivation: scrypt(passphrase, salt, keylen=32)
 *
 * Backward compatible: reads plain JSON files and encrypts them on next save.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from '@whiskeysockets/baileys';

import { logger } from './logger.js';

const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

function encrypt(data: string, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: [salt][iv][ciphertext][authTag]
  return Buffer.concat([salt, iv, encrypted, authTag]);
}

function decrypt(data: Buffer, passphrase: string): string {
  if (data.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short');
  }

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Invalid passphrase or corrupted auth data');
  }
}

function isPlainJson(data: Buffer): boolean {
  // Plain JSON files start with '{' or '['
  if (data.length === 0) return false;
  const firstByte = data[0];
  return firstByte === 0x7B || firstByte === 0x5B; // '{' or '['
}

function writeEncrypted(filePath: string, jsonData: any, passphrase: string): void {
  const jsonStr = JSON.stringify(jsonData, BufferJSON.replacer);
  const encrypted = encrypt(jsonStr, passphrase);
  fs.writeFileSync(filePath, encrypted);
}

function readEncrypted(filePath: string, passphrase: string): any {
  if (!fs.existsSync(filePath)) return null;

  const data = fs.readFileSync(filePath);
  if (data.length === 0) return null;

  let jsonStr: string;

  if (isPlainJson(data)) {
    // Backward compatibility: plain JSON file (pre-encryption)
    jsonStr = data.toString('utf8');
    logger.info({ file: path.basename(filePath) }, 'Migrating plain auth file to encrypted format');
    // Re-encrypt on read for migration
    const parsed = JSON.parse(jsonStr, BufferJSON.reviver);
    writeEncrypted(filePath, parsed, passphrase);
    return parsed;
  }

  jsonStr = decrypt(data, passphrase);
  return JSON.parse(jsonStr, BufferJSON.reviver);
}

/**
 * Validate the auth passphrase meets minimum requirements.
 * Throws if invalid.
 */
export function validatePassphrase(passphrase: string | undefined): asserts passphrase is string {
  if (!passphrase) {
    throw new Error(
      'JELLYCORE_AUTH_PASSPHRASE is required. ' +
      'Set it in .env to encrypt WhatsApp auth credentials at rest.'
    );
  }
  if (passphrase.length < 16) {
    throw new Error(
      'JELLYCORE_AUTH_PASSPHRASE must be at least 16 characters. ' +
      `Current length: ${passphrase.length}`
    );
  }
}

/**
 * Create an encrypted auth state compatible with Baileys.
 * Drop-in replacement for useMultiFileAuthState() with AES-256-GCM encryption.
 */
export async function createEncryptedAuthState(
  authDir: string,
  passphrase: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const credsFile = path.join(authDir, 'creds.json');

  const creds: AuthenticationCreds = readEncrypted(credsFile, passphrase) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const filePath = path.join(authDir, `${type}-${id}.json`);
            const value = readEncrypted(filePath, passphrase);
            if (value) {
              if (type === 'app-state-sync-key') {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(value) as any;
              } else {
                data[id] = value;
              }
            }
          }
          return data;
        },
        set: async (data: any) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const filePath = path.join(authDir, `${category}-${id}.json`);
              if (value) {
                writeEncrypted(filePath, value, passphrase);
              } else {
                try { fs.unlinkSync(filePath); } catch { /* ignore */ }
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      writeEncrypted(credsFile, creds, passphrase);
    },
  };
}
