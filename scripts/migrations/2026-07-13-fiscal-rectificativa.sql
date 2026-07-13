-- VeriFactu — rettificative R5 (reso / storno parziale dopo il pagamento)
--
-- Il pezzo mancante della Fase 2. Fino a oggi la cassa sapeva fare una cosa sola
-- quando un incasso andava corretto: annullarlo TUTTO (fn_cassa_void_atomic). Ma
-- il caso vero al banco non è quasi mai quello: il cliente ha pagato cinque birre,
-- due erano sbagliate, si restituiscono quelle. Annullare l'intero scontrino per
-- rendere 8 € su 40 è una bugia contabile — cancella un incasso che è avvenuto.
--
-- La forma corretta, sotto RD 1007/2023, è una FATTURA RETTIFICATIVA: un NUOVO
-- documento, con un NUOVO numero, che entra in catena come un `alta` di tipo R5
-- (rectificativa de factura simplificada) e che PUNTA all'originale tramite il
-- campo `rectifica`. L'originale resta esattamente dov'era, valido e immutabile.
--
-- Perché "por diferencias" e non "por sustitución" (art. 15 RD 1619/2012 lascia
-- entrambe): per diferencias la rettificativa porta SOLO il delta — qui, importi
-- NEGATIVI pari a ciò che si rende. È l'unica delle due che si compone senza
-- ambiguità con una catena append-only: non "riscrive" l'originale, gli si somma.
--
-- Invarianti (le stesse del resto del modulo, ripetute qui perché è dove si
-- rompono più facilmente):
--   • Una riga compensativa NEGATIVA in pos_sales, mai una DELETE né una UPDATE.
--   • Tutto in UNA transazione: se il record fiscale viene rifiutato, il reso non
--     è avvenuto — meglio un cassiere che riprova che un rimborso senza registro.
--   • Non si può rendere più di quanto è stato venduto: il totale già reso è
--     ricalcolato dal registro a ogni chiamata, sotto il lock della catena.

-- ---------------------------------------------------------------------------
-- 0) Il totale reso, sull'ordine
-- ---------------------------------------------------------------------------
-- Ridondante rispetto al registro (che resta la verità) ma la UI non deve
-- percorrere una catena di hash per stampare un badge "reso 8,00 €".
alter table public.cassa_orders
  add column if not exists refunded_total numeric not null default 0;

-- ---------------------------------------------------------------------------
-- 1) Quanto è già stato reso su questo scontrino
-- ---------------------------------------------------------------------------
-- Somma degli importi (negativi) delle rettificative già in catena per l'ordine.
-- Ritorna un valore POSITIVO: "di questo scontrino sono già stati resi X €".
-- Legge dal registro, non da un contatore a parte: un contatore può divergere,
-- il registro no — è la definizione stessa di ciò che è successo.
create or replace function public.fn_fiscal_refunded_total(
  p_tenant_id uuid,
  p_order_id uuid
) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(-sum(importe_total), 0)::numeric
    from public.fiscal_records
   where tenant_id = p_tenant_id
     and cassa_order_id = p_order_id
     and tipo = 'alta'
     and tipo_factura = 'R5';
$$;

-- ---------------------------------------------------------------------------
-- 2) fn_cassa_rectify_atomic — il reso parziale, tutto in una transazione
-- ---------------------------------------------------------------------------
-- p_desglose / p_cuota_total / p_importe_total arrivano NEGATIVI dall'app (è la
-- matematica dei soldi, che resta in TypeScript — vedi src/lib/cassa/totals.ts —
-- e che qui viene solo VERIFICATA, mai ricalcolata).
--
-- Il numero: la rettificativa consuma un numero dalla STESSA serie degli scontrini
-- (cassa_counters). Non una numerazione separata — la catena è una sola, e un
-- documento fiscale che non ha un numero della serie non esiste per AEAT.
create or replace function public.fn_cassa_rectify_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text,
  p_rectified_by uuid,
  p_business_date date,
  p_year integer,
  p_closed_at timestamptz,
  -- il delta, NEGATIVO
  p_net_total numeric,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_desglose jsonb,
  -- fiscal (ES) — false/null in Italia, dove ci si ferma al passo 4
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_serie text default '',
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.cassa_orders%rowtype;
  v_sale public.pos_sales%rowtype;
  v_orig_num text;
  v_num_serie text;
  v_no integer;
  v_record_id uuid := null;
  v_huella text := null;
  v_refunded numeric;
  v_amount numeric;
begin
  -- Il reso ha senso su un incasso avvenuto e non annullato. Uno scontrino `void`
  -- è già stato azzerato per intero: rettificarlo significherebbe rendere denaro
  -- che è già stato reso.
  select * into v_order
    from public.cassa_orders
   where id = p_order_id and tenant_id = p_tenant_id and status = 'paid'
   for update;

  if v_order.id is null then
    return jsonb_build_object('rectified', false, 'reason', 'order_not_paid');
  end if;

  -- L'importo del reso, come numero positivo.
  v_amount := -round(coalesce(p_importe_total, 0), 2);
  if v_amount <= 0 then
    raise exception 'fiscal: una rettificativa deve avere importo negativo (ricevuto %)', p_importe_total;
  end if;

  -- Non si rende più di quanto incassato. Il già-reso è letto dal registro, e
  -- questa riga gira DENTRO la transazione che ha appena preso `for update`
  -- sull'ordine: due cassieri che rendono lo stesso piatto nello stesso istante
  -- non possono superare il totale in due mosse concorrenti.
  v_refunded := public.fn_fiscal_refunded_total(p_tenant_id, p_order_id);
  if round(v_refunded + v_amount, 2) > round(v_order.total, 2) then
    raise exception 'fiscal: reso % € oltre il residuo (scontrino % €, già reso % €)',
      v_amount, v_order.total, v_refunded;
  end if;

  -- La vendita canonica originale (assente su ordini molto vecchi).
  select * into v_sale
    from public.pos_sales
   where tenant_id = p_tenant_id and provider = 'cassa' and external_id = p_order_id::text
   order by created_at
   limit 1;

  v_orig_num := coalesce(v_sale.raw_payload->>'num_serie', '');
  if v_orig_num = '' then
    v_orig_num := coalesce(v_order.receipt_year::text, '') || '/' ||
                  lpad(coalesce(v_order.receipt_number, 0)::text, 6, '0');
  end if;

  -- Un numero NUOVO, dalla stessa serie: la rettificativa è un documento a sé.
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_no;

  v_num_serie := coalesce(p_serie,'') || p_year::text || '/' || lpad(v_no::text, 6, '0');

  -- La riga compensativa: stessa forma, segno opposto. Il P&L torna da solo
  -- (la coppia somma al netto reale) e non si perde nulla.
  insert into public.pos_sales (
    tenant_id, provider, external_id, channel, business_date, closed_at, currency,
    gross_total, net_total, tax_total, discount_total, covers, payment_method,
    order_ref, raw_payload
  ) values (
    p_tenant_id, 'cassa', p_order_id::text || ':rect:' || v_no::text,
    coalesce(v_sale.channel, 'sala'), p_business_date, p_closed_at, 'EUR',
    round(coalesce(p_importe_total,0), 2),
    round(coalesce(p_net_total,0), 2),
    round(coalesce(p_cuota_total,0), 2),
    0, null, coalesce(v_sale.payment_method, 'cash'),
    'rettifica ' || v_orig_num,
    jsonb_build_object(
      'source', 'cassa_nativa',
      'rectifies', p_order_id,
      'rectifies_num_serie', v_orig_num,
      'num_serie', v_num_serie,
      'reason', p_reason,
      'desglose', coalesce(p_desglose, '[]'::jsonb)
    )
  );

  -- Spagna: la rettificativa entra in catena come `alta` di tipo R5, con il
  -- puntatore all'originale. In Italia ci si ferma qui — la riga compensativa
  -- sopra è già tutto ciò che serve, ed è comunque una correzione tracciata.
  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id e fecha_hora_huso sono richiesti quando p_fiscal è true';
    end if;

    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'alta', v_num_serie, p_business_date, 'R5',
      p_desglose, p_cuota_total, p_importe_total, p_fecha_hora_huso, p_sistema, p_order_id,
      -- `rectifica`: chi sto rettificando, e come. `por_diferencias` è ciò che i
      -- numeri negativi qui sopra SONO — dichiararlo `por_sustitucion` mentre si
      -- inviano dei delta farebbe archiviare ad AEAT un totale sbagliato.
      jsonb_build_object(
        'tipo', 'por_diferencias',
        'num_serie', v_orig_num,
        'fecha_expedicion', coalesce(v_order.receipt_date, p_business_date),
        'motivo', p_reason
      )
    );
    select huella into v_huella from public.fiscal_records where id = v_record_id;
  end if;

  -- Traccia sull'ordine: quanto è stato reso in tutto, così la UI lo mostra senza
  -- dover interrogare la catena a ogni render.
  update public.cassa_orders
     set refunded_total = round(v_refunded + v_amount, 2),
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'rectified', true,
    'num_serie', v_num_serie,
    'receipt_number', v_no,
    'rectifies_num_serie', v_orig_num,
    'refunded_total', round(v_refunded + v_amount, 2),
    'fiscal_record_id', v_record_id,
    'huella', v_huella
  );
end $$;
