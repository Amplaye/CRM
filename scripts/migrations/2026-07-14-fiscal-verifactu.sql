-- ============================================================================
-- VERI*FACTU — registro de facturación (RD 1007/2023 + Orden HAC/1177/2024)
-- 2026-07-14
--
-- What this adds, and why it is shaped this way:
--
--   • THE CHAIN IS PER NIF, NOT PER TENANT. Art. 2 of the Orden + art. 7 RRSIF
--     require the software to behave as N logically independent SIF, one per
--     obligado tributario. So `fiscal_obligados` (the NIF) owns the chain and a
--     tenant POINTS AT one. Two venues under the same NIF share a chain; a venue
--     can never sit on two.
--
--   • `fiscal_records` IS PHYSICALLY IMMUTABLE. A BEFORE UPDATE/DELETE/TRUNCATE
--     trigger always raises — for the service_role too. Everything that legally
--     MUST mutate (send status, attempts, AEAT's answer) lives in the separate
--     `fiscal_submissions` table. That split is what lets the register be truly
--     append-only AND still have a working send queue.
--
--   • THE HUELLA IS COMPUTED IN SQL, inside the same transaction that locks the
--     chain head (`select … for update`). Computing it in the app would let two
--     tills cashing at the same instant read the same prev_huella and fork the
--     chain. src/lib/fiscal/huella.ts mirrors these functions and a unit test
--     asserts both produce AEAT's published golden vector.
--
--   • THE MONEY MATH STAYS IN TYPESCRIPT. src/lib/cassa/totals.ts is already
--     cent-exact (largest-remainder discount spreading) and tested. The RPC takes
--     the desglose as jsonb and VERIFIES its internal coherence (bases + cuotas
--     must add up to the totals) rather than recomputing it in plpgsql.
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) The obligado tributario — the owner of a chain
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_obligados (
  id uuid default uuid_generate_v4() primary key,
  nif text not null unique,                          -- normalized: uppercase, alphanumeric only
  razon_social text not null default '',
  domicilio jsonb not null default '{}'::jsonb,      -- { via, cp, municipio, provincia, pais }
  regimen text not null default 'iva_peninsular'
    check (regimen in ('iva_peninsular','igic_canarias')),
  -- WHO issues the invoices for this NIF. Exactly one is true, and `none` is the
  -- non-compliant combination we must BLOCK rather than paper over:
  --   native   → our cassa issues; we are the SIF; we send to AEAT.
  --   external → an already-compliant external POS issues; we send NOTHING and
  --              only import its sales for analytics.
  --   none     → nobody is compliant. The cassa refuses to take money.
  sif_mode text not null default 'none'
    check (sif_mode in ('native','external','none')),
  -- Verifacti (colaborador social) holds the certificate and the representation
  -- mandate; this is their id for this NIF. Null until onboarding completes.
  verifacti_nif_id text,
  mandate_signed_at timestamptz,
  mandate_evidence jsonb not null default '{}'::jsonb,  -- signature id, document url, ip, timestamp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A NIF is only ever compared in its normalized form — "B-12345678 " and
-- "b12345678" are the same taxpayer and must never open two chains.
create or replace function public.fn_fiscal_normalize_nif()
returns trigger language plpgsql as $$
begin
  new.nif := upper(regexp_replace(coalesce(new.nif,''), '[^A-Za-z0-9]', '', 'g'));
  if new.nif = '' then
    raise exception 'fiscal_obligados.nif cannot be empty';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_fiscal_normalize_nif on public.fiscal_obligados;
create trigger trg_fiscal_normalize_nif
  before insert or update on public.fiscal_obligados
  for each row execute function public.fn_fiscal_normalize_nif();

-- A tenant belongs to at most ONE obligado. `fiscal_serie` disambiguates the
-- numbering when several venues share a NIF (and therefore a chain): the series
-- prefix keeps NumSerieFactura unique across the chain.
alter table public.tenants
  add column if not exists fiscal_obligado_id uuid references public.fiscal_obligados(id) on delete set null;
alter table public.tenants
  add column if not exists fiscal_serie text not null default '';

create index if not exists idx_tenants_fiscal_obligado
  on public.tenants (fiscal_obligado_id) where fiscal_obligado_id is not null;

-- The invoice number AEAT knows this ticket by, denormalized onto the order so a
-- receipt can be RE-PRINTED (with its QR) months later without walking the chain.
alter table public.cassa_orders
  add column if not exists fiscal_num_serie text;

-- ---------------------------------------------------------------------------
-- 2) The head of each chain — the row that serializes concurrent payments
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_chain_heads (
  obligado_id uuid primary key references public.fiscal_obligados(id) on delete cascade,
  last_huella text,                                  -- null → the chain is empty (PrimerRegistro="S")
  last_record_id uuid,
  record_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) The register — APPEND-ONLY
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_records (
  id uuid default uuid_generate_v4() primary key,
  obligado_id uuid not null references public.fiscal_obligados(id) on delete restrict,
  -- Which venue emitted it. Nullable-on-delete so a tenant purge can never take a
  -- fiscal record with it (the register outlives the CRM account: 4-year duty).
  tenant_id uuid references public.tenants(id) on delete set null,
  tipo text not null check (tipo in ('alta','anulacion')),
  num_serie text not null,                           -- e.g. "2026/000123" (with the tenant's serie prefix)
  fecha_expedicion date not null,
  -- F2 = factura simplificada (our tickets). R5 = rectificativa de simplificada.
  tipo_factura text not null default 'F2'
    check (tipo_factura in ('F1','F2','R1','R2','R3','R4','R5')),
  -- Per-rate breakdown, AEAT field names:
  -- [{ Impuesto, ClaveRegimen, CalificacionOperacion, TipoImpositivo,
  --    BaseImponible, CuotaRepercutida }]
  desglose jsonb not null default '[]'::jsonb,
  cuota_total numeric(12,2) not null default 0,
  importe_total numeric(12,2) not null default 0,
  -- Rectificativa linkage: { TipoRectificativa, FacturasRectificadas: [{num_serie, fecha}] }
  rectifica jsonb,
  prev_huella text,                                  -- null only for the first record of a chain
  huella text not null,
  fecha_hora_huso text not null,                     -- ISO-8601 WITH the venue's offset, e.g. 2026-07-14T13:05:00+02:00
  sistema_informatico jsonb not null default '{}'::jsonb,  -- the machine-readable echo of our declaración responsable
  cassa_order_id uuid references public.cassa_orders(id) on delete set null,
  chain_index bigint not null,
  created_at timestamptz not null default now(),
  -- One alta and at most one anulacion per invoice number, per chain.
  unique (obligado_id, tipo, num_serie)
);

create index if not exists idx_fiscal_records_obligado
  on public.fiscal_records (obligado_id, chain_index);
create index if not exists idx_fiscal_records_tenant
  on public.fiscal_records (tenant_id, created_at desc);
create index if not exists idx_fiscal_records_order
  on public.fiscal_records (cassa_order_id) where cassa_order_id is not null;

-- INALTERABILIDAD (art. 7.2 RRSIF). This trigger is the whole guarantee: without
-- it "append-only" is a convention, and a convention is not a register.
-- Modelled on trg_prevent_global_role_change — but with NO service_role escape
-- hatch, because the point is that not even we can rewrite a ticket.
create or replace function public.fn_fiscal_records_immutable()
returns trigger language plpgsql as $$
begin
  raise exception
    'fiscal_records is append-only (RRSIF art. 7 — inalterabilidad): % is not permitted. Correct a record by chaining an anulacion or a rectificativa.',
    tg_op;
end $$;

drop trigger if exists trg_fiscal_records_immutable on public.fiscal_records;
create trigger trg_fiscal_records_immutable
  before update or delete on public.fiscal_records
  for each row execute function public.fn_fiscal_records_immutable();

drop trigger if exists trg_fiscal_records_no_truncate on public.fiscal_records;
create trigger trg_fiscal_records_no_truncate
  before truncate on public.fiscal_records
  for each statement execute function public.fn_fiscal_records_immutable();

-- ---------------------------------------------------------------------------
-- 4) The send queue — MUTABLE, deliberately a separate table
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_submissions (
  id uuid default uuid_generate_v4() primary key,
  record_id uuid not null unique references public.fiscal_records(id) on delete restrict,
  obligado_id uuid not null references public.fiscal_obligados(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sent','accepted','accepted_with_errors','rejected')),
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error text,
  aeat_csv text,                                     -- the CSV AEAT returns on acceptance
  provider_response jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The queue claim reads exactly this: what is due, oldest first.
create index if not exists idx_fiscal_submissions_due
  on public.fiscal_submissions (next_retry_at)
  where status in ('pending','sent');
create index if not exists idx_fiscal_submissions_tenant
  on public.fiscal_submissions (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 5) The huella — SQL side (mirrored by src/lib/fiscal/huella.ts)
-- ---------------------------------------------------------------------------

-- SHA-256 → 64 UPPERCASE hex chars. Lowercase hex is a rejected record.
--
-- `extensions.digest` is SCHEMA-QUALIFIED on purpose: pgcrypto lives in the
-- `extensions` schema on Supabase, and every function that chains a record is
-- security definer with `search_path = public, pg_temp` (as it must be — a
-- security definer with a loose search_path is a privilege-escalation hole). An
-- unqualified digest() therefore resolves fine from a plain query and NOT from
-- inside the chain, which fails exactly where it hurts most.
create or replace function public.fn_fiscal_huella(p_payload text)
returns text language sql immutable as $$
  select upper(encode(extensions.digest(p_payload, 'sha256'), 'hex'));
$$;

-- 2 decimals, dot separator, no grouping — the literal text that goes in the XML.
create or replace function public.fn_fiscal_amount(p_n numeric)
returns text language sql immutable as $$
  select to_char(coalesce(p_n, 0), 'FM9999999999990.00');
$$;

-- The canonical string of a RegistroAlta. Field order is AEAT's and is part of
-- the spec: change it and every hash in the chain becomes wrong.
create or replace function public.fn_fiscal_alta_payload(
  p_nif text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_tipo_factura text,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_prev_huella text,
  p_fecha_hora_huso text
) returns text language sql immutable as $$
  select 'IDEmisorFactura=' || coalesce(p_nif,'')
      || '&NumSerieFactura=' || coalesce(p_num_serie,'')
      || '&FechaExpedicionFactura=' || to_char(p_fecha_expedicion, 'DD-MM-YYYY')
      || '&TipoFactura=' || coalesce(p_tipo_factura,'')
      || '&CuotaTotal=' || public.fn_fiscal_amount(p_cuota_total)
      || '&ImporteTotal=' || public.fn_fiscal_amount(p_importe_total)
      || '&Huella=' || coalesce(p_prev_huella,'')
      || '&FechaHoraHusoGenRegistro=' || coalesce(p_fecha_hora_huso,'');
$$;

-- The canonical string of a RegistroAnulacion. It names the invoice being killed;
-- an annulment is not an invoice of its own.
create or replace function public.fn_fiscal_anulacion_payload(
  p_nif text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_prev_huella text,
  p_fecha_hora_huso text
) returns text language sql immutable as $$
  select 'IDEmisorFacturaAnulada=' || coalesce(p_nif,'')
      || '&NumSerieFacturaAnulada=' || coalesce(p_num_serie,'')
      || '&FechaExpedicionFacturaAnulada=' || to_char(p_fecha_expedicion, 'DD-MM-YYYY')
      || '&Huella=' || coalesce(p_prev_huella,'')
      || '&FechaHoraHusoGenRegistro=' || coalesce(p_fecha_hora_huso,'');
$$;

-- ---------------------------------------------------------------------------
-- 6) Desglose coherence — the RPC verifies, it does not recompute
-- ---------------------------------------------------------------------------
-- Raises unless every line's Base + Cuota adds up to the invoice totals it claims.
-- A ticket whose breakdown doesn't add up is rejected by AEAT *after* the guest
-- has left with the receipt, so we refuse it while we can still say no.
create or replace function public.fn_fiscal_assert_desglose(
  p_desglose jsonb,
  p_cuota_total numeric,
  p_importe_total numeric
) returns void language plpgsql immutable as $$
declare
  v_base numeric := 0;
  v_cuota numeric := 0;
  v_line jsonb;
begin
  if jsonb_typeof(p_desglose) <> 'array' or jsonb_array_length(p_desglose) = 0 then
    raise exception 'fiscal: desglose must be a non-empty array';
  end if;

  for v_line in select * from jsonb_array_elements(p_desglose) loop
    if coalesce(v_line->>'Impuesto','') = '' then
      -- AEAT silently assumes 01 (IVA) when Impuesto is missing: a Canary ticket
      -- would be filed as mainland VAT and nobody would notice for a year.
      raise exception 'fiscal: desglose line without an explicit Impuesto (01 IVA / 03 IGIC)';
    end if;
    v_base := v_base + coalesce((v_line->>'BaseImponible')::numeric, 0);
    v_cuota := v_cuota + coalesce((v_line->>'CuotaRepercutida')::numeric, 0);
  end loop;

  if round(v_cuota, 2) <> round(coalesce(p_cuota_total,0), 2) then
    raise exception 'fiscal: CuotaTotal % does not match the sum of the desglose (%)',
      p_cuota_total, v_cuota;
  end if;
  if round(v_base + v_cuota, 2) <> round(coalesce(p_importe_total,0), 2) then
    raise exception 'fiscal: ImporteTotal % does not match Base+Cuota of the desglose (%)',
      p_importe_total, v_base + v_cuota;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Appending to the chain — always under the head lock
-- ---------------------------------------------------------------------------
-- Called from inside fn_cassa_pay_atomic / fn_cassa_void_atomic, i.e. always in a
-- transaction that has already done its own work. `for update` on the head row is
-- what serializes two tills cashing in the same millisecond: the second waits,
-- reads the first one's huella, and the chain stays a chain.
create or replace function public.fn_fiscal_append(
  p_obligado_id uuid,
  p_tenant_id uuid,
  p_tipo text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_tipo_factura text,
  p_desglose jsonb,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_fecha_hora_huso text,
  p_sistema jsonb,
  p_cassa_order_id uuid,
  p_rectifica jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nif text;
  v_prev text;
  v_count bigint;
  v_payload text;
  v_huella text;
  v_id uuid;
begin
  select nif into v_nif from public.fiscal_obligados where id = p_obligado_id;
  if v_nif is null then
    raise exception 'fiscal: unknown obligado %', p_obligado_id;
  end if;

  if p_tipo = 'alta' then
    perform public.fn_fiscal_assert_desglose(p_desglose, p_cuota_total, p_importe_total);
  end if;

  -- Create the head on first use, then LOCK it. Both tills that race here take
  -- this same row, so exactly one of them can be reading prev_huella at a time.
  insert into public.fiscal_chain_heads (obligado_id)
  values (p_obligado_id)
  on conflict (obligado_id) do nothing;

  select last_huella, record_count into v_prev, v_count
  from public.fiscal_chain_heads
  where obligado_id = p_obligado_id
  for update;

  if p_tipo = 'alta' then
    v_payload := public.fn_fiscal_alta_payload(
      v_nif, p_num_serie, p_fecha_expedicion, p_tipo_factura,
      p_cuota_total, p_importe_total, v_prev, p_fecha_hora_huso);
  else
    v_payload := public.fn_fiscal_anulacion_payload(
      v_nif, p_num_serie, p_fecha_expedicion, v_prev, p_fecha_hora_huso);
  end if;
  v_huella := public.fn_fiscal_huella(v_payload);

  insert into public.fiscal_records (
    obligado_id, tenant_id, tipo, num_serie, fecha_expedicion, tipo_factura,
    desglose, cuota_total, importe_total, rectifica,
    prev_huella, huella, fecha_hora_huso, sistema_informatico,
    cassa_order_id, chain_index
  ) values (
    p_obligado_id, p_tenant_id, p_tipo, p_num_serie, p_fecha_expedicion, p_tipo_factura,
    coalesce(p_desglose, '[]'::jsonb), coalesce(p_cuota_total, 0), coalesce(p_importe_total, 0), p_rectifica,
    v_prev, v_huella, p_fecha_hora_huso, coalesce(p_sistema, '{}'::jsonb),
    p_cassa_order_id, v_count + 1
  ) returning id into v_id;

  update public.fiscal_chain_heads
     set last_huella = v_huella,
         last_record_id = v_id,
         record_count = v_count + 1,
         updated_at = now()
   where obligado_id = p_obligado_id;

  -- Queue it. Inline sending happens right after COMMIT; this row is the promise
  -- that it gets there even if the network is down and the browser is closed.
  insert into public.fiscal_submissions (record_id, obligado_id, tenant_id)
  values (v_id, p_obligado_id, p_tenant_id);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8) Verify a whole chain — recompute every huella from scratch
-- ---------------------------------------------------------------------------
-- The auditable claim of the whole system: run this and the stored hashes must
-- come back out. Used by the fiscal E2E and by Settings → Fiscale.
create or replace function public.fn_fiscal_verify_chain(p_obligado_id uuid)
returns table (ok boolean, checked bigint, first_broken_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nif text;
  v_prev text := null;
  v_rec record;
  v_expected text;
  v_n bigint := 0;
begin
  select nif into v_nif from public.fiscal_obligados where id = p_obligado_id;

  for v_rec in
    select * from public.fiscal_records
     where obligado_id = p_obligado_id
     order by chain_index
  loop
    if v_rec.tipo = 'alta' then
      v_expected := public.fn_fiscal_huella(public.fn_fiscal_alta_payload(
        v_nif, v_rec.num_serie, v_rec.fecha_expedicion, v_rec.tipo_factura,
        v_rec.cuota_total, v_rec.importe_total, v_prev, v_rec.fecha_hora_huso));
    else
      v_expected := public.fn_fiscal_huella(public.fn_fiscal_anulacion_payload(
        v_nif, v_rec.num_serie, v_rec.fecha_expedicion, v_prev, v_rec.fecha_hora_huso));
    end if;

    if v_expected <> v_rec.huella or coalesce(v_rec.prev_huella,'') <> coalesce(v_prev,'') then
      ok := false; checked := v_n; first_broken_id := v_rec.id;
      return next;
      return;
    end if;

    v_prev := v_rec.huella;
    v_n := v_n + 1;
  end loop;

  ok := true; checked := v_n; first_broken_id := null;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 9) fn_cassa_pay_atomic — ONE transaction for the whole money moment
-- ---------------------------------------------------------------------------
-- Replaces the claim-then-number-then-hope sequence in pay/route.ts. Before this,
-- an order was flipped to `paid` and the receipt number was minted in a SEPARATE
-- statement: if the second failed, the number was burned and the sequence had a
-- hole. Merely annoying in Italy; FATAL under a chained register, where a hole is
-- an unexplainable gap in a hash chain.
--
-- Everything here commits or nothing does: claim → number → fiscal record →
-- canonical sale. A rejected desglose therefore leaves the order OPEN and the
-- counter untouched — the till says no, which is the only honest answer.
create or replace function public.fn_cassa_pay_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_session_id uuid,
  p_business_date date,
  p_year integer,
  p_closed_at timestamptz,
  p_subtotal numeric,
  p_total numeric,
  p_discount numeric,
  p_net_total numeric,
  p_cuota_total numeric,
  p_desglose jsonb,
  p_channel text,
  p_covers integer,
  p_payment_method text,
  -- fiscal (ES) — all null/false for Italy, which stops after step 4
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_serie text default '',
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claimed uuid;
  v_no integer;
  v_num_serie text;
  v_sale_id uuid;
  v_record_id uuid := null;
  v_huella text := null;
begin
  -- 1) claim the bill (double-tap safe)
  update public.cassa_orders
     set status = 'paid',
         closed_at = p_closed_at,
         session_id = p_session_id,
         subtotal = p_subtotal,
         total = p_total,
         receipt_date = p_business_date,
         receipt_year = p_year,
         updated_at = now()
   where id = p_order_id
     and tenant_id = p_tenant_id
     and status = 'open'
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- 2) mint the receipt number (gapless: same transaction as the claim)
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_no;

  v_num_serie := coalesce(p_serie,'') || p_year::text || '/' || lpad(v_no::text, 6, '0');

  update public.cassa_orders
     set receipt_number = v_no,
         fiscal_num_serie = case when p_fiscal then v_num_serie else null end
   where id = p_order_id;

  -- 3) the canonical sale — now WITH its fiscal breakdown, which until today was
  --    computed for the printout and thrown away (net_total/tax_total were null).
  insert into public.pos_sales (
    tenant_id, provider, external_id, channel, business_date, closed_at, currency,
    gross_total, net_total, tax_total, discount_total, covers, payment_method,
    order_ref, raw_payload
  ) values (
    p_tenant_id, 'cassa', p_order_id::text, p_channel, p_business_date, p_closed_at, 'EUR',
    p_total, p_net_total, p_cuota_total, coalesce(p_discount,0),
    case when p_channel = 'sala' and coalesce(p_covers,0) > 0 then p_covers else null end,
    p_payment_method,
    'cassa #' || v_no || '/' || p_year,
    jsonb_build_object(
      'source', 'cassa_nativa',
      'order_id', p_order_id,
      'receipt_number', v_no,
      'receipt_year', p_year,
      'num_serie', v_num_serie,
      'desglose', coalesce(p_desglose, '[]'::jsonb)
    )
  ) returning id into v_sale_id;

  -- 4) Italy stops here. Spain chains the record — in THIS transaction, so a
  --    rejected record un-cashes the bill instead of leaving an unregistered sale.
  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id and fecha_hora_huso are required when p_fiscal is true';
    end if;
    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'alta', v_num_serie, p_business_date, 'F2',
      p_desglose, p_cuota_total, p_total, p_fecha_hora_huso, p_sistema, p_order_id, null);
    select huella into v_huella from public.fiscal_records where id = v_record_id;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'receipt_number', v_no,
    'receipt_year', p_year,
    'num_serie', v_num_serie,
    'sale_id', v_sale_id,
    'fiscal_record_id', v_record_id,
    'huella', v_huella
  );
end $$;

-- ---------------------------------------------------------------------------
-- 10) fn_cassa_void_atomic — an annulment is a RECORD, never a DELETE
-- ---------------------------------------------------------------------------
-- void/route.ts used to `delete from pos_sales`: it physically erased a sale that
-- had already been cashed. Under a fiscal register that is exactly the act the
-- law forbids. Now the order flips to `void`, a RegistroAnulacion is chained, and
-- pos_sales gets a COMPENSATING NEGATIVE ROW. Analytics still add up (the pair
-- sums to zero) and nothing is ever removed.
create or replace function public.fn_cassa_void_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text,
  p_voided_by uuid,
  p_business_date date,
  p_closed_at timestamptz,
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.cassa_orders%rowtype;
  v_sale public.pos_sales%rowtype;
  v_num_serie text;
  v_record_id uuid := null;
begin
  update public.cassa_orders
     set status = 'void',
         void_reason = p_reason,
         voided_at = p_closed_at,
         voided_by = p_voided_by,
         updated_at = now()
   where id = p_order_id
     and tenant_id = p_tenant_id
     and status = 'paid'
  returning * into v_order;

  if v_order.id is null then
    return jsonb_build_object('voided', false);
  end if;

  -- The original canonical sale (may be absent on very old orders).
  select * into v_sale
    from public.pos_sales
   where tenant_id = p_tenant_id and provider = 'cassa' and external_id = p_order_id::text
   order by created_at
   limit 1;

  v_num_serie := coalesce(v_sale.raw_payload->>'num_serie', '');
  if v_num_serie = '' then
    v_num_serie := coalesce(v_order.receipt_year::text, '') || '/' ||
                   lpad(coalesce(v_order.receipt_number, 0)::text, 6, '0');
  end if;

  -- The compensating row: same shape, opposite sign. Never a delete.
  if v_sale.id is not null then
    insert into public.pos_sales (
      tenant_id, provider, external_id, channel, business_date, closed_at, currency,
      gross_total, net_total, tax_total, discount_total, covers, payment_method,
      order_ref, raw_payload
    ) values (
      p_tenant_id, 'cassa', p_order_id::text || ':void', v_sale.channel, p_business_date, p_closed_at, 'EUR',
      -v_sale.gross_total, -coalesce(v_sale.net_total,0), -coalesce(v_sale.tax_total,0),
      -coalesce(v_sale.discount_total,0),
      case when v_sale.covers is not null then -v_sale.covers else null end,
      v_sale.payment_method,
      'annullo ' || coalesce(v_sale.order_ref, v_num_serie),
      jsonb_build_object(
        'source', 'cassa_nativa',
        'void_of', p_order_id,
        'num_serie', v_num_serie,
        'reason', p_reason
      )
    );
  end if;

  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id and fecha_hora_huso are required when p_fiscal is true';
    end if;
    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'anulacion', v_num_serie,
      coalesce(v_order.receipt_date, p_business_date), 'F2',
      '[]'::jsonb, 0, 0, p_fecha_hora_huso, p_sistema, p_order_id, null);
  end if;

  return jsonb_build_object(
    'voided', true,
    'num_serie', v_num_serie,
    'fiscal_record_id', v_record_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- 11) The send queue claim — concurrency-safe, one worker or ten
-- ---------------------------------------------------------------------------
create or replace function public.fn_fiscal_claim_pending(p_limit integer default 50)
returns setof public.fiscal_submissions
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select s.id from public.fiscal_submissions s
     join public.fiscal_obligados o on o.id = s.obligado_id
     where s.status in ('pending','sent')
       and s.next_retry_at <= now()
       -- ONLY a `native` obligado is ever transmitted. Defence in depth for the rule
       -- that matters most: when the venue's own POS is the compliant SIF (`external`)
       -- it is already filing these sales itself — sending ours too would give AEAT
       -- the same ticket twice, from two different systems. And an obligado in `none`
       -- has no business filing at all. The pay route already refuses to REGISTER for
       -- those modes; this makes sure that even a record that somehow exists can never
       -- LEAVE the building.
       and o.sif_mode = 'native'
     order by s.created_at
     limit greatest(1, coalesce(p_limit, 50))
     for update of s skip locked     -- two flushes running at once never take the same row
  )
  update public.fiscal_submissions s
     set attempts = s.attempts + 1,
         status = 'sent',
         sent_at = now(),
         -- Backoff while we wait for the answer: 1min, 2, 4, 8… capped at 1h,
         -- which is also the law's outer bound (art. 17: retry at least hourly).
         next_retry_at = now() + least(interval '1 hour',
                                       (interval '1 minute') * power(2, least(s.attempts, 6))),
         updated_at = now()
    from due
   where s.id = due.id
  returning s.*;
end $$;

-- ---------------------------------------------------------------------------
-- 12) RLS — read-only for members, invisible for the obligado
-- ---------------------------------------------------------------------------
alter table public.fiscal_obligados enable row level security;
alter table public.fiscal_chain_heads enable row level security;
alter table public.fiscal_records enable row level security;
alter table public.fiscal_submissions enable row level security;

-- Members may READ their own register (the law requires the pending count to be
-- visible to them) but may never write it: every write goes through the RPCs,
-- which run as service_role. Same shape as pos_sales.
drop policy if exists "fiscal_records tenant read" on public.fiscal_records;
create policy "fiscal_records tenant read" on public.fiscal_records
  for select using (private.is_tenant_member(tenant_id));

drop policy if exists "fiscal_submissions tenant read" on public.fiscal_submissions;
create policy "fiscal_submissions tenant read" on public.fiscal_submissions
  for select using (private.is_tenant_member(tenant_id));

-- fiscal_obligados / fiscal_chain_heads: NO member policy at all. The obligado row
-- carries the representation mandate that lets us file on the client's behalf —
-- the same reason pos_credentials has no member policy. Read it via the API, which
-- checks the role, not via a browser query.

drop policy if exists "fiscal_obligados admin access" on public.fiscal_obligados;
create policy "fiscal_obligados admin access" on public.fiscal_obligados
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_chain_heads admin access" on public.fiscal_chain_heads;
create policy "fiscal_chain_heads admin access" on public.fiscal_chain_heads
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_records admin access" on public.fiscal_records;
create policy "fiscal_records admin access" on public.fiscal_records
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_submissions admin access" on public.fiscal_submissions;
create policy "fiscal_submissions admin access" on public.fiscal_submissions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
