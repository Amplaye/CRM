-- Fatture: persistenza categoria riga (goods/service/charge) + entità fornitore.
--
-- Oggi il classificatore line-kind.ts gira solo a runtime nell'anteprima: qui lo
-- rendiamo persistito e portabile in P&L, così una fattura di servizi/attrezzature
-- (es. CENTROCASSA: noleggio RT, canone assistenza) non sporca food-cost e magazzino.
--
-- Idempotente. Applicabile più volte.

-- 1) Categoria riga sui dettagli fattura.
alter table public.supplier_invoice_items
  add column if not exists kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'supplier_invoice_items_kind_check'
  ) then
    alter table public.supplier_invoice_items
      add constraint supplier_invoice_items_kind_check
      check (kind is null or kind in ('goods', 'service', 'charge'));
  end if;
end $$;

-- 2) Split calcolato sull'header alla conferma (il P&L legge questi, niente doppio conteggio).
alter table public.supplier_invoices
  add column if not exists goods_total numeric(12,2),
  add column if not exists service_total numeric(12,2);

-- 3) Entità fornitore (chiude il gap "no supplier entity"), minimale.
create table if not exists public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  vat text,
  default_kind text check (default_kind is null or default_kind in ('goods', 'service', 'charge')),
  created_at timestamptz not null default now()
);

create index if not exists idx_suppliers_tenant on public.suppliers (tenant_id);
create unique index if not exists uq_suppliers_tenant_vat
  on public.suppliers (tenant_id, vat) where vat is not null;

-- Collega la fattura al fornitore (mantengo supplier_name/supplier_vat testo come back-compat OCR).
alter table public.supplier_invoices
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists idx_supplier_invoices_supplier on public.supplier_invoices (supplier_id);

-- RLS — membri full, platform admin full (specchio di ingredients / stock_lots).
alter table public.suppliers enable row level security;

drop policy if exists "suppliers tenant access" on public.suppliers;
create policy "suppliers tenant access" on public.suppliers
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

drop policy if exists "suppliers admin access" on public.suppliers;
create policy "suppliers admin access" on public.suppliers
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
