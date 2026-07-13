-- Inventory: product barcode (EAN/UPC), so a delivery can be put away by
-- pointing the phone camera at the box instead of hunting the product by name.
--
-- Nullable by design: every existing ingredient stays valid, and an owner only
-- fills it in for the products they actually scan.
--
-- Uniqueness is PER TENANT (two restaurants may of course stock the same SKU),
-- and the index is PARTIAL so the many ingredients with no barcode don't all
-- collide on NULL.

alter table public.ingredients
  add column if not exists barcode text;

create unique index if not exists ingredients_tenant_barcode_uniq
  on public.ingredients (tenant_id, barcode)
  where barcode is not null;

comment on column public.ingredients.barcode is
  'EAN/UPC printed on the package. Scanned with the phone camera from the Inventory screen. Unique per tenant.';
