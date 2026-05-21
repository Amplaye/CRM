import { describe, it, expect } from 'vitest';
import { getFeatures, DEFAULT_FEATURES, FEATURE_FLAGS } from './tenant-settings';

describe('getFeatures', () => {
  it('returns defaults when settings has no features', () => {
    expect(getFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(getFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(getFeatures({})).toEqual(DEFAULT_FEATURES);
  });

  it('preserves today\'s behaviour by default (waitlist on)', () => {
    expect(getFeatures({}).waitlist_enabled).toBe(true);
  });

  it('overrides only the flags present, keeping defaults for the rest', () => {
    const f = getFeatures({ features: { waitlist_enabled: false } });
    expect(f.waitlist_enabled).toBe(false); // tenant turned it off
    expect(f.double_shift).toBe(true);      // untouched → default
    expect(f.terrace).toBe(false);          // untouched → default
  });

  it('ignores unknown keys and never mutates the defaults', () => {
    getFeatures({ features: { waitlist_enabled: false } });
    expect(DEFAULT_FEATURES.waitlist_enabled).toBe(true);
  });
});

describe('FEATURE_FLAGS', () => {
  it('lists exactly the keys of TenantFeatures', () => {
    const listed = FEATURE_FLAGS.map((f) => f.key).sort();
    const defined = Object.keys(DEFAULT_FEATURES).sort();
    expect(listed).toEqual(defined);
  });
});
