-- Cassa: shared draft lines (carrello sincronizzato tra dispositivi).
--
-- Until now a dish tapped on the till lived ONLY in that device's React state
-- (draftsMap) until "Invia in cucina" fired it as a cassa_order_items row.
-- Result: mobile and desktop on the same account never saw each other's cart.
-- Drafts now live in cassa_order_items with status='draft' (comanda_no=0) so
-- every device streams them over the existing realtime publication; sending
-- the comanda flips them to 'sent' and assigns the next comanda_no.
--
-- Idempotent: safe to re-run.

alter table public.cassa_order_items
  drop constraint if exists cassa_order_items_status_check;
alter table public.cassa_order_items
  add constraint cassa_order_items_status_check
  check (status in ('draft','sent','cancelled'));

-- Drafts haven't gone out with any firing round yet.
alter table public.cassa_order_items
  alter column comanda_no set default 0;

-- Publication safety net (both tables were already added by 2026-07-04-cassa.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cassa_order_items'
  ) then
    alter publication supabase_realtime add table public.cassa_order_items;
  end if;
end $$;
