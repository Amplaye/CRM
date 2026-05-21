import { describe, it, expect } from 'vitest';
import { getTenantFeatures } from './features';

/** Minimal chainable stub mimicking the supabase query used by getTenantFeatures:
 *  .from('tenants').select('settings').eq('id', x).maybeSingle() */
function fakeClient(row: { settings: unknown } | null) {
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
  };
  return chain as unknown as Parameters<typeof getTenantFeatures>[1];
}

describe('getTenantFeatures', () => {
  it('applies defaults when the tenant has no features block', async () => {
    const f = await getTenantFeatures('t1', fakeClient({ settings: {} }));
    expect(f.waitlist_enabled).toBe(true); // default ON
    expect(f.terrace).toBe(false);         // default OFF
  });

  it('honours an explicit disable from settings', async () => {
    const f = await getTenantFeatures('t1', fakeClient({ settings: { features: { waitlist_enabled: false } } }));
    expect(f.waitlist_enabled).toBe(false);
  });

  it('fails open to defaults when the tenant row is missing', async () => {
    const f = await getTenantFeatures('missing', fakeClient(null));
    expect(f.waitlist_enabled).toBe(true);
  });

  it('merges: explicit flag overrides default, others keep defaults', async () => {
    const f = await getTenantFeatures('t1', fakeClient({ settings: { features: { terrace: true } } }));
    expect(f.terrace).toBe(true);          // overridden
    expect(f.waitlist_enabled).toBe(true); // still default
  });
});
