"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Check, Loader2, PackagePlus, Sparkles, X } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// "Registra consegna": photograph a supplier invoice / delivery note → the OCR
// route parses it, every line arrives pre-matched to a warehouse ingredient (or
// with a ready "create new" proposal), the owner glances, fixes what's off and
// hits confirm ONCE. That single tap updates ingredient prices AND loads the
// goods into stock — the daily stock-in becomes photo → confirm.

interface IngredientOpt {
  id: string;
  name: string;
  unit: string;
}

interface UploadedLine {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  suggestion: {
    ingredientId: string | null;
    confidence: "high" | "medium" | "none";
    score: number;
    proposal: { name: string; unit: string };
    /** goods → warehouse; service/charge → skipped by default. */
    kind: "goods" | "service" | "charge";
    /** The line already converted into real units by the pack-format reader. */
    derived: {
      unit: string;
      quantity: number;
      unitCost: number | null;
      pack: { size: number; unit: string; source: string } | null;
      explanation: string | null;
    };
  } | null;
}

interface UploadResult {
  invoice_id: string;
  supplier_name: string | null;
  extracted: { invoiceDate?: string | null; grossTotal?: number | null };
  lines: UploadedLine[];
}

/**
 * POST the document with a real progress readout.
 *
 * fetch() cannot report upload progress, so this uses XHR — the only way to
 * show the owner a true percentage instead of a spinner. `timeout` is left at
 * 0 (no limit) deliberately: reading a dense invoice can take minutes once the
 * server retries a rate-limited model call, and cutting that short would throw
 * away work the tenant has already been charged for.
 */
function postWithProgress(form: FormData, onProgress: (pct: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/invoices/upload");
    xhr.timeout = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.upload.onload = () => onProgress(100); // handed over; the model takes it from here
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* a proxy error page, handled just below */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      // Already booked: the unique index refused a second copy of the same
      // document, which is what stops a delivery entering stock twice.
      if (xhr.status === 409 && data?.error === "duplicate_confirmed") {
        const when = data.booked_on ? String(data.booked_on).slice(0, 10) : null;
        return reject(
          new Error(
            `Questo documento è già stato caricato a magazzino${data.invoice_number ? ` (n. ${data.invoice_number}` : ""}${
              data.supplier_name ? ` — ${data.supplier_name})` : data.invoice_number ? ")" : ""
            }${when ? ` il ${when}` : ""}. Non lo ricarico, altrimenti le giacenze raddoppierebbero.`,
          ),
        );
      }
      reject(new Error(data?.error || `Errore ${xhr.status || "di rete"}`));
    };
    xhr.onerror = () => reject(new Error("Connessione interrotta durante il caricamento."));
    xhr.onabort = () => reject(new Error("Caricamento annullato."));
    xhr.send(form);
  });
}

// Per-line decision in the review step.
type Mapping =
  | { kind: "ingredient"; ingredientId: string }
  | { kind: "create"; name: string; unit: string }
  | { kind: "skip" };

type Phase =
  | { s: "idle" }
  /** `pct` is the real share of the file on the wire; once it lands the model
   *  starts reading and there is no honest percentage for that, so we switch to
   *  an elapsed counter rather than inventing a number that creeps to 99%. */
  | { s: "uploading"; stage: "send" | "read"; pct: number; secs: number }
  | { s: "review"; data: UploadResult }
  | { s: "confirming"; data: UploadResult }
  | { s: "done"; summary: { costs: number; stock: number; created: number } }
  | { s: "error"; msg: string };

export function InvoiceCapture({
  tenantId,
  ingredients,
  onDone,
}: {
  tenantId: string;
  ingredients: IngredientOpt[];
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const reset = () => {
    setPhase({ s: "idle" });
    setMappings({});
    setQtyDrafts({});
    setPriceDrafts({});
    if (fileRef.current) fileRef.current.value = "";
  };

  async function upload(file: File) {
    setPhase({ s: "uploading", stage: "send", pct: 0, secs: 0 });
    // Tick the elapsed counter while the model reads, so a long document looks
    // like work in progress rather than a frozen dialog.
    const startedAt = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setPhase((p) =>
        p.s === "uploading" ? { ...p, secs: Math.floor((Date.now() - startedAt) / 1000) } : p,
      );
    }, 1000);
    try {
      const form = new FormData();
      form.set("tenant_id", tenantId);
      form.set("file", file);
      const data = await postWithProgress(form, (pct) =>
        setPhase((p) =>
          p.s === "uploading"
            ? { ...p, pct, stage: pct >= 100 ? "read" : "send" }
            : p,
        ),
      );
      const result = data as UploadResult;
      // Seed the review so the owner confirms rather than types. Matched lines
      // point at their ingredient, unmatched goods default to "create new", and
      // services/charges (a cash-register rental, a transport fee) default to
      // skip — those are real costs but they are not stock.
      const seed: Record<string, Mapping> = {};
      const qty: Record<string, string> = {};
      const price: Record<string, string> = {};
      for (const l of result.lines) {
        const s = l.suggestion;
        if (s && s.kind !== "goods") {
          seed[l.id] = { kind: "skip" };
        } else if (s?.ingredientId) {
          seed[l.id] = { kind: "ingredient", ingredientId: s.ingredientId };
        } else {
          const p = s?.proposal;
          seed[l.id] = { kind: "create", name: p?.name || (l.description || "").slice(0, 80), unit: p?.unit || "pz" };
        }
        // Pre-fill with the CONVERTED figures: 1 CAR of «6X500 ML» becomes 3 l
        // at 10,00 €/l, which is what stock and food cost need.
        if (s?.derived) {
          qty[l.id] = String(s.derived.quantity);
          if (s.derived.unitCost != null) price[l.id] = String(s.derived.unitCost);
        }
      }
      setMappings(seed);
      setQtyDrafts(qty);
      setPriceDrafts(price);
      setPhase({ s: "review", data: result });
    } catch (e: any) {
      setPhase({ s: "error", msg: e?.message || "Errore" });
    } finally {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function confirm(data: UploadResult) {
    setPhase({ s: "confirming", data });
    try {
      const lines = data.lines.map((l) => {
        const m = mappings[l.id] || { kind: "skip" as const };
        const base: Record<string, unknown> = { id: l.id };
        const qty = qtyDrafts[l.id];
        const price = priceDrafts[l.id];
        if (qty != null && qty.trim() !== "") base.quantity = Number(qty.replace(",", "."));
        if (price != null && price.trim() !== "") base.unit_price = Number(price.replace(",", "."));
        if (m.kind === "ingredient") base.ingredient_id = m.ingredientId;
        else if (m.kind === "create") base.create_ingredient = { name: m.name, unit: m.unit };
        else base.ingredient_id = null;
        return base;
      });
      const res = await fetch("/api/invoices/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, invoice_id: data.invoice_id, lines, receive_stock: true }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error || "confirm failed");
      setPhase({
        s: "done",
        summary: { costs: out.costs_applied || 0, stock: out.stock_received || 0, created: out.ingredients_created || 0 },
      });
      onDone();
    } catch (e: any) {
      setPhase({ s: "error", msg: e?.message || "Errore" });
    }
  }

  const inputCls = "px-2 py-1 text-sm border-2 rounded text-black";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-lg cursor-pointer"
        style={{ background: "linear-gradient(135deg, #059669, #047857)" }}
      >
        <Camera className="w-4 h-4" /> {t("inv_capture_btn" as keyof Dictionary) || "Registra consegna"}
      </button>

      {phase.s !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border-2" style={{ borderColor: "#c4956a" }}>
            {/* Header */}
            <div className="sticky top-0 bg-white flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: "#eaddcb" }}>
              <h2 className="text-lg font-bold text-black flex items-center gap-2">
                <PackagePlus className="w-5 h-5" />
                {t("inv_capture_title" as keyof Dictionary) || "Carico da fattura / bolla"}
              </h2>
              <button onClick={reset} className="p-1.5 text-black cursor-pointer" aria-label="close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              {phase.s === "uploading" && (
                <div className="py-10 flex flex-col items-center gap-4 text-black">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#c4956a" }} />
                  <div className="w-full max-w-sm">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm font-bold">
                        {phase.stage === "send"
                          ? t("inv_capture_stage_send" as keyof Dictionary) || "Caricamento del documento…"
                          : t("inv_capture_stage_read" as keyof Dictionary) || "Lettura in corso…"}
                      </span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "#8b6540" }}>
                        {phase.stage === "send"
                          ? `${phase.pct}%`
                          : `${Math.floor(phase.secs / 60)}:${String(phase.secs % 60).padStart(2, "0")}`}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full overflow-hidden" style={{ background: "#eaddcb" }}>
                      {/* A real bar while the bytes move; once the model has the
                          file there is nothing truthful to fill it with, so it
                          becomes an indeterminate sweep. */}
                      <div
                        className={phase.stage === "read" ? "h-full animate-pulse" : "h-full transition-all duration-200"}
                        style={{
                          width: phase.stage === "read" ? "100%" : `${phase.pct}%`,
                          background:
                            phase.stage === "read"
                              ? "linear-gradient(90deg, #eaddcb, #c4956a, #eaddcb)"
                              : "linear-gradient(135deg, #d4a574, #c4956a)",
                        }}
                      />
                    </div>
                    <p className="mt-2.5 text-xs text-center" style={{ color: "#8b6540" }}>
                      {phase.stage === "send"
                        ? t("inv_capture_stage_send_hint" as keyof Dictionary) || "Non chiudere questa finestra."
                        : t("inv_capture_stage_read_hint" as keyof Dictionary) ||
                          "Un documento fitto può richiedere qualche minuto. Non c'è limite di tempo: aspetta pure."}
                    </p>
                  </div>
                </div>
              )}

              {phase.s === "error" && (
                <div className="py-8 text-center space-y-4">
                  <p className="text-sm text-red-600 font-medium">{phase.msg}</p>
                  <button onClick={reset} className="px-4 py-2 text-sm rounded-lg border-2 cursor-pointer text-black" style={{ borderColor: "#c4956a" }}>
                    {t("close" as keyof Dictionary) || "Chiudi"}
                  </button>
                </div>
              )}

              {phase.s === "done" && (
                <div className="py-10 flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.12)" }}>
                    <Check className="w-7 h-7 text-emerald-600" />
                  </div>
                  <p className="text-base font-bold text-black">{t("inv_capture_done_title" as keyof Dictionary) || "Consegna registrata"}</p>
                  <p className="text-sm text-black text-center">
                    {(t("inv_capture_done_body" as keyof Dictionary) ||
                      "{stock} righe caricate a magazzino · {costs} prezzi aggiornati · {created} nuovi ingredienti creati")
                      .replace("{stock}", String(phase.summary.stock))
                      .replace("{costs}", String(phase.summary.costs))
                      .replace("{created}", String(phase.summary.created))}
                  </p>
                  <button onClick={reset} className="mt-2 px-5 py-2 text-white text-sm font-bold rounded-lg cursor-pointer" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
                    {t("close" as keyof Dictionary) || "Chiudi"}
                  </button>
                </div>
              )}

              {(phase.s === "review" || phase.s === "confirming") && (
                <ReviewTable
                  data={phase.data}
                  ingredients={ingredients}
                  ingById={ingById}
                  mappings={mappings}
                  setMappings={setMappings}
                  qtyDrafts={qtyDrafts}
                  setQtyDrafts={setQtyDrafts}
                  priceDrafts={priceDrafts}
                  setPriceDrafts={setPriceDrafts}
                  busy={phase.s === "confirming"}
                  onConfirm={() => confirm(phase.data)}
                  onCancel={reset}
                  t={t}
                  inputCls={inputCls}
                  inputStyle={inputStyle}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReviewTable({
  data, ingredients, ingById, mappings, setMappings, qtyDrafts, setQtyDrafts,
  priceDrafts, setPriceDrafts, busy, onConfirm, onCancel, t, inputCls, inputStyle,
}: {
  data: UploadResult;
  ingredients: IngredientOpt[];
  ingById: Map<string, IngredientOpt>;
  mappings: Record<string, Mapping>;
  setMappings: React.Dispatch<React.SetStateAction<Record<string, Mapping>>>;
  qtyDrafts: Record<string, string>;
  setQtyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  priceDrafts: Record<string, string>;
  setPriceDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: (k: keyof Dictionary) => string;
  inputCls: string;
  inputStyle: React.CSSProperties;
}) {
  const CREATE = "__create__";
  const SKIP = "__skip__";
  const autoCount = data.lines.filter((l) => l.suggestion?.confidence === "high").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-black">
        <div>
          <span className="font-bold">{data.supplier_name || t("inv_capture_unknown_supplier" as keyof Dictionary) || "Fornitore sconosciuto"}</span>
          {data.extracted?.invoiceDate ? <span> · {data.extracted.invoiceDate}</span> : null}
          {data.extracted?.grossTotal != null ? <span> · € {Number(data.extracted.grossTotal).toFixed(2)}</span> : null}
        </div>
        {autoCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}>
            <Sparkles className="w-3.5 h-3.5" />
            {(t("inv_capture_automatched" as keyof Dictionary) || "{n} righe abbinate da sole").replace("{n}", String(autoCount))}
          </span>
        )}
      </div>

      <p className="text-xs text-black">
        {t("inv_capture_help" as keyof Dictionary) ||
          "Controlla le righe: quantità e prezzo vengono dal documento. Le righe senza abbinamento creano un nuovo ingrediente in magazzino. Confermando, giacenze e prezzi si aggiornano da soli."}
      </p>

      <div className="space-y-2">
        {data.lines.map((l) => {
          const m = mappings[l.id] || { kind: "skip" as const };
          const selectValue = m.kind === "ingredient" ? m.ingredientId : m.kind === "create" ? CREATE : SKIP;
          const selectedIng = m.kind === "ingredient" ? ingById.get(m.ingredientId) : null;
          const targetUnit = m.kind === "create" ? m.unit : selectedIng?.unit || "";
          const skipped = m.kind === "skip";
          return (
            <div key={l.id} className={`rounded-lg border-2 p-3 ${skipped ? "opacity-50" : ""}`} style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.5)" }}>
              <div className="text-sm font-medium text-black mb-2">
                {l.description || "—"}
                {l.suggestion?.confidence === "medium" && !skipped && m.kind === "ingredient" && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    {t("inv_capture_check" as keyof Dictionary) || "da controllare"}
                  </span>
                )}
                {/* A rental or a transport fee is a real cost but not stock —
                    say why it was left out rather than silently skipping it. */}
                {l.suggestion && l.suggestion.kind !== "goods" && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: "#ece3d6", color: "#7a5c3e" }}>
                    {l.suggestion.kind === "service"
                      ? t("inv_capture_kind_service" as keyof Dictionary) || "servizio — non va a magazzino"
                      : t("inv_capture_kind_charge" as keyof Dictionary) || "spesa — non va a magazzino"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 grow min-w-[220px]">
                  <span className="text-xs font-bold text-black">{t("inv_capture_map_to" as keyof Dictionary) || "Ingrediente magazzino"}</span>
                  <select
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMappings((prev) => ({
                        ...prev,
                        [l.id]:
                          v === SKIP
                            ? { kind: "skip" }
                            : v === CREATE
                              ? { kind: "create", name: l.suggestion?.proposal.name || (l.description || "").slice(0, 80), unit: l.suggestion?.proposal.unit || "pz" }
                              : { kind: "ingredient", ingredientId: v },
                      }));
                    }}
                    className={inputCls + " cursor-pointer w-full"}
                    style={inputStyle}
                  >
                    <option value={CREATE}>
                      {(t("inv_capture_create_new" as keyof Dictionary) || "➕ Crea nuovo: {name}").replace("{name}", l.suggestion?.proposal.name || (l.description || "").slice(0, 40))}
                    </option>
                    <option value={SKIP}>{t("inv_capture_skip" as keyof Dictionary) || "— Ignora questa riga —"}</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                  </select>
                </label>
                {m.kind === "create" && (
                  <label className="flex flex-col gap-1 w-24">
                    <span className="text-xs font-bold text-black">{t("inventory_unit" as keyof Dictionary) || "Unità"}</span>
                    <select
                      value={m.unit}
                      onChange={(e) => setMappings((prev) => ({ ...prev, [l.id]: { ...m, unit: e.target.value } }))}
                      className={inputCls + " cursor-pointer"}
                      style={inputStyle}
                    >
                      {["kg", "g", "l", "ml", "pz"].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 w-28">
                  <span className="text-xs font-bold text-black">
                    {(t("inv_mv_qty" as keyof Dictionary) || "Quantità") + (targetUnit ? ` (${targetUnit})` : "")}
                  </span>
                  <input
                    type="number"
                    step="0.001"
                    value={qtyDrafts[l.id] ?? (l.quantity != null ? String(l.quantity) : "")}
                    onChange={(e) => setQtyDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    className={inputCls + " w-full"}
                    style={inputStyle}
                    disabled={skipped}
                  />
                </label>
                <label className="flex flex-col gap-1 w-28">
                  <span className="text-xs font-bold text-black">{t("inv_mv_unit_cost" as keyof Dictionary) || "Prezzo unit. €"}</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={priceDrafts[l.id] ?? (l.unit_price != null ? String(l.unit_price) : "")}
                    onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    className={inputCls + " w-full"}
                    style={inputStyle}
                    disabled={skipped}
                  />
                </label>
              </div>
              {/* State what we did, never ask the owner to go and check. A unit
                  that differs from the document is the CONVERSION WORKING — the
                  supplier bills in "CF"/"Ltr" and the warehouse holds kg/l — so
                  a warning there was crying wolf on every single line. The note
                  below is shown only when the numbers actually changed, and only
                  while the mapping still targets the unit we converted into. */}
              {!skipped && l.suggestion?.derived?.explanation && targetUnit === l.suggestion.derived.unit && (
                <p className="mt-1.5 text-xs" style={{ color: "#7a5c3e" }}>
                  {(t("inv_capture_pack_hint" as keyof Dictionary) || "Formato letto dal documento: {expl}")
                    .replace("{expl}", l.suggestion.derived.explanation)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm rounded-lg border-2 cursor-pointer text-black disabled:opacity-40" style={{ borderColor: "#c4956a" }}>
          {t("cancel" as keyof Dictionary) || "Annulla"}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2 text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #059669, #047857)" }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {t("inv_capture_confirm" as keyof Dictionary) || "Conferma e carica a magazzino"}
        </button>
      </div>
    </div>
  );
}
