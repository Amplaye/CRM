// E2E for the VERI*FACTU register, driven straight against the database — the
// layer where the guarantees actually live. Standalone .mjs, like cassa-e2e.mjs.
//
//   SUPABASE_MGMT_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/fiscal-e2e.mjs
//
// What it proves, in order:
//
//   1. THE GOLDEN VECTOR. SQL reproduces AEAT's published huella, byte for byte.
//   2. THE CHAIN. Three records (two altas and an anulacion) link to each other,
//      and fn_fiscal_verify_chain recomputes every hash from scratch and gets the
//      stored ones back.
//   3. IMMUTABILITY. An UPDATE and a DELETE on fiscal_records are REFUSED — as the
//      service_role, which is the only kind of refusal that means anything.
//   4. THE DESGLOSE GATE. A breakdown that doesn't add up to the total is rejected
//      BEFORE it can be chained (an unfileable ticket must be refused while the
//      guest is still standing there, not after AEAT says no next week).
//   5. CONCURRENCY. Two payments landing on the same chain at the same instant
//      produce two records with two different huellas and no fork — because the
//      chain head is taken with `select … for update`.
//   6. THE QUEUE. An obligado whose invoices come from an EXTERNAL POS is never
//      claimed for sending (filing those would give AEAT the same sale twice —
//      once from us, once from their till).
//
// Steps 2-4 run inside a plpgsql block that ROLLS BACK, so the register is left
// exactly as it was found. Step 5 cannot (its whole point is two real, committed
// transactions racing), so it runs on a throwaway NIF in `none` mode — which, by
// step 6, can never be transmitted to anyone.

const TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_MGMT_TOKEN / SUPABASE_PROJECT_REF");
  process.exit(1);
}

const AEAT_GOLDEN = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";
// AEAT's own example NIF, from their published spec. Not a real taxpayer.
const TEST_NIF = "89890001K";
const CONC_NIF = "99999999R";

let failures = 0;
const ok = (m) => console.log(`   ✓ ${m}`);
const fail = (m) => {
  failures++;
  console.error(`   ✗ ${m}`);
};

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      // Cloudflare 403s (code 1010) a non-browser UA in front of api.supabase.com.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    // The DB's own message is carried on the error, unescaped: the rolled-back
    // scenario below smuggles its results out through exactly that channel.
    const err = new Error(`SQL ${res.status}: ${text}`);
    try {
      err.dbMessage = JSON.parse(text).message || "";
    } catch {
      err.dbMessage = text;
    }
    throw err;
  }
  return JSON.parse(text);
}

const DESGLOSE_IGIC =
  '[{"Impuesto":"03","ClaveRegimen":"01","CalificacionOperacion":"S1","TipoImpositivo":"7.00","BaseImponible":"1.40","CuotaRepercutida":"0.10"}]';
const DESGLOSE_IVA =
  '[{"Impuesto":"01","ClaveRegimen":"01","CalificacionOperacion":"S1","TipoImpositivo":"10.00","BaseImponible":"1.36","CuotaRepercutida":"0.14"}]';

async function main() {
  console.log("VERI*FACTU register E2E\n");

  // ---------------------------------------------------------------- 1) huella
  console.log("1. Golden vector (AEAT's published example)");
  {
    const [row] = await sql(`
      select public.fn_fiscal_huella(public.fn_fiscal_alta_payload(
        '89890001K','12345678/G33','2024-01-01'::date,'F1',12.35,123.45,'',
        '2024-01-01T19:20:30+01:00')) as h`);
    row.h === AEAT_GOLDEN
      ? ok(`SQL reproduces AEAT's huella: ${row.h.slice(0, 16)}…`)
      : fail(`expected ${AEAT_GOLDEN}, got ${row.h}`);
  }

  // ------------------------------------------- 2-4) chain, immutability, gate
  //
  // The Management API runs each request in its own session, so the whole scenario
  // is ONE plpgsql block: everything inside shares a transaction, and the final
  // `raise exception` rolls it all back — the register must not carry E2E fixtures
  // for the rest of its life. The results ride out in the error message, which is
  // the only channel that survives a rollback.
  console.log("\n2-4. Chain, immutability and the desglose gate (rolled back)");
  {
    const res = await sql(`
      do $e2e$
      declare
        v_ob uuid;
        v_r1 uuid; v_r2 uuid; v_r3 uuid;
        v_h1 text; v_h2 text; v_prev2 text;
        v_ok boolean; v_checked bigint;
        v_immutable_update boolean := false;
        v_immutable_delete boolean := false;
        v_desglose_rejected boolean := false;
        v_claimed int;
        v_result jsonb;
      begin
        insert into public.fiscal_obligados (nif, razon_social, regimen, sif_mode)
        values ('${TEST_NIF}', 'E2E', 'igic_canarias', 'native')
        returning id into v_ob;

        -- Two altas and an anulacion of the first. The desglose is IGIC (Impuesto
        -- 03) because the Canary path is the one a peninsular assumption breaks.
        v_r1 := public.fn_fiscal_append(v_ob, null, 'alta', '2026/000001', '2026-07-14'::date, 'F2',
          '${DESGLOSE_IGIC}'::jsonb, 0.10, 1.50, '2026-07-14T13:05:00+02:00', '{}'::jsonb, null);
        v_r2 := public.fn_fiscal_append(v_ob, null, 'alta', '2026/000002', '2026-07-14'::date, 'F2',
          '${DESGLOSE_IGIC}'::jsonb, 0.10, 1.50, '2026-07-14T13:06:00+02:00', '{}'::jsonb, null);
        v_r3 := public.fn_fiscal_append(v_ob, null, 'anulacion', '2026/000001', '2026-07-14'::date, 'F2',
          '[]'::jsonb, 0, 0, '2026-07-14T13:07:00+02:00', '{}'::jsonb, null);

        select huella into v_h1 from public.fiscal_records where id = v_r1;
        select huella, prev_huella into v_h2, v_prev2 from public.fiscal_records where id = v_r2;

        -- The second record's prev IS the first record's huella. That single link
        -- is the entire regulation, stated once.
        if v_prev2 is distinct from v_h1 then
          raise exception 'E2E_BROKEN: prev(%) <> huella1(%)', v_prev2, v_h1;
        end if;

        select ok, checked into v_ok, v_checked from public.fn_fiscal_verify_chain(v_ob);

        -- Immutability, attempted AS the service_role. If this can rewrite a
        -- ticket, nothing else about the register is true.
        begin
          update public.fiscal_records set importe_total = 999 where id = v_r1;
        exception when others then
          v_immutable_update := true;
        end;
        begin
          delete from public.fiscal_records where id = v_r1;
        exception when others then
          v_immutable_delete := true;
        end;

        -- A breakdown that does not add up must never reach the chain.
        begin
          perform public.fn_fiscal_append(v_ob, null, 'alta', '2026/000003', '2026-07-14'::date, 'F2',
            '${DESGLOSE_IVA}'::jsonb, 1.00, 99.00, '2026-07-14T13:08:00+02:00', '{}'::jsonb, null);
        exception when others then
          v_desglose_rejected := true;
        end;

        select count(*) into v_claimed
          from public.fn_fiscal_claim_pending(100) c
         where c.obligado_id = v_ob;

        v_result := jsonb_build_object(
          'chain_ok', v_ok,
          'chain_checked', v_checked,
          'huella_len', length(v_h1),
          'huella_upper', v_h1 = upper(v_h1),
          'immutable_update', v_immutable_update,
          'immutable_delete', v_immutable_delete,
          'desglose_rejected', v_desglose_rejected,
          'queued', v_claimed,
          'r3', v_r3 is not null
        );

        raise exception 'E2E_RESULT:%', v_result::text;
      end
      $e2e$;
    `).then(
      () => {
        throw new Error("the E2E block committed — it was supposed to roll back");
      },
      (err) => {
        const m = String(err.dbMessage || err.message).match(/E2E_RESULT:(\{.*\})/s);
        if (!m) throw err;
        return JSON.parse(m[1]);
      },
    );

    res.chain_ok
      ? ok(`chain verifies — ${res.chain_checked} records rehashed from scratch`)
      : fail("chain does NOT verify");
    res.huella_len === 64 && res.huella_upper
      ? ok("huella is 64 UPPERCASE hex chars")
      : fail(`huella malformed (len=${res.huella_len}, upper=${res.huella_upper})`);
    res.immutable_update
      ? ok("UPDATE on fiscal_records refused, as service_role")
      : fail("fiscal_records is MUTABLE — the register is worthless");
    res.immutable_delete
      ? ok("DELETE on fiscal_records refused, as service_role")
      : fail("fiscal_records can be DELETED — the register is worthless");
    res.desglose_rejected
      ? ok("an incoherent desglose is refused before it can be chained")
      : fail("an unfileable ticket was accepted");
    res.queued === 3 ? ok("all 3 records queued for AEAT") : fail(`expected 3 queued, got ${res.queued}`);
    console.log("   ↩ rolled back — the register is unchanged");
  }

  // ------------------------------------------------------------ 5) concurrency
  console.log("\n5. Two tills cashing on the same chain, at the same instant");
  {
    await sql(`
      insert into public.fiscal_obligados (nif, razon_social, regimen, sif_mode)
      values ('${CONC_NIF}', 'E2E concurrency — not a real taxpayer', 'iva_peninsular', 'none')
      on conflict (nif) do nothing;`);

    const [{ id: obligado }] = await sql(
      `select id from public.fiscal_obligados where nif = '${CONC_NIF}'`,
    );

    const stamp = Date.now();
    const append = (n) =>
      sql(`select public.fn_fiscal_append(
        '${obligado}'::uuid, null, 'alta', 'E2E${stamp}/${n}', current_date, 'F2',
        '${DESGLOSE_IVA}'::jsonb, 0.14, 1.50, '2026-07-14T13:0${n}:00+02:00', '{}'::jsonb, null) as id`);

    // Fired together, on purpose.
    const [[a], [b]] = await Promise.all([append(1), append(2)]);

    const [ra] = await sql(
      `select huella, prev_huella, chain_index from public.fiscal_records where id = '${a.id}'`,
    );
    const [rb] = await sql(
      `select huella, prev_huella, chain_index from public.fiscal_records where id = '${b.id}'`,
    );

    ra.huella !== rb.huella ? ok("two distinct huellas — no collision") : fail("the two records share a huella");
    Number(ra.chain_index) !== Number(rb.chain_index)
      ? ok(`no fork: they took positions ${ra.chain_index} and ${rb.chain_index}, not the same one`)
      : fail(`BOTH records claimed chain position ${ra.chain_index} — the head lock did not hold`);
    // One must be built ON the other: that is what serialization means here.
    ra.prev_huella === rb.huella || rb.prev_huella === ra.huella
      ? ok("the later record chained onto the earlier one")
      : fail("neither record links to the other — the chain forked");

    const [verify] = await sql(`select * from public.fn_fiscal_verify_chain('${obligado}'::uuid)`);
    verify.ok
      ? ok(`chain still verifies end-to-end (${verify.checked} records)`)
      : fail("the chain broke under concurrency");
  }

  // ------------------------------------------------------------------ 6) queue
  console.log("\n6. An external-POS obligado is never transmitted");
  {
    const [{ count }] = await sql(`
      select count(*)::int as count
        from public.fiscal_submissions s
        join public.fiscal_obligados o on o.id = s.obligado_id
       where o.sif_mode <> 'native'
         and s.status in ('pending','sent')`);

    // Those rows exist — the concurrency probe just made some. The claim must
    // refuse to pick them up: their sales are either already filed by the venue's
    // own POS, or by nobody at all. Sending them would hand AEAT the same ticket
    // twice, from two different systems.
    const claimed = await sql(`
      select c.id from public.fn_fiscal_claim_pending(500) c
      join public.fiscal_obligados o on o.id = c.obligado_id
      where o.sif_mode <> 'native'`);

    count > 0
      ? ok(`${count} queued records belong to non-native obligados`)
      : console.log("   · no non-native queued records to test against");
    claimed.length === 0
      ? ok("the claim skipped every one of them — nothing reaches AEAT twice")
      : fail(`the claim picked up ${claimed.length} records it must never send`);
  }

  // ------------------------------------------------- 7) Italy must not change
  //
  // The Italian till now goes through the SAME transaction as the Spanish one —
  // fn_cassa_pay_atomic — just with p_fiscal = false. That is the riskiest part of
  // this whole change: a regression here breaks paying customers who have nothing
  // to do with Spain. So it is exercised against a real tenant, end to end, inside
  // a block that rolls back.
  console.log("\n7. The Italian path through the new payment transaction (rolled back)");
  {
    const res = await sql(`
      do $it$
      declare
        v_tenant uuid;
        v_order uuid;
        v_before integer;
        v_paid jsonb;
        v_sale record;
        v_records int;
        v_result jsonb;
      begin
        select id into v_tenant from public.tenants order by created_at limit 1;

        insert into public.cassa_orders (tenant_id, table_name, channel, covers, cover_unit)
        values (v_tenant, 'E2E', 'sala', 2, 2.00)
        returning id into v_order;

        select coalesce(last_number, 0) into v_before
          from public.cassa_counters
         where tenant_id = v_tenant and year = extract(year from current_date)::int;

        -- 15.00 gross at 10% → base 13.64 + cuota 1.36. Italy: no obligado, no
        -- chain, no submission — but the receipt number, the sale and its VAT
        -- breakdown must all land, in one transaction.
        v_paid := public.fn_cassa_pay_atomic(
          v_tenant, v_order, null, current_date, extract(year from current_date)::int, now(),
          15.00, 15.00, 0, 13.64, 1.36,
          '[{"Impuesto":"01","ClaveRegimen":"01","CalificacionOperacion":"S1","TipoImpositivo":"10.00","BaseImponible":"13.64","CuotaRepercutida":"1.36"}]'::jsonb,
          'sala', 2, 'cash',
          false, null, '', null, '{}'::jsonb);

        select * into v_sale from public.pos_sales where id = (v_paid->>'sale_id')::uuid;

        select count(*) into v_records from public.fiscal_records where cassa_order_id = v_order;

        v_result := jsonb_build_object(
          'claimed', v_paid->'claimed',
          'receipt_number', v_paid->'receipt_number',
          'counter_advanced', (v_paid->>'receipt_number')::int = coalesce(v_before,0) + 1,
          'no_fiscal_record', v_records = 0,
          'no_fiscal_id', v_paid->>'fiscal_record_id' is null,
          'sale_gross', v_sale.gross_total,
          'sale_net', v_sale.net_total,
          'sale_tax', v_sale.tax_total
        );

        raise exception 'E2E_RESULT:%', v_result::text;
      end
      $it$;
    `).then(
      () => {
        throw new Error("the Italian E2E block committed — it was supposed to roll back");
      },
      (err) => {
        const m = String(err.dbMessage || err.message).match(/E2E_RESULT:(\{.*\})/s);
        if (!m) throw err;
        return JSON.parse(m[1]);
      },
    );

    res.claimed ? ok("the bill was claimed (open → paid)") : fail("the bill was not claimed");
    res.counter_advanced
      ? ok(`receipt number ${res.receipt_number} minted in the SAME transaction — no gap possible`)
      : fail("the receipt counter did not advance by exactly one");
    res.no_fiscal_record && res.no_fiscal_id
      ? ok("no fiscal record, no chain, no submission — Italy is untouched")
      : fail("the Italian path produced a fiscal record");
    // net_total/tax_total were ALWAYS null before: the breakdown was computed for
    // the printout and thrown away. Now the canonical sale carries it.
    Number(res.sale_net) === 13.64 && Number(res.sale_tax) === 1.36 && Number(res.sale_gross) === 15
      ? ok("pos_sales now carries its VAT breakdown (net 13.64 + tax 1.36 = 15.00)")
      : fail(`pos_sales breakdown wrong: gross=${res.sale_gross} net=${res.sale_net} tax=${res.sale_tax}`);
    console.log("   ↩ rolled back — no test receipt in anyone's till");
  }

  // ------------------------------------------------- 8) The partial refund (R5)
  //
  // The case the till could not express until now: five beers paid, two returned.
  // Voiding the whole receipt to hand back 9 € out of 36 would erase an income that
  // really happened. The right shape is a NEW document — a rectificativa (R5) that
  // points at the original and carries only the DELTA, negative.
  //
  // What must hold, and is checked here against the real database:
  //   • the original receipt is still `paid` and physically untouched;
  //   • the R5 gets its OWN number from the same series;
  //   • it chains onto the original's huella (prev = the alta's huella);
  //   • pos_sales gains a negative row, and the pair sums to what was really kept;
  //   • the chain still verifies from scratch;
  //   • refunding beyond the residual is REFUSED.
  console.log("\n8. A partial refund is a rectificativa (R5), not a deletion (rolled back)");
  {
    const res = await sql(`
      do $r5$
      declare
        v_tenant uuid;
        v_ob uuid;
        v_order uuid;
        v_paid jsonb;
        v_rect jsonb;
        v_alta public.fiscal_records%rowtype;
        v_r5 public.fiscal_records%rowtype;
        v_order_after public.cassa_orders%rowtype;
        v_sales numeric;
        v_chain record;
        v_over boolean := false;
        v_result jsonb;
      begin
        select id into v_tenant from public.tenants order by created_at limit 1;

        -- A throwaway obligado in mode 'none': by the queue's own filter (block 6)
        -- a non-native obligado is NEVER transmitted, so even the rows we chain here
        -- could not reach AEAT. Belt and braces on top of the rollback.
        insert into public.fiscal_obligados (nif, razon_social, regimen, sif_mode)
        values ('X9999999R', 'E2E Rectificativa', 'iva_peninsular', 'none')
        on conflict (nif) do update set razon_social = excluded.razon_social
        returning id into v_ob;

        insert into public.cassa_orders (tenant_id, table_name, channel, covers, cover_unit)
        values (v_tenant, 'E2E-R5', 'sala', 0, 0)
        returning id into v_order;

        -- 40.00 gross at 10% → base 36.36 + cuota 3.64.
        v_paid := public.fn_cassa_pay_atomic(
          v_tenant, v_order, null, current_date, extract(year from current_date)::int, now(),
          40.00, 40.00, 0, 36.36, 3.64,
          '[{"Impuesto":"01","ClaveRegimen":"01","CalificacionOperacion":"S1","TipoImpositivo":"10.00","BaseImponible":"36.36","CuotaRepercutida":"3.64"}]'::jsonb,
          'sala', 0, 'cash',
          true, v_ob, '', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS+02:00'), '{}'::jsonb);

        -- Now return 10.00 of it: base 9.09 + cuota 0.91, all NEGATIVE.
        v_rect := public.fn_cassa_rectify_atomic(
          v_tenant, v_order, 'due birre sbagliate', null,
          current_date, extract(year from current_date)::int, now(),
          -9.09, -0.91, -10.00,
          '[{"Impuesto":"01","ClaveRegimen":"01","CalificacionOperacion":"S1","TipoImpositivo":"10.00","BaseImponible":"-9.09","CuotaRepercutida":"-0.91"}]'::jsonb,
          true, v_ob, '', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS+02:00'), '{}'::jsonb);

        select * into v_alta from public.fiscal_records where id = (v_paid->>'fiscal_record_id')::uuid;
        select * into v_r5   from public.fiscal_records where id = (v_rect->>'fiscal_record_id')::uuid;
        select * into v_order_after from public.cassa_orders where id = v_order;

        -- What the books now say was kept: 40 − 10 = 30.
        select coalesce(sum(gross_total), 0) into v_sales
          from public.pos_sales
         where tenant_id = v_tenant and external_id like v_order::text || '%';

        select * into v_chain from public.fn_fiscal_verify_chain(v_ob);

        -- Refunding beyond the residual must be refused (30 left, ask for 31).
        begin
          perform public.fn_cassa_rectify_atomic(
            v_tenant, v_order, 'troppo', null,
            current_date, extract(year from current_date)::int, now(),
            -28.18, -2.82, -31.00, '[]'::jsonb,
            false, null, '', null, '{}'::jsonb);
        exception when others then
          v_over := true;
        end;

        v_result := jsonb_build_object(
          'rectified',        v_rect->'rectified',
          'original_paid',    v_order_after.status = 'paid',
          'new_number',       (v_rect->>'receipt_number')::int = (v_paid->>'receipt_number')::int + 1,
          'r5_tipo',          v_r5.tipo_factura,
          'r5_is_alta',       v_r5.tipo = 'alta',
          'r5_amount',        v_r5.importe_total,
          'chains_on_alta',   v_r5.prev_huella = v_alta.huella,
          'points_at_orig',   v_r5.rectifica->>'num_serie' = (v_paid->>'num_serie'),
          'por_diferencias',  v_r5.rectifica->>'tipo' = 'por_diferencias',
          'sales_net',        v_sales,
          'refunded_total',   v_order_after.refunded_total,
          'chain_ok',         v_chain.ok,
          'over_refund_refused', v_over
        );

        raise exception 'E2E_RESULT:%', v_result::text;
      end
      $r5$;
    `).then(
      () => {
        throw new Error("the R5 E2E block committed — it was supposed to roll back");
      },
      (err) => {
        const m = String(err.dbMessage || err.message).match(/E2E_RESULT:(\{.*\})/s);
        if (!m) throw err;
        return JSON.parse(m[1]);
      },
    );

    res.rectified ? ok("the refund went through") : fail("the refund did not happen");
    res.original_paid
      ? ok("the ORIGINAL receipt is still `paid` — nothing was erased or rewritten")
      : fail("the original receipt was altered");
    res.new_number
      ? ok("the rectificativa took its OWN number, next in the same series")
      : fail("the rectificativa did not mint a new number");
    res.r5_is_alta && res.r5_tipo === "R5"
      ? ok("it entered the chain as an `alta` of type R5 (a new document, not an annulment)")
      : fail(`wrong record type: tipo=${res.r5_tipo}`);
    Number(res.r5_amount) === -10
      ? ok("it carries only the DELTA, negative (−10.00)")
      : fail(`the R5 amount is ${res.r5_amount}, expected −10.00`);
    res.chains_on_alta
      ? ok("its prev_huella is the original's huella — the chain is unbroken")
      : fail("the R5 did not chain onto the original");
    res.points_at_orig && res.por_diferencias
      ? ok("`rectifica` names the original invoice, por diferencias")
      : fail("the R5 does not point at the invoice it rectifies");
    Number(res.sales_net) === 30 && Number(res.refunded_total) === 10
      ? ok("pos_sales sums to 30.00 kept (40 paid − 10 returned), refunded_total = 10.00")
      : fail(`the books say ${res.sales_net} kept / ${res.refunded_total} refunded, expected 30 / 10`);
    res.chain_ok
      ? ok("the whole chain still verifies from scratch")
      : fail("the chain no longer verifies after the rectificativa");
    res.over_refund_refused
      ? ok("refunding beyond the residual is REFUSED (31 € on a 30 € remainder)")
      : fail("the till allowed a refund larger than what was kept");
    console.log("   ↩ rolled back — no test receipt in anyone's till");
  }

  console.log(
    failures === 0
      ? "\n✅ VERI*FACTU register E2E: all checks passed"
      : `\n❌ ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n💥", err.message);
  process.exit(1);
});
