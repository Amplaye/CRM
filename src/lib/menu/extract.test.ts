import { describe, it, expect } from 'vitest';
import { parseExtraction, normalizeExtraction } from './extract';

describe('parseExtraction', () => {
  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      categories: [
        {
          name: 'Antipasti',
          items: [
            { name: 'Bruschetta', description: 'pomodoro e basilico', price: 6.5, currency: 'EUR', allergens: ['glutine'], tags: [] },
          ],
        },
      ],
      uncategorized: [],
    });
    const out = parseExtraction(raw);
    expect(out.categories).toHaveLength(1);
    expect(out.categories[0].name).toBe('Antipasti');
    expect(out.categories[0].items[0].price).toBe(6.5);
    expect(out.categories[0].items[0].allergens).toEqual(['glutine']);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"categories":[],"uncategorized":[]}\n```';
    expect(() => parseExtraction(raw)).not.toThrow();
  });

  it('extracts JSON when model adds prose before/after', () => {
    const raw = 'Sure! Here is the menu:\n{"categories":[],"uncategorized":[]}\nDone.';
    const out = parseExtraction(raw);
    expect(out.categories).toEqual([]);
  });

  it('throws a clear error on truly invalid JSON', () => {
    expect(() => parseExtraction('not json at all')).toThrow(/non-JSON/);
  });
});

describe('normalizeExtraction', () => {
  it('coerces stringy price to number', () => {
    const out = normalizeExtraction({
      categories: [
        { name: 'X', items: [{ name: 'A', price: '12,50' }] },
      ],
    });
    expect(out.categories[0].items[0].price).toBe(12.5);
  });

  it('filters out hallucinated allergens and tags', () => {
    const out = normalizeExtraction({
      categories: [
        {
          name: 'X',
          items: [
            {
              name: 'A',
              allergens: ['glutine', 'made_up_allergen', 'UOVA'],
              tags: ['piccante', 'biologico'],
            },
          ],
        },
      ],
    });
    const item = out.categories[0].items[0];
    expect(item.allergens.sort()).toEqual(['glutine', 'uova']);
    expect(item.tags).toEqual(['piccante']);
  });

  it('defaults currency to EUR when missing or invalid', () => {
    const out = normalizeExtraction({
      categories: [{ name: 'X', items: [{ name: 'A', currency: 'xx' }, { name: 'B' }] }],
    });
    expect(out.categories[0].items[0].currency).toBe('EUR');
    expect(out.categories[0].items[1].currency).toBe('EUR');
  });

  it('handles null price safely', () => {
    const out = normalizeExtraction({
      categories: [{ name: 'X', items: [{ name: 'A', price: null }] }],
    });
    expect(out.categories[0].items[0].price).toBeNull();
  });

  it('handles missing fields by returning sensible defaults', () => {
    const out = normalizeExtraction({});
    expect(out.categories).toEqual([]);
    expect(out.uncategorized).toEqual([]);
  });

  it('trims oversized strings', () => {
    const longName = 'X'.repeat(500);
    const out = normalizeExtraction({
      categories: [{ name: 'A', items: [{ name: longName }] }],
    });
    expect(out.categories[0].items[0].name.length).toBeLessThanOrEqual(120);
  });
});
