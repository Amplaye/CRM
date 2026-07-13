import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { altaPayload, altaHuella, anulacionPayload, anulacionHuella } from "./huella";

// SQL/TS PARITY — the one test that keeps the two implementations of the huella
// honest with each other.
//
// The chain is computed in SQL (it has to be: the hash must be produced inside the
// transaction that locks the chain head, or two tills cashing at once read the same
// prev_huella and fork the chain). But SQL is a bad place to unit-test a spec, so
// huella.ts mirrors it. Two implementations of the same spec drift — unless something
// compares them. This is that something.
//
// It needs the database, so it SKIPS when .env.local has no Supabase credentials
// (CI, a fresh clone) rather than failing red for the wrong reason.

function envLocal(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = envLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && key);

const svc = live ? createClient(url!, key!, { auth: { persistSession: false } }) : null;

const AEAT_GOLDEN_HASH = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

describe.skipIf(!live)("huella: SQL and TypeScript agree", () => {
  const GOLDEN = {
    idEmisorFactura: "89890001K",
    numSerieFactura: "12345678/G33",
    fechaExpedicionFactura: "01-01-2024",
    tipoFactura: "F1",
    cuotaTotal: "12.35",
    importeTotal: "123.45",
    huella: "",
    fechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
  };

  async function sqlAlta(prevHuella: string, numSerie = GOLDEN.numSerieFactura) {
    const { data: payload, error: e1 } = await svc!.rpc("fn_fiscal_alta_payload", {
      p_nif: GOLDEN.idEmisorFactura,
      p_num_serie: numSerie,
      p_fecha_expedicion: "2024-01-01",
      p_tipo_factura: GOLDEN.tipoFactura,
      p_cuota_total: 12.35,
      p_importe_total: 123.45,
      p_prev_huella: prevHuella,
      p_fecha_hora_huso: GOLDEN.fechaHoraHusoGenRegistro,
    });
    if (e1) throw new Error(e1.message);
    const { data: huella, error: e2 } = await svc!.rpc("fn_fiscal_huella", { p_payload: payload });
    if (e2) throw new Error(e2.message);
    return { payload: payload as string, huella: huella as string };
  }

  it("produces AEAT's published huella on the golden vector — from BOTH sides", async () => {
    const sql = await sqlAlta("");
    expect(sql.payload).toBe(altaPayload(GOLDEN));
    expect(sql.huella).toBe(altaHuella(GOLDEN));
    expect(sql.huella).toBe(AEAT_GOLDEN_HASH);
  });

  it("agrees on a CHAINED record too (a non-empty prev huella)", async () => {
    const sql = await sqlAlta(AEAT_GOLDEN_HASH, "2026/000042");
    const ts = altaHuella({ ...GOLDEN, numSerieFactura: "2026/000042", huella: AEAT_GOLDEN_HASH });
    expect(sql.huella).toBe(ts);
  });

  it("agrees on an anulacion (a different field order — the easiest thing to get wrong)", async () => {
    const args = {
      idEmisorFacturaAnulada: "89890001K",
      numSerieFacturaAnulada: "2026/000042",
      fechaExpedicionFacturaAnulada: "14-07-2026",
      huella: AEAT_GOLDEN_HASH,
      fechaHoraHusoGenRegistro: "2026-07-14T13:05:00+02:00",
    };
    const { data: payload, error } = await svc!.rpc("fn_fiscal_anulacion_payload", {
      p_nif: args.idEmisorFacturaAnulada,
      p_num_serie: args.numSerieFacturaAnulada,
      p_fecha_expedicion: "2026-07-14",
      p_prev_huella: args.huella,
      p_fecha_hora_huso: args.fechaHoraHusoGenRegistro,
    });
    if (error) throw new Error(error.message);
    const { data: huella } = await svc!.rpc("fn_fiscal_huella", { p_payload: payload });

    expect(payload).toBe(anulacionPayload(args));
    expect(huella).toBe(anulacionHuella(args));
  });

  it("formats money the same on both sides (2 decimals, dot, no grouping)", async () => {
    for (const n of [0, 1.5, 1234.5, 123.456]) {
      const { data } = await svc!.rpc("fn_fiscal_amount", { p_n: n });
      expect(data).toBe(Number(n).toFixed(2));
    }
  });
});
