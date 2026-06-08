-- POS write-back link on menu_items: stores the till's external product/variant
-- id a dish maps to, so a price changed in the CRM can be pushed to the till for
-- this exact product (no name re-matching). Populated by the sync's name-match
-- step (src/lib/pos/sync.ts buildProductMap). Null until a sync matches the dish.
alter table public.menu_items
  add column if not exists pos_external_product_id text;
