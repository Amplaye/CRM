import type { MenuCollectionItem, MenuItem } from "@/lib/types";

// Pure helpers for resolving collection membership. A collection stores only
// links (collection_id → item_id); the dish data lives in menu_items. So a
// collection's dishes are derived by looking each linked item_id up in the
// current items list. Keeping membership as ID links (not embedded dish copies)
// means menu_items stays the single source of truth — editing a dish anywhere
// updates it inside every collection automatically.

/**
 * Build a map of collectionId → the dishes in that collection, in the dishes'
 * own menu order (sort_order, then name). Links whose item no longer exists
 * (e.g. a dish was deleted but a stale link snuck through) are skipped.
 */
export function collectionMembersMap(
  links: MenuCollectionItem[],
  items: MenuItem[]
): Map<string, MenuItem[]> {
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const out = new Map<string, MenuItem[]>();
  for (const link of links) {
    const dish = itemsById.get(link.item_id);
    if (!dish) continue; // dangling link — dish gone
    const list = out.get(link.collection_id);
    if (list) list.push(dish);
    else out.set(link.collection_id, [dish]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  return out;
}

/**
 * The set of item ids that belong to a given collection. Used to pre-check the
 * multi-select editor.
 */
export function itemIdsInCollection(
  links: MenuCollectionItem[],
  collectionId: string
): Set<string> {
  const out = new Set<string>();
  for (const link of links) {
    if (link.collection_id === collectionId) out.add(link.item_id);
  }
  return out;
}

/**
 * Given the previously-saved membership and the newly-chosen set, compute which
 * links to add and which to remove. Diffing (instead of delete-all-then-insert)
 * avoids churn and avoids a transient empty collection flashing to other open
 * tabs via realtime.
 */
export function membershipDiff(
  previous: Set<string>,
  next: Set<string>
): { toAdd: string[]; toRemove: string[] } {
  const toAdd: string[] = [];
  const toRemove: string[] = [];
  for (const id of next) if (!previous.has(id)) toAdd.push(id);
  for (const id of previous) if (!next.has(id)) toRemove.push(id);
  return { toAdd, toRemove };
}
