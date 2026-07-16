import { describe, it, expect } from 'vitest';
import { hashApiKey } from './tenant-auth';

describe('hashApiKey', () => {
  it('produces a 64-char hex sha256', () => {
    const h = hashApiKey('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // RFC 6234 test vector
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('matches the SQL-side seed for a tenant UUID', () => {
    // pgcrypto seed: encode(digest(id::text, 'sha256'), 'hex')
    expect(hashApiKey('626547ff-bc44-4f35-8f42-0e97f1dcf0d5')).toBe(
      'd3012be109de94a29794a32a24da4ab0ef8142b5fba35bfd7888cf7daf47fa7f'
    );
    expect(hashApiKey('a9b3fa26-cbca-405f-ab1b-ce6dffe58596')).toBe(
      'bd0f411d4afa3f6cfd5bd336938db8c1a8e6e0d92498e79be8e0b9287c7f83e0'
    );
  });
  it('is deterministic', () => {
    expect(hashApiKey('a')).toBe(hashApiKey('a'));
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});
