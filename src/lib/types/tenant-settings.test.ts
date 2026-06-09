import { describe, it, expect } from 'vitest';
import { getFeatures, DEFAULT_FEATURES, FEATURE_FLAGS, restaurantFacts, featuresFromQuestionnaire, getVoiceProvider } from './tenant-settings';

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

describe('getVoiceProvider (tiering: vapi base / retell premium)', () => {
  it('defaults to vapi (base) when nothing is set', () => {
    expect(getVoiceProvider(null)).toBe('vapi');
    expect(getVoiceProvider(undefined)).toBe('vapi');
    expect(getVoiceProvider({})).toBe('vapi');
  });

  it('honours the explicit flag over any stored ids', () => {
    // Premium tenant keeps its Vapi clone for an instant downgrade; the flag wins.
    expect(getVoiceProvider({ voice: { provider: 'retell' }, vapi: { assistantId: 'a' } })).toBe('retell');
    expect(getVoiceProvider({ voice: { provider: 'vapi' }, retell: { agentId: 'r' } })).toBe('vapi');
  });

  it('compat: a legacy Retell tenant with no flag is read as premium', () => {
    expect(getVoiceProvider({ retell: { agentId: 'agent_x' } })).toBe('retell');
  });

  it('compat: a Vapi-only tenant with no flag is base', () => {
    expect(getVoiceProvider({ vapi: { assistantId: 'asst_x' } })).toBe('vapi');
  });
});

describe('FEATURE_FLAGS', () => {
  // Every free, self-serve toggle must be listed so the Settings → Funzionalità UI
  // can render it — EXCEPT management_enabled, which is a paid add-on
  // (smart_inventory): it must NOT appear as a client toggle (that would let an
  // owner unlock the gestionale for free). It's unlocked by purchase or the admin
  // manual override instead.
  const PAID_ADDON_FLAGS = ['management_enabled'];

  it('lists exactly the self-serve keys of TenantFeatures (paid add-ons excluded)', () => {
    const listed = FEATURE_FLAGS.map((f) => f.key).sort();
    const expected = Object.keys(DEFAULT_FEATURES)
      .filter((k) => !PAID_ADDON_FLAGS.includes(k))
      .sort();
    expect(listed).toEqual(expected);
  });

  it('does NOT expose management_enabled as a client toggle', () => {
    expect(FEATURE_FLAGS.map((f) => f.key)).not.toContain('management_enabled');
  });
});

describe('featuresFromQuestionnaire (wizard → Settings sync)', () => {
  // A both-shifts, single-language venue that answered "no" to everything.
  const base = {
    terrace: false,
    pets: false,
    celebrations: false,
    accepts_large_groups: false,
    last_lunch_offset_min: 45,
    last_dinner_offset_min: 60,
  };

  it('"no terrace" in the wizard → terrace OFF (the reported bug)', () => {
    expect(featuresFromQuestionnaire({ ...base, terrace: false }, 1).terrace).toBe(false);
    expect(featuresFromQuestionnaire({ ...base, terrace: true }, 1).terrace).toBe(true);
  });

  it('maps pets → pet_friendly', () => {
    expect(featuresFromQuestionnaire({ ...base, pets: true }, 1).pet_friendly).toBe(true);
    expect(featuresFromQuestionnaire({ ...base, pets: false }, 1).pet_friendly).toBe(false);
  });

  it('events ON if the venue does celebrations OR large groups', () => {
    expect(featuresFromQuestionnaire({ ...base, celebrations: true }, 1).events_enabled).toBe(true);
    expect(featuresFromQuestionnaire({ ...base, accepts_large_groups: true }, 1).events_enabled).toBe(true);
    expect(featuresFromQuestionnaire(base, 1).events_enabled).toBe(false);
  });

  it('multi_language follows how many assistant languages were picked', () => {
    expect(featuresFromQuestionnaire(base, 1).multi_language).toBe(false);
    expect(featuresFromQuestionnaire(base, 3).multi_language).toBe(true);
  });

  it('double_shift is OFF when a shift has no service (-1 offset)', () => {
    expect(featuresFromQuestionnaire(base, 1).double_shift).toBe(true);
    expect(featuresFromQuestionnaire({ ...base, last_lunch_offset_min: -1 }, 1).double_shift).toBe(false);
    expect(featuresFromQuestionnaire({ ...base, last_dinner_offset_min: -1 }, 1).double_shift).toBe(false);
  });

  it('leaves wizard-unanswerable flags at their defaults', () => {
    const f = featuresFromQuestionnaire(base, 1);
    expect(f.multi_room).toBe(DEFAULT_FEATURES.multi_room);       // wizard never asks → default (false)
    expect(f.waitlist_enabled).toBe(DEFAULT_FEATURES.waitlist_enabled); // default (true)
  });
});

describe('restaurantFacts', () => {
  it('reflects default flags (terrace/pets/events off, languages on)', () => {
    expect(restaurantFacts(null)).toEqual({
      terrace: false,
      pet_friendly: false,
      events: false,
      multi_language: true,
    });
  });

  it('mirrors a tenant turning facts on', () => {
    const f = restaurantFacts({ features: { terrace: true, pet_friendly: true, events_enabled: true } });
    expect(f.terrace).toBe(true);
    expect(f.pet_friendly).toBe(true);
    expect(f.events).toBe(true);        // maps events_enabled → events
    expect(f.multi_language).toBe(true); // untouched → default on
  });
});
