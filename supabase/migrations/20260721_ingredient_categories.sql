-- Warehouse categories for ingredients.
--
-- Until now the Inventory page grouped stock by MENU category, derived from
-- which dishes happened to use an ingredient in a recipe. That is backwards for
-- a storeroom: an onion is a vegetable whether or not a recipe touches it, and
-- stock nobody cooks with yet fell into a nameless "unused" bucket. A warehouse
-- is organised by what a thing IS, so the category belongs on the ingredient.
--
-- Free text (not an enum / lookup table) on purpose: the UI offers the classic
-- list, but a tenant that stocks something unusual is never blocked. Values are
-- the stable slugs from src/lib/management/ingredient-categories.ts; the display
-- name is translated client-side, so renaming a label never migrates data.

alter table public.ingredients
  add column if not exists category text;

-- Chip filtering is always tenant-scoped, so the category index is composite.
create index if not exists idx_ingredients_tenant_category
  on public.ingredients(tenant_id, category);

-- ── Wider unit catalogue ────────────────────────────────────────────────────
--
-- The column allowed only g/kg/ml/l/pz. Every unit a supplier actually prints
-- but that we don't accept becomes a conversion the owner does in their head —
-- "0,15 kg" for 150 g, "0,08 l" for a spoonful — and each one is a chance to
-- slip a decimal and blow up a food cost. The catalogue now mirrors
-- src/lib/management/units.ts (mass, volume, count/packaging).

alter table public.ingredients drop constraint if exists ingredients_unit_check;
alter table public.ingredients add constraint ingredients_unit_check check (unit in (
  -- mass
  'mg','g','hg','kg','q','t','oz','lb',
  -- volume
  'ml','cl','dl','l','tsp','tbsp','cup','floz','pt','gal',
  -- count / packaging
  'pz','dz','cf','ct','bt','lt_can','vas','bus','sac','porz'
));
