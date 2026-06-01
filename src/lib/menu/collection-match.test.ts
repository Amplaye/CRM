import { describe, it, expect } from 'vitest';
import { matchCollectionKind, normForMatch, KIND_TO_TAG } from './collection-match';

describe('matchCollectionKind', () => {
  it('detects "recommended" across languages', () => {
    expect(matchCollectionKind('¿qué platos recomiendan?')).toBe('consigliati');
    expect(matchCollectionKind('quali piatti mi consigliate?')).toBe('consigliati');
    expect(matchCollectionKind('what do you recommend?')).toBe('consigliati');
    expect(matchCollectionKind('was empfehlen Sie?')).toBe('consigliati');
  });

  it('detects "menu of the day" across languages', () => {
    expect(matchCollectionKind('cosa c’è nel menu del giorno?')).toBe('menu_del_giorno');
    expect(matchCollectionKind('¿cuál es el menú del día?')).toBe('menu_del_giorno');
    expect(matchCollectionKind('do you have a menu of the day')).toBe('menu_del_giorno');
    expect(matchCollectionKind('gibt es ein Tagesmenü?')).toBe('menu_del_giorno');
  });

  it('detects "house special"', () => {
    expect(matchCollectionKind('¿cuál es la especialidad de la casa?')).toBe('specialita');
    expect(matchCollectionKind('qual è la specialità della casa?')).toBe('specialita');
    expect(matchCollectionKind('your house specials?')).toBe('specialita');
  });

  it('detects "new" dishes', () => {
    expect(matchCollectionKind('¿hay novedades?')).toBe('novita');
    expect(matchCollectionKind('avete novità?')).toBe('novita');
    expect(matchCollectionKind('anything new?')).toBe('novita');
  });

  it('returns null for unrelated questions', () => {
    expect(matchCollectionKind('quanto costa la pizza margherita?')).toBeNull();
    expect(matchCollectionKind('a che ora aprite?')).toBeNull();
    expect(matchCollectionKind('')).toBeNull();
  });

  it('is accent- and case-insensitive', () => {
    expect(matchCollectionKind('MENÚ DEL DÍA')).toBe('menu_del_giorno');
    expect(normForMatch('Menú del día')).toBe('menu del dia');
  });

  it('lets the longest synonym win when keys overlap', () => {
    // "del giorno" and "menu del giorno" both match; both map to the same kind,
    // but the longest-wins rule must still resolve deterministically.
    expect(matchCollectionKind('il menu del giorno')).toBe('menu_del_giorno');
  });
});

describe('KIND_TO_TAG', () => {
  it('maps tag-backed kinds and omits menu_del_giorno', () => {
    expect(KIND_TO_TAG.consigliati).toBe('consigliato');
    expect(KIND_TO_TAG.specialita).toBe('specialita');
    expect(KIND_TO_TAG.novita).toBe('novita');
    expect(KIND_TO_TAG.menu_del_giorno).toBeUndefined();
  });
});
