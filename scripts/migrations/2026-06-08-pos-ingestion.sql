-- ============================================
-- 2026-06-08: POS ingestion (gestionale, part 1/2)
-- ============================================
-- Canonical, POS-agnostic ingestion layer. Everything downstream (dashboards,
-- food cost, P&L, assistant) reads ONLY pos_sales / pos_sale_items — never a
-- vendor format. Each till is an adapter that maps its shape onto these tables;
-- a MockAdapter fills them with realistic fake sales today, a real adapter
-- (Cassa in Cloud, Tilby…) drops in tomorrow with zero downstream changes.
--
-- No dependency on the management tables — this migration runs first.
-- supplier_invoice_items.ingredient_id is a NAKED uuid here; the FK is added by
-- 2026-06-08-management-foodcost.sql once the ingredients table exists.

-- ============================================
-- 1. POS connections (one active adapter per tenant; 'mock' by default)
-- ============================================
create table if not exists public.pos_connections (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'mock'
    check (provider in ('mock','cassa_in_cloud','tilby','ipratico','nempos','deliverect')),
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,        -- NON-secret: shop id, cursor…
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok','error') or last_sync_status is null),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pos_connections_tenant on public.pos_connections(tenant_id);
create index if not exists idx_pos_connections_active on public.pos_connections(active) where active = true;
create unique index if not exists uq_pos_connections_tenant_provider
  on public.pos_connections(tenant_id, provider);

-- ============================================
-- 2. Encrypted credentials — dedicated table, service-role ONLY (see RLS)
-- ============================================
create table if not exists public.pos_credentials (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.pos_connections(id) on delete cascade,
  secret_enc text not null,                          -- AES-256-GCM (POS_CRED_ENC_KEY)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pos_credentials_connection unique (connection_id)
);
create index if not exists idx_pos_credentials_tenant on public.pos_credentials(tenant_id);

-- ============================================
-- 3. Canonical sales (fact table SUPERSET: all 5 tills fit inside)
-- ============================================
create table if not exists public.pos_sales (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.pos_connections(id) on delete set null,
  provider text not null,
  external_id text not null,                          -- id in the till → idempotent upsert
  channel text not null default 'sala' check (channel in ('sala','asporto','delivery')),
  channel_source text,                                -- glovo/justeat/… for delivery, else null
  business_date date not null,                        -- service day (local)
  closed_at timestamptz not null,                     -- bill-close timestamp
  currency text not null default 'EUR',
  gross_total numeric(12,2) not null default 0,
  net_total numeric(12,2),
  tax_total numeric(12,2),
  discount_total numeric(12,2) not null default 0,
  fees_total numeric(12,2) not null default 0,        -- aggregator commission (0 for POS)
  tip_total numeric(12,2) not null default 0,
  covers integer,                                     -- coperti: NULL for asporto/delivery
  payment_method text check (payment_method in
    ('cash','card','online','meal_voucher','bank_transfer','other') or payment_method is null),
  order_ref text,
  raw_payload jsonb not null default '{}'::jsonb,     -- original raw record (forensic)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pos_sales_external unique (tenant_id, provider, external_id)
);
create index if not exists idx_pos_sales_tenant_date on public.pos_sales(tenant_id, business_date desc);
create index if not exists idx_pos_sales_tenant_channel on public.pos_sales(tenant_id, channel, business_date desc);
create index if not exists idx_pos_sales_connection on public.pos_sales(connection_id);

-- ============================================
-- 4. Sale lines (feed food cost via menu_item_id)
-- ============================================
create table if not exists public.pos_sale_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  external_product_id text,
  name text not null,
  category text,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  gross_total numeric(12,2) not null default 0,
  tax_rate numeric(5,2),
  menu_item_id uuid references public.menu_items(id) on delete set null,  -- SEAM food-cost
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_pos_sale_items_tenant on public.pos_sale_items(tenant_id);
create index if not exists idx_pos_sale_items_sale on public.pos_sale_items(sale_id);
create index if not exists idx_pos_sale_items_menu_item on public.pos_sale_items(menu_item_id);
create index if not exists idx_pos_sale_items_tenant_product on public.pos_sale_items(tenant_id, external_product_id);

-- ============================================
-- 5. Sync log (one row per attempt)
-- ============================================
create table if not exists public.pos_sync_log (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.pos_connections(id) on delete set null,
  provider text not null,
  trigger text not null default 'cron' check (trigger in ('cron','manual','backfill')),
  status text not null default 'running' check (status in ('running','ok','error')),
  window_from timestamptz,
  window_to timestamptz,
  sales_fetched integer not null default 0,
  sales_upserted integer not null default 0,
  sales_skipped integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_pos_sync_log_tenant on public.pos_sync_log(tenant_id, started_at desc);

-- ============================================
-- 6+7. Supplier invoices (header + lines)
-- ============================================
create table if not exists public.supplier_invoices (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'photo' check (source in ('photo','sdi_xml','manual')),
  supplier_name text,
  supplier_vat text,
  invoice_number text,
  invoice_date date,
  currency text not null default 'EUR',
  net_total numeric(12,2),
  tax_total numeric(12,2),
  gross_total numeric(12,2),
  status text not null default 'parsed' check (status in ('parsed','confirmed','error')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supplier_invoices_tenant on public.supplier_invoices(tenant_id, invoice_date desc);
create unique index if not exists uq_supplier_invoices_number
  on public.supplier_invoices(tenant_id, supplier_vat, invoice_number)
  where supplier_vat is not null and invoice_number is not null;

create table if not exists public.supplier_invoice_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,3),
  unit text,
  unit_price numeric(12,4),
  line_total numeric(12,2),
  tax_rate numeric(5,2),
  ingredient_id uuid,                                 -- SEAM: FK added by Migration 2
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_sii_tenant on public.supplier_invoice_items(tenant_id);
create index if not exists idx_sii_invoice on public.supplier_invoice_items(invoice_id);
create index if not exists idx_sii_ingredient on public.supplier_invoice_items(ingredient_id);

-- ============================================
-- RLS
-- ============================================
-- pos_sales / pos_sale_items / pos_sync_log: members read-only (the service-role
-- cron writes them; service-role bypasses RLS, so no member write policy).
-- pos_connections / supplier_invoices / supplier_invoice_items: members full
-- (the owner manages them). pos_credentials: NO member policy at all (only the
-- admin policy + service-role bypass can touch secrets). All tables also get the
-- platform-admin policy.
alter table public.pos_connections enable row level security;
alter table public.pos_credentials enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_sync_log enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;

-- Member: full access
create policy "pos_connections tenant access" on public.pos_connections
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "supplier_invoices tenant access" on public.supplier_invoices
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "supplier_invoice_items tenant access" on public.supplier_invoice_items
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

-- Member: SELECT only (writes are service-role)
create policy "pos_sales tenant read" on public.pos_sales
  for select using (private.is_tenant_member(tenant_id));
create policy "pos_sale_items tenant read" on public.pos_sale_items
  for select using (private.is_tenant_member(tenant_id));
create policy "pos_sync_log tenant read" on public.pos_sync_log
  for select using (private.is_tenant_member(tenant_id));

-- pos_credentials: NO member policy (service-role + admin only).

-- Platform admin: full access on every table
create policy "pos_connections admin access" on public.pos_connections
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_credentials admin access" on public.pos_credentials
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sales admin access" on public.pos_sales
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sale_items admin access" on public.pos_sale_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sync_log admin access" on public.pos_sync_log
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "supplier_invoices admin access" on public.supplier_invoices
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "supplier_invoice_items admin access" on public.supplier_invoice_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
