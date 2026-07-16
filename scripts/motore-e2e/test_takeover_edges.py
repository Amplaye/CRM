#!/usr/bin/env python3
"""E2E EDGE CASES: Coexistence takeover boundary conditions the other suites
don't probe.

Proves:
  A) CONTEXT SURVIVAL across a real interruption: customer half-books (party
     size + time collected), owner takes over, then on resume the bot CONTINUES
     the booking (knows it already has 4 pax / 21:00) instead of RESTARTING.
  B) PHONE-FORMAT VARIANCE: the owner echoes using a DIFFERENTLY formatted phone
     string for the same customer (no '+', and a 'whatsapp:'-prefixed variant).
     The last-9-digit fuzzy matcher still resolves the SAME guest, so the hold
     lands on the conversation the customer is actually using.
  C) INTENT-AGNOSTIC hold: the hold silences the bot even when the customer is
     NOT booking — a plain FAQ / info question is muted too. The takeover isn't
     tied to the booking flow.
  D) HOLD ≠ KILL-SWITCH: a held conversation is GENUINELY SILENT (skip=true, no
     reply text, no auto-reply markers) — structurally different from the
     tenant-wide kill-switch, which emits a redirect auto-reply (botPaused=true)
     and never sets skip. We do NOT touch the tenant kill-switch toggle (it's a
     business-policy value); we assert the positive shape of the hold path.

All simulated via /api/webhooks/owner-echo (no real Coexistence number).
Run: python3 scripts/motore-e2e/test_takeover_edges.py
"""
import sys, os, json, time, urllib.request, urllib.error, re
sys.path.insert(0, os.path.dirname(__file__))
from send import send, load_env

PICNIC = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5"
CRM_BASE = "https://crm.baliflowagency.com"
# Unique number; no 9-digit overlap with the other takeover tests.
PHONE = "+34695400044"
FROM = "whatsapp:" + PHONE

ENV = load_env()
SB = ENV["NEXT_PUBLIC_SUPABASE_URL"]; SRK = ENV["SUPABASE_SERVICE_ROLE_KEY"]; AI = ENV["AI_WEBHOOK_SECRET"]


def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()


def sb(path, method="GET", body=None):
    h = {"apikey": SRK, "Authorization": "Bearer " + SRK, "Content-Type": "application/json"}
    return http(SB + "/rest/v1/" + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)


def guest(phone=PHONE):
    d = re.sub(r"\D", "", phone)[-9:]
    _, t = sb(f"guests?tenant_id=eq.{PICNIC}&select=id,phone,bot_paused_at,bot_paused_hold")
    for g in json.loads(t):
        gd = re.sub(r"\D", "", g.get("phone") or "")
        if gd and gd[-9:] == d: return g
    return None


def transcript(gid):
    _, t = sb(f"conversations?guest_id=eq.{gid}&select=transcript&order=created_at.desc&limit=1")
    j = json.loads(t)
    return (j[0].get("transcript") if j else []) or []


def cleanup(phone=PHONE):
    g = guest(phone)
    if not g: return
    sb(f"conversations?guest_id=eq.{g['id']}", method="DELETE")
    sb(f"reservations?guest_id=eq.{g['id']}", method="DELETE")
    sb(f"guests?id=eq.{g['id']}", method="DELETE")


def echo(text, phone_str):
    """Echo with an EXPLICIT phone string (to probe the fuzzy matcher)."""
    return http(CRM_BASE + "/api/webhooks/owner-echo", method="POST",
                data=json.dumps({"tenant_id": PICNIC, "guest_phone": phone_str, "owner_text": text, "guest_name": "E2E Edges"}).encode(),
                headers={"Content-Type": "application/json", "x-ai-secret": AI})


def send_reply(msg, tries=4):
    last = {}
    for _ in range(tries):
        r = send(PICNIC, FROM, msg)
        last = r
        if r.get("ok") and not r.get("skip") and r.get("reply"):
            return r
    return last


def muted(msg, tries=3):
    last = {}
    for _ in range(tries):
        r = send(PICNIC, FROM, msg)
        last = r
        if r.get("skip") is True:
            return True, r
    return False, last


def resume_db(last_msg=None):
    g = guest()
    sb(f"guests?id=eq.{g['id']}", method="PATCH", body={"bot_paused_at": None, "bot_paused_hold": False})
    if last_msg is not None:
        return send_reply(last_msg)
    return None


PASS, FAIL = [], []
def check(name, cond, extra=""):
    (PASS if cond else FAIL).append((name, extra))
    print(("  ✅ " if cond else "  ❌ ") + name + (f"  [{extra}]" if extra else ""))


print("=== EDGE CASES takeover E2E (PICNIC) ===")
cleanup()

# A) CONTEXT SURVIVAL across a real owner interruption.
print("\n[A] sopravvivenza contesto: mezza prenotazione → takeover → resume CONTINUA")
r = send_reply("Hola, quería reservar para 4 personas mañana a las 21:00")
check("bot ingaggia e raccoglie 4 pax / 21:00", r.get("ok") and not r.get("skip") and bool(r.get("reply")),
      (r.get("reply") or "")[:60])
# owner barges in mid-flow
ste, _ = echo("Hola, déjeme que le confirme yo la disponibilidad un segundo", PHONE)
gA = guest()
check("hold attivo dopo il takeover a metà flusso", ste == 200 and bool(gA and gA.get("bot_paused_hold")),
      f"hold={gA and gA.get('bot_paused_hold')}")
ok, _ = muted("¿Me confirma entonces?")
check("cliente muto mentre il titolare è in mano", ok)
# resume with a CONTEXT PROBE — ask the bot to recall the party size.
r = resume_db("Oye, recuérdame: ¿para cuántas personas era la reserva?")
rl = (r.get("reply") or "").lower()
recalls = ("4" in rl or "cuatro" in rl)
restarts = any(k in rl for k in ["cuántas personas", "cuantas personas", "qué día", "que dia"])
check("resume RICORDA il contesto (dice 4) e NON ricomincia", r.get("ok") and not r.get("skip") and recalls and not restarts,
      (r.get("reply") or "")[:90])

# B) PHONE-FORMAT VARIANCE — echo with differently formatted numbers, same guest.
print("\n[B] varianza formato telefono: l'eco usa formati diversi → stesso guest")
gid_before = guest()["id"]
# bare digits, no '+'
no_plus = re.sub(r"\D", "", PHONE)            # e.g. 34695400044
st1, _ = echo("Le escribo desde el número sin más, mismo cliente", no_plus)
g1 = guest()
check("eco con cifre nude (senza +) → stesso guest", g1 and g1["id"] == gid_before,
      f"same={g1 and g1['id'] == gid_before}")
check("hold attivo dopo eco formato 'cifre nude'", bool(g1 and g1.get("bot_paused_hold")),
      f"hold={g1 and g1.get('bot_paused_hold')}")
# 'whatsapp:'-prefixed variant
wa_pref = "whatsapp:" + PHONE
st2, _ = echo("Y desde el formato whatsapp: también soy yo", wa_pref)
g2 = guest()
check("eco con prefisso 'whatsapp:' → ancora lo stesso guest (nessun duplicato)", g2 and g2["id"] == gid_before,
      f"same={g2 and g2['id'] == gid_before}")
# no duplicate guest got created by the format variants
_, t = sb(f"guests?tenant_id=eq.{PICNIC}&select=id,phone")
dups = [g for g in json.loads(t) if re.sub(r"\D", "", g.get("phone") or "")[-9:] == re.sub(r"\D", "", PHONE)[-9:]]
check("nessun guest duplicato creato dalle varianti di formato", len(dups) == 1, f"count={len(dups)}")
# still muted under the variant-armed hold
ok, _ = muted("¿Hola?")
check("cliente ancora muto (hold regge con i formati misti)", ok)

# C) INTENT-AGNOSTIC hold — silence a NON-booking (FAQ/info) message too.
print("\n[C] hold intent-agnostico: anche una domanda info/FAQ è muta")
# still held from B; ask something that is NOT a booking
ok, r = muted("Por cierto, ¿tenéis aparcamiento cerca del restaurante?")
check("domanda info (non prenotazione) → muta mentre in hold", ok,
      f"skip={r.get('skip')} reply={(r.get('reply') or '')[:50]!r}")

# D) HOLD ≠ KILL-SWITCH — the hold path is genuine silence, not an auto-reply.
print("\n[D] hold ≠ kill-switch: silenzio vero (skip + niente testo) ≠ auto-reply del kill-switch")
ok, r = muted("¿Seguís ahí?")
# Structural distinction OBSERVABLE through this harness:
#   • HOLD  (Fetch-History guard)  → skip=true  AND empty cleanResponse  → real silence
#   • KILL-SWITCH (OpenAI node, tenant bot_config.bot_paused, NOT toggled here)
#                                   → skip FALSY AND a non-empty redirect reply
# So "skip=true with no reply text" is precisely the shape that is NOT the
# kill-switch. We assert that positive shape (we deliberately do not flip the
# tenant kill-switch — it's a business-policy value).
no_text = not (r.get("reply") or "").strip()
check("hold = skip=true", r.get("skip") is True, f"skip={r.get('skip')}")
check("hold = NESSUN testo di risposta (silenzio vero, non auto-reply)", ok and no_text,
      f"reply={(r.get('reply') or '')[:50]!r}")
# The kill-switch would have produced skip-falsy + a redirect text; the combo
# skip-true + empty reply is mutually exclusive with that path.
check("forma del hold mutuamente esclusiva col kill-switch (skip-true + reply vuota)",
      r.get("skip") is True and no_text, f"skip={r.get('skip')} reply_empty={no_text}")

# resume and confirm the bot is fully live again (FAQ now answered, not muted).
print("\n[E] chiusura: resume → la stessa FAQ ora riceve risposta (bot vivo)")
r = resume_db("¿Tenéis aparcamiento cerca?")
answered = r.get("ok") and not r.get("skip") and bool(r.get("reply"))
gE = guest()
check("hold pulito dopo il resume", not (gE and gE.get("bot_paused_hold")), f"hold={gE and gE.get('bot_paused_hold')}")
check("la FAQ ora riceve risposta (bot pienamente ripristinato)", answered,
      f"skip={r.get('skip')} reply={(r.get('reply') or '')[:60]!r}")

print("\n[cleanup]"); cleanup()
print(f"\n=== {len(PASS)} passed, {len(FAIL)} failed ===")
if FAIL:
    for n, e in FAIL: print("  FAIL:", n, "|", e)
    sys.exit(1)
print("ALL GREEN ✅")
