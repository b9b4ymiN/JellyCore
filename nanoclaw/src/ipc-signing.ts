/**
 * IPC Integrity Signing Module
 *
 * Provides HMAC-SHA256 signing and verification for IPC messages.
 * Prevents injection of forged IPC commands from untrusted sources.
 *
 * Usage:
 *   Container side: signIpcMessage(payload, secret) → signed JSON string
 *   Host side: verifyIpcMessage(content, secret) → { valid, data }
 */
import crypto from 'crypto';

const HMAC_FIELD = '_hmac';

/**
 * Sign an IPC message payload with HMAC-SHA256.
 * Returns the JSON string with _hmac field appended.
 */
export function signIpcMessage(payload: object, secret: string): string {
  // Produce canonical JSON (no _hmac field) for signing
  const canonical = JSON.stringify(payload, null, 2);
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');

  return JSON.stringify({ ...payload, [HMAC_FIELD]: hmac }, null, 2);
}

/**
 * Verify an IPC message's HMAC signature.
 * Returns { valid: true, data } if signature matches, { valid: false, data: null } otherwise.
 */
export function verifyIpcMessage(
  content: string,
  secret: string,
): { valid: boolean; data: Record<string, unknown> | null } {
  try {
    const parsed = JSON.parse(content);
    const receivedHmac = parsed[HMAC_FIELD];

    if (!receivedHmac || typeof receivedHmac !== 'string') {
      return { valid: false, data: null };
    }

    // Reconstruct the original payload without _hmac
    const { [HMAC_FIELD]: _, ...payload } = parsed;
    const canonical = JSON.stringify(payload, null, 2);
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(canonical)
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const valid = receivedHmac.length === expectedHmac.length &&
      crypto.timingSafeEqual(
        Buffer.from(receivedHmac, 'hex'),
        Buffer.from(expectedHmac, 'hex'),
      );

    return { valid, data: valid ? payload : null };
  } catch {
    return { valid: false, data: null };
  }
}
