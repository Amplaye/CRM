import { describe, it, expect } from 'vitest';
import { allergenLabel, tagLabel, collectionLabel } from './labels';

describe('allergenLabel', () => {
  it('localizes a known allergen token in all four locales', () => {
    expect(allergenLabel('glutine', 'it')).toBe('Glutine');
    expect(allergenLabel('glutine', 'es')).toBe('Gluten');
    expect(allergenLabel('glutine', 'en')).toBe('Gluten');
    expect(allergenLabel('glutine', 'de')).toBe('Gluten');
    expect(allergenLabel('frutta_secca', 'es')).toBe('Frutos secos');
    expect(allergenLabel('frutta_secca', 'de')).toBe('Schalenfrüchte');
  });

  it('falls back to the prettified token for an unknown allergen', () => {
    expect(allergenLabel('qualcosa_strana', 'en')).toBe('qualcosa strana');
  });
});

describe('tagLabel', () => {
  it('localizes the new novita / specialita tags', () => {
    expect(tagLabel('novita', 'it')).toBe('Novità');
    expect(tagLabel('novita', 'es')).toBe('Novedad');
    expect(tagLabel('novita', 'en')).toBe('New');
    expect(tagLabel('novita', 'de')).toBe('Neu');
    expect(tagLabel('specialita', 'en')).toBe('House special');
    expect(tagLabel('specialita', 'de')).toBe('Spezialität');
  });

  it('localizes the existing tags', () => {
    expect(tagLabel('consigliato', 'es')).toBe('Recomendado');
    expect(tagLabel('piccante', 'en')).toBe('Spicy');
  });

  it('falls back to the prettified token for an unknown tag', () => {
    expect(tagLabel('bestseller', 'en')).toBe('bestseller');
  });
});

describe('collectionLabel', () => {
  it('localizes each classic collection kind', () => {
    expect(collectionLabel('consigliati', '', 'it')).toBe('Consigliati');
    expect(collectionLabel('consigliati', '', 'es')).toBe('Recomendados');
    expect(collectionLabel('menu_del_giorno', '', 'es')).toBe('Menú del día');
    expect(collectionLabel('menu_del_giorno', '', 'de')).toBe('Tagesmenü');
    expect(collectionLabel('specialita', '', 'en')).toBe('House specials');
    expect(collectionLabel('novita', '', 'de')).toBe('Neuheiten');
  });

  it('returns the custom name verbatim when kind is null', () => {
    expect(collectionLabel(null, 'Brunch della domenica', 'it')).toBe('Brunch della domenica');
    expect(collectionLabel(null, 'Sunday Brunch', 'en')).toBe('Sunday Brunch');
  });

  it('prefers the classic localized name even if a name was stored', () => {
    // A classic stored with an Italian name still renders in the active locale.
    expect(collectionLabel('consigliati', 'Consigliati', 'en')).toBe('Recommended');
  });
});
