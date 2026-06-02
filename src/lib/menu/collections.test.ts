import { describe, it, expect } from 'vitest';
import { collectionMembersMap, itemIdsInCollection, membershipDiff } from './collections';
import type { MenuItem, MenuCollectionItem } from '@/lib/types';

function item(id: string, sort_order: number, name: string): MenuItem {
  return {
    id,
    tenant_id: 't',
    category_id: null,
    name,
    description: '',
    price: null,
    currency: 'EUR',
    allergens: [],
    tags: [],
    available: true,
    image_url: null,
    sort_order,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function link(collection_id: string, item_id: string): MenuCollectionItem {
  return { id: `${collection_id}-${item_id}`, tenant_id: 't', collection_id, item_id, created_at: '2026-01-01' };
}

describe('collectionMembersMap', () => {
  const items = [item('a', 2, 'Bravo'), item('b', 1, 'Alpha'), item('c', 3, 'Charlie')];

  it('groups dishes by collection in menu order (sort_order, then name)', () => {
    const links = [link('col1', 'a'), link('col1', 'b')];
    const map = collectionMembersMap(links, items);
    expect(map.get('col1')!.map((i) => i.id)).toEqual(['b', 'a']); // b sorts first
  });

  it('lets a dish belong to multiple collections', () => {
    const links = [link('col1', 'a'), link('col2', 'a')];
    const map = collectionMembersMap(links, items);
    expect(map.get('col1')!.map((i) => i.id)).toEqual(['a']);
    expect(map.get('col2')!.map((i) => i.id)).toEqual(['a']);
  });

  it('skips a dangling link whose dish no longer exists', () => {
    const links = [link('col1', 'a'), link('col1', 'gone')];
    const map = collectionMembersMap(links, items);
    expect(map.get('col1')!.map((i) => i.id)).toEqual(['a']);
  });

  it('returns an empty map when there are no links', () => {
    expect(collectionMembersMap([], items).size).toBe(0);
  });
});

describe('itemIdsInCollection', () => {
  it('returns only the item ids for the given collection', () => {
    const links = [link('col1', 'a'), link('col1', 'b'), link('col2', 'c')];
    const ids = itemIdsInCollection(links, 'col1');
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});

describe('membershipDiff', () => {
  it('computes adds and removes', () => {
    const prev = new Set(['a', 'b']);
    const next = new Set(['b', 'c']);
    const { toAdd, toRemove } = membershipDiff(prev, next);
    expect(toAdd).toEqual(['c']);
    expect(toRemove).toEqual(['a']);
  });

  it('is empty when nothing changed', () => {
    const s = new Set(['a', 'b']);
    const { toAdd, toRemove } = membershipDiff(s, new Set(['a', 'b']));
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});
