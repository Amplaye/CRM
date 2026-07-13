"use client";

import { useEffect, useState } from "react";
import { Mail, CheckCircle2, XCircle, Loader2, KeyRound, ExternalLink, Unplug, AlertTriangle } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";

// Settings → Email. The tenant's own Resend account, same self-service shape as
// Settings → Cassa: paste the key, test it, save it.
//
// NOT optional: with no key connected the CRM sends this venue NO email at all —
// campaigns, coupons, gift cards, confirmations, everything is off. There is no
// shared platform plan behind it. So this panel's job is to make the OFF state
// impossible to mistake for a working one.
//
// Two things are needed, not one: the key, and a domain verified inside that same
// Resend account. Resend refuses to send from a domain it hasn't verified, so a
// key on its own would show "connected" while every guest email bounced.
//
// Resend keys come in two flavours and BOTH work here:
//   Full access    → we read the account's domains and propose noreply@<domain>.
//   Sending access → Resend won't let us read the domains (401 restricted_api_key,
//                    which is NOT a bad key), so the owner types the sender and we
//                    prove it with one real test email to their own inbox.
//
// The key goes to /api/marketing/email-provider and is encrypted server-side — it
// is never stored in tenants.settings and never comes back down to the browser.

interface Quota {
  sent: number;
  limit: number;
}

interface Usage {
  connected: boolean;
  marketing: Quota;
  transactional: Quota;
}

type Phase = "idle" | "testing" | "saving" | "disconnecting" | "sender";

interface ApiResult {
  ok: boolean;
  msg: string;
  needsDomain?: boolean;
  /** Chiave "Sending access": non ci lascia leggere i domini, quindi il mittente
   *  lo deve scrivere lui e lo verifichiamo con un'email di prova. */
  needsSender?: boolean;
  verified?: string[];
  pending?: string[];
}

function QuotaBar({ label, quota, hint, off }: { label: string; quota: Quota; hint: string; off: boolean }) {
  const pct = quota.limit ? Math.min(100, Math.round((quota.sent / quota.limit) * 100)) : 0;
  // Amber past 80%: the owner should hear about a quota BEFORE it stops their sends.
  const bar = pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#c4956a";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-black">{label}</span>
        <span className="text-sm text-black tabular-nums">
          {off ? "—" : `${quota.sent.toLocaleString()} / ${quota.limit.toLocaleString()}`}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.18)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: off ? "0%" : `${pct}%`, background: bar }}
        />
      </div>
      <p className="text-xs text-black">{hint}</p>
    </div>
  );
}

export function EmailTab() {
  const { activeTenant: tenant } = useTenant();
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [senderDraft, setSenderDraft] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ApiResult | null>(null);

  const load = async () => {
    if (!tenant?.id) return;
    try {
      const res = await fetch(`/api/marketing/email-provider?tenant_id=${tenant.id}`);
      const data = await res.json();
      setConnected(!!data?.connected);
      setFromAddress(data?.from_address || null);
      setSenderDraft(data?.from_address || "");
      setUsage((data?.usage as Usage) || null);
    } catch {
      // A failed status read just leaves the panel on its defaults.
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  async function call(action: "test" | "save" | "sender" | "disconnect") {
    if (!tenant?.id) return;
    setResult(null);
    setPhase(
      action === "test" ? "testing" : action === "save" ? "saving" : action === "sender" ? "sender" : "disconnecting",
    );
    try {
      const res = await fetch("/api/marketing/email-provider", {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          ...(action === "disconnect"
            ? {}
            : {
                action,
                ...(action !== "sender" ? { api_key: apiKey.trim() } : {}),
                ...(senderDraft.trim() ? { from_address: senderDraft.trim() } : {}),
              }),
        }),
      });
      const data = await res.json();

      if (action === "disconnect") {
        setResult({
          ok: !!data?.ok,
          msg: data?.ok
            ? "Disconnesso. Da adesso questo locale non invia più nessuna email."
            : data?.error || "Errore",
        });
      } else {
        setResult({
          ok: !!data?.ok,
          msg:
            data?.test?.detail ||
            data?.error ||
            (data?.ok ? "OK" : "Connessione non riuscita"),
          needsDomain: !!data?.needs_domain,
          needsSender: !!data?.needs_sender,
          verified: data?.verified,
          pending: data?.pending,
        });
        if ((action === "save" || action === "sender") && data?.ok) setApiKey("");
      }
      await load();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Errore" });
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black w-full";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  const panelStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  const Feedback = () =>
    result ? (
      <div
        className={`space-y-2 text-sm rounded-lg p-3 ${result.ok ? "text-emerald-700" : "text-red-600"}`}
        style={{ background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.06)" }}
      >
        <div className="flex items-start gap-2">
          {result.ok ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <span>{result.msg}</span>
        </div>
        {result.needsDomain && (
          <div className="text-xs text-black">
            La chiave è giusta, ma su Resend non hai ancora un <strong>dominio verificato</strong>: senza, Resend
            rifiuta ogni invio.{" "}
            {result.pending?.length ? (
              <>
                Hai aggiunto <strong>{result.pending.join(", ")}</strong> ma i record DNS non risultano ancora
                verificati.{" "}
              </>
            ) : null}
            Apri{" "}
            <a
              href="https://resend.com/domains"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold underline"
              style={{ color: "#8b6540" }}
            >
              resend.com/domains
            </a>
            , aggiungi il dominio del tuo sito, copia i record DNS dal tuo provider e riprova qui.
          </div>
        )}
        {result.needsSender && (
          <div className="text-xs text-black">
            Scrivi l&apos;indirizzo mittente nel campo qui sotto e premi di nuovo &quot;Salva e collega&quot;: ti
            mandiamo un&apos;email di prova per confermare che Resend lo accetti.
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Mail className="w-5 h-5" /> Email
        </h2>
        <p className="mt-1 text-sm text-black">
          Le email del tuo CRM partono dal <strong>tuo</strong> account Resend. Collega la tua chiave qui: finché non
          lo fai, il CRM non invia nessuna email — né campagne marketing, né coupon, né gift card, né conferme.
          L&apos;account Resend è gratuito e ti dà 1.000 email marketing e 3.000 transazionali al mese.
        </p>
      </div>

      {/* Status + monthly counter */}
      <div className="rounded-lg border-2 p-4 space-y-4" style={panelStyle}>
        <div className="flex items-center gap-2 text-sm">
          {connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600" />
          )}
          <div>
            <div className="font-bold text-black">
              {connected ? "Collegato al tuo account Resend" : "Email disattivate"}
            </div>
            <div className="text-xs text-black">
              {connected ? (
                <>
                  Le email partono da <strong>{fromAddress}</strong> e consumano le tue quote gratuite.
                </>
              ) : (
                "Nessuna chiave collegata: il CRM non sta inviando nessuna email per questo locale."
              )}
            </div>
          </div>
        </div>

        {usage && (
          <div className="grid gap-4 sm:grid-cols-2 pt-1">
            <QuotaBar
              label="Marketing (questo mese)"
              quota={usage.marketing}
              off={!connected}
              hint={
                connected
                  ? "Campagne inviate ai tuoi contatti. Si azzera il 1° del mese."
                  : "Nessuna campagna può partire finché non colleghi la chiave."
              }
            />
            <QuotaBar
              label="Transazionali (questo mese)"
              quota={usage.transactional}
              off={!connected}
              hint={
                connected
                  ? "Conferme, coupon, gift card. Si azzera il 1° del mese."
                  : "Conferme, coupon e gift card non vengono inviati."
              }
            />
          </div>
        )}
      </div>

      {/* Connect / manage */}
      {connected ? (
        <div className="rounded-lg border-2 p-4 space-y-4" style={panelStyle}>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1">
              <Mail className="w-4 h-4" /> Indirizzo mittente
            </span>
            <input
              value={senderDraft}
              onChange={(e) => setSenderDraft(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="noreply@iltuodominio.com"
              autoComplete="off"
            />
            <span className="text-xs text-black">
              Deve stare su un dominio verificato nel tuo account Resend, altrimenti l&apos;invio viene rifiutato.
            </span>
          </label>
          <button
            onClick={() => call("sender")}
            disabled={busy || !senderDraft.trim() || senderDraft.trim() === fromAddress}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{ borderColor: "#c4956a", color: "#8b6540" }}
          >
            {phase === "sender" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Aggiorna mittente
          </button>

          <div className="pt-3 border-t space-y-3" style={{ borderColor: "rgba(196,149,106,0.4)" }}>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-black flex items-center gap-1">
                <KeyRound className="w-4 h-4" /> Sostituisci la chiave API
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="re_..."
                autoComplete="off"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => call("save")}
                disabled={busy || !apiKey.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Sostituisci chiave
              </button>
              <button
                onClick={() => call("disconnect")}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                style={{ borderColor: "#dc2626", color: "#dc2626" }}
              >
                {phase === "disconnecting" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                Disconnetti
              </button>
            </div>
            <p className="text-xs font-semibold text-red-600">
              Disconnettendo, il CRM smette di inviare qualsiasi email per questo locale.
            </p>
          </div>
          <Feedback />
        </div>
      ) : (
        <div className="rounded-lg border-2 p-4 space-y-4" style={panelStyle}>
          <div className="space-y-2">
            <span className="text-sm font-bold text-black">Come collegare il tuo account (5 minuti)</span>
            <ol className="text-sm text-black space-y-1.5 list-decimal pl-5">
              <li>
                Vai su{" "}
                <a
                  href="https://resend.com/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline inline-flex items-center gap-1"
                  style={{ color: "#8b6540" }}
                >
                  resend.com/signup <ExternalLink className="w-3 h-3" />
                </a>{" "}
                e crea un account gratuito (non serve la carta).
              </li>
              <li>
                Apri <strong>Domains → Add Domain</strong>, aggiungi il dominio del tuo sito e copia i record DNS che
                Resend ti mostra nel pannello del tuo provider. Aspetta che diventi <strong>verified</strong>: senza
                dominio verificato Resend non fa partire nulla.
              </li>
              <li>
                Apri <strong>API Keys → Create API Key</strong> e copia la chiave (inizia con <code>re_</code>). Con
                il permesso <strong>Full access</strong> troviamo da soli il dominio verificato; con{" "}
                <strong>Sending access</strong> funziona lo stesso, ma il mittente devi scriverlo tu qui sotto.
              </li>
              <li>Incolla la chiave qui sotto e premi &quot;Salva e collega&quot;.</li>
            </ol>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1">
              <KeyRound className="w-4 h-4" /> Chiave API Resend
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="re_..."
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1">
              <Mail className="w-4 h-4" /> Indirizzo mittente
            </span>
            <input
              value={senderDraft}
              onChange={(e) => setSenderDraft(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="noreply@iltuodominio.com"
              autoComplete="off"
            />
            <span className="text-xs text-black">
              Con una chiave <strong>Full access</strong> puoi lasciarlo vuoto: usiamo <code>noreply@</code> sul
              dominio che hai verificato. Con una chiave <strong>Sending access</strong> è obbligatorio.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => call("test")}
              disabled={busy || !apiKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              {phase === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Prova connessione
            </button>
            <button
              onClick={() => call("save")}
              disabled={busy || !apiKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Salva e collega
            </button>
          </div>

          <Feedback />
        </div>
      )}
    </div>
  );
}
