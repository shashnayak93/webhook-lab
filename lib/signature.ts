import crypto from 'node:crypto';

// Scheme (Stripe-style): header "X-Signature: t=<unix seconds>,v1=<hex hmac>"
// hmac = HMAC_SHA256(secret, `${t}.${rawBody}`)
// Signing the timestamp too lets the receiver reject replayed old requests.

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'timestamp_out_of_tolerance' | 'signature_mismatch' };

export interface VerifyOptions {
  now?: number;
  toleranceSec?: number;
}

export function sign(secret: string, timestamp: number, rawBody: Buffer): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
}

export function buildHeader(secret: string, rawBody: Buffer, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${sign(secret, timestamp, rawBody)}`;
}

export function verify(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  { now = Math.floor(Date.now() / 1000), toleranceSec = 300 }: VerifyOptions = {}
): VerifyResult {
  if (!header) return { ok: false, reason: 'missing_signature' };
  const parts: Record<string, string | undefined> = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=', 2))
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return { ok: false, reason: 'malformed_signature' };
  if (Math.abs(now - t) > toleranceSec) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = Buffer.from(sign(secret, t, rawBody), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  // timingSafeEqual throws on length mismatch, so check first.
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
