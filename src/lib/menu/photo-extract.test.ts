import { describe, it, expect } from 'vitest';
import {
  isPhotoCandidate,
  selectCandidates,
  flattenDishes,
  correlateDishName,
  type RawExtractedImage,
  type DishRef,
} from './photo-extract';
import type { ExtractedMenu } from './extract';

const img = (width: number, height: number, channels: 1 | 3 | 4 = 3): RawExtractedImage => ({
  width,
  height,
  channels,
});

describe('isPhotoCandidate', () => {
  it('accepts a typical small dish thumbnail (real sushi-menu sizes)', () => {
    expect(isPhotoCandidate(img(137, 110))).toBe(true);
    expect(isPhotoCandidate(img(197, 128))).toBe(true);
    expect(isPhotoCandidate(img(428, 393))).toBe(true);
  });

  it('rejects icons / spacers below the min edge', () => {
    expect(isPhotoCandidate(img(40, 40))).toBe(false);
    expect(isPhotoCandidate(img(89, 200))).toBe(false); // short edge < 90
  });

  it('rejects full-page backgrounds above the max edge', () => {
    expect(isPhotoCandidate(img(1704, 1041))).toBe(false);
    expect(isPhotoCandidate(img(2300, 800))).toBe(false);
  });

  it('rejects thin strips / dividers by aspect ratio', () => {
    expect(isPhotoCandidate(img(1000, 120))).toBe(false); // ratio ~8.3
    expect(isPhotoCandidate(img(120, 600))).toBe(false); // ratio 0.2
  });

  it('rejects degenerate / non-finite sizes', () => {
    expect(isPhotoCandidate(img(0, 100))).toBe(false);
    expect(isPhotoCandidate(img(100, 0))).toBe(false);
    expect(isPhotoCandidate({ width: NaN, height: 100, channels: 3 })).toBe(false);
  });
});

describe('selectCandidates', () => {
  it('keeps only candidates and preserves per-page index order', () => {
    const images = [
      img(1704, 1041), // background → drop (index 0)
      img(137, 110), // dish → keep (index 1)
      img(40, 40), // icon → drop (index 2)
      img(197, 128), // dish → keep (index 3)
    ];
    const got = selectCandidates(2, images);
    expect(got).toEqual([
      { page: 2, indexOnPage: 1, width: 137, height: 110 },
      { page: 2, indexOnPage: 3, width: 197, height: 128 },
    ]);
  });
});

const menu: ExtractedMenu = {
  categories: [
    {
      name: 'Antipasti',
      items: [
        { name: 'Bruschetta al pomodoro', description: '', price: 6, currency: 'EUR', allergens: [], tags: [] },
        { name: 'Gamberi in tempura', description: '', price: 9, currency: 'EUR', allergens: [], tags: [] },
      ],
    },
    {
      name: 'Primi',
      items: [
        { name: 'Spaghetti alle vongole', description: '', price: 12, currency: 'EUR', allergens: [], tags: [] },
      ],
    },
  ],
  uncategorized: [
    { name: 'Caffè', description: '', price: 1.5, currency: 'EUR', allergens: [], tags: [] },
  ],
};

describe('flattenDishes', () => {
  it('flattens with {c,i}, uncategorized as c=-1', () => {
    const flat = flattenDishes(menu);
    expect(flat).toEqual<DishRef[]>([
      { c: 0, i: 0, name: 'Bruschetta al pomodoro' },
      { c: 0, i: 1, name: 'Gamberi in tempura' },
      { c: 1, i: 0, name: 'Spaghetti alle vongole' },
      { c: -1, i: 0, name: 'Caffè' },
    ]);
  });
});

describe('correlateDishName', () => {
  const dishes = flattenDishes(menu);

  it('exact match, accent/case-insensitive', () => {
    expect(correlateDishName('caffe', dishes)).toEqual({ c: -1, i: 0, name: 'Caffè' });
    expect(correlateDishName('SPAGHETTI ALLE VONGOLE', dishes)).toEqual({
      c: 1,
      i: 0,
      name: 'Spaghetti alle vongole',
    });
  });

  it('substring match in either direction', () => {
    expect(correlateDishName('Gamberi in tempura con salsa', dishes)).toEqual({
      c: 0,
      i: 1,
      name: 'Gamberi in tempura',
    });
    expect(correlateDishName('bruschetta', dishes)).toEqual({
      c: 0,
      i: 0,
      name: 'Bruschetta al pomodoro',
    });
  });

  it('returns null for no match', () => {
    expect(correlateDishName('Tiramisù', dishes)).toBeNull();
    expect(correlateDishName('', dishes)).toBeNull();
  });

  it('returns null when a name is ambiguous (duplicate dish names)', () => {
    const dup: DishRef[] = [
      { c: 0, i: 0, name: 'Pizza' },
      { c: 1, i: 0, name: 'Pizza' },
    ];
    expect(correlateDishName('pizza', dup)).toBeNull();
  });

  it('picks the longest dish name on a substring tie-break, null on a true tie', () => {
    const refs: DishRef[] = [
      { c: 0, i: 0, name: 'Risotto' },
      { c: 0, i: 1, name: 'Risotto ai funghi porcini' },
    ];
    // query contains both, longest wins
    expect(correlateDishName('Risotto ai funghi porcini speciale', refs)).toEqual(refs[1]);
    const tie: DishRef[] = [
      { c: 0, i: 0, name: 'Tonno' },
      { c: 0, i: 1, name: 'Pesce' },
    ];
    // "tonno e pesce" contains both, same length → ambiguous → null
    expect(correlateDishName('tonno e pesce', tie)).toBeNull();
  });
});
