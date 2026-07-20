import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  isMetaVerificationEnabled,
  verifyMetaSignature,
} from './meta-signature';

// Fail-closed contract for webhook signature verification:
// - secret configured           → verification enforced
// - secret configured + opt-out → verification skipped (emergency lever)
// - no secret configured        → nothing to verify against, requests pass

const ENV_KEYS = [
  'META_APP_SECRET',
  'FACEBOOK_VERIFY_SIGNATURE',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function metaSign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf-8').digest('hex');
}

describe('Meta signature verification (fail-closed)', () => {
  it('is enabled when META_APP_SECRET is set', () => {
    process.env.META_APP_SECRET = 'shhh';
    expect(isMetaVerificationEnabled()).toBe(true);
  });

  it('is disabled without META_APP_SECRET', () => {
    expect(isMetaVerificationEnabled()).toBe(false);
  });

  it('can be opted out only with FACEBOOK_VERIFY_SIGNATURE=0', () => {
    process.env.META_APP_SECRET = 'shhh';
    process.env.FACEBOOK_VERIFY_SIGNATURE = '0';
    expect(isMetaVerificationEnabled()).toBe(false);
    process.env.FACEBOOK_VERIFY_SIGNATURE = '1';
    expect(isMetaVerificationEnabled()).toBe(true);
  });

  it('accepts a valid signature', () => {
    process.env.META_APP_SECRET = 'shhh';
    const body = JSON.stringify({ hello: 'world' });
    expect(verifyMetaSignature(body, metaSign(body, 'shhh'))).toBe(true);
  });

  it('rejects a missing signature when the secret is configured', () => {
    process.env.META_APP_SECRET = 'shhh';
    expect(verifyMetaSignature('{}', null)).toBe(false);
    expect(verifyMetaSignature('{}', undefined)).toBe(false);
  });

  it('rejects a tampered body', () => {
    process.env.META_APP_SECRET = 'shhh';
    const sig = metaSign('{"a":1}', 'shhh');
    expect(verifyMetaSignature('{"a":2}', sig)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    process.env.META_APP_SECRET = 'shhh';
    const body = '{}';
    expect(verifyMetaSignature(body, metaSign(body, 'wrong'))).toBe(false);
  });

  it('passes everything through when opted out', () => {
    process.env.META_APP_SECRET = 'shhh';
    process.env.FACEBOOK_VERIFY_SIGNATURE = '0';
    expect(verifyMetaSignature('{}', null)).toBe(true);
  });
});
