-- Cost taxonomy on supplier invoices, for the annual P&L cost tree.
-- goods_total/service_total already split merchandise from services; this adds
-- the finer bucket the income statement needs: food vs beverage vs consumables
-- (the "materia prima" branch), and structure/rent/utilities for service bills.
-- Nullable + derived: a goods invoice with no category counts as food, a service
-- invoice as structure, so the tree is populated even before anyone sets it.
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.

alter table public.supplier_invoices
  add column if not exists cost_category text
    check (cost_category in ('food','beverage','consumables','structure','rent','utilities','other') or cost_category is null);
