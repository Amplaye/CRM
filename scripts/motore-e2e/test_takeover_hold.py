#!/usr/bin/env python3
"""E2E: Coexistence owner-takeover HOLD + manual handoff back to the bot.

Simulates the whole flow WITHOUT a real Coexistence number — the owner's manual
reply (the `smb_message_echoes` the BSP would forward) is injected via the real
/api/webhooks/owner-echo endpoint, which is the production simulation seam.

Flow asserted:
  1. customer asks to book        -> bot engages (reply, not skip)
  2. owner echo (manual reply)    -> hold set on guest (bot_paused_hold=true)
  3. customer writes again        -> bot SILENT (skip=bot_paused)
  4. wait past the 60s cooldown   -> bot STILL silent (proves HOLD, not cooldown)
  5. "Completa col bot" (resume)  -> bot speaks again WITH context (not skip)

Run: python3 scripts/motore-e2e/test_takeover_hold.py
"""
import sys, os, json, time, urllib.request, urllib.error, re
sys.path.insert(0, os.path.dirname(__file__))
from send import send, load_env  # reuse the engine harness

PICNIC = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5"
CRM_BASE = "https://crm.baliflowagency.com"
PHONE = "+34699000077"                 # test range 34699*
FROM = "whatsapp:" + PHONE

ENV = load_env()
SB = ENV["NEXT_PUBLIC_SUPABASE_URL"]
SRK = ENV["SUPABASE_SERVICE_ROLE_KEY"]
AI_SECRET = ENV["AI_WEBHOOK_SECRET"]

def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def sb(path, method="GET", body=None, prefer=None):
    h = {"apikey": SRK, "Authorization": "Bearer " + SRK, "Content-Type": "application/json"}
    if prefer: h["Prefer"] = prefer
    return http(SB + "/rest/v1/" + path, data=json.dumps(body).encode() if body is not None else None,
                headers=h, method=method)

def find_guest():
    digits = re.sub(r"\D", "", PHONE)[-9:]
    s, t = sb(f"guests?tenant_id=eq.{PICNIC}&select=id,phone,bot_paused_at,bot_paused_hold,name")
    for g in json.loads(t):
        gd = re.sub(r"\D", "", g.get("phone") or "")
        if gd and (gd[-9:] == digits or digits in gd or gd in digits):
            return g
    return None

def cleanup():
    g = find_guest()
    if not g: return
    gid = g["id"]
    sb(f"conversations?guest_id=eq.{gid}", method="DELETE")
    sb(f"reservations?guest_id=eq.{gid}", method="DELETE")
    sb(f"guests?id=eq.{gid}", method="DELETE")

PASS, FAIL = [], []
def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  ✅ " if cond else "  ❌ ") + name + (f"  [{extra}]" if extra else ""))

print("=== Takeover HOLD E2E (PICNIC) ===")
cleanup()

# 1. customer engages the bot
print("\n[1] cliente prenota →")
r1 = send(PICNIC, FROM, "Hola, quiero reservar una mesa para 4 personas mañana a las 21:00")
check("bot engaged (reply, not skip)", r1.get("ok") and not r1.get("skip") and bool(r1.get("reply")),
      f"skip={r1.get('skip')} reply={(r1.get('reply') or '')[:60]!r}")

# 2. owner replies manually from the app → echo endpoint sets the HOLD
print("\n[2] eco titolare (risposta manuale dall'app) →")
st, body = http(CRM_BASE + "/api/webhooks/owner-echo", method="POST",
                data=json.dumps({"tenant_id": PICNIC, "guest_phone": PHONE,
                                 "owner_text": "Hola, te atiendo yo personalmente, dame un momento 🙂",
                                 "guest_name": "E2E Takeover"}).encode(),
                headers={"Content-Type": "application/json", "x-ai-secret": AI_SECRET})
check("owner-echo 200", st == 200, f"http={st} {body[:120]}")
g = find_guest()
check("hold set on guest (bot_paused_hold=true)", bool(g and g.get("bot_paused_hold")),
      f"hold={g and g.get('bot_paused_hold')} paused_at={g and g.get('bot_paused_at')}")
# owner message landed in the transcript (role staff)
s, t = sb(f"conversations?guest_id=eq.{g['id']}&select=transcript&order=created_at.desc&limit=1")
tx = (json.loads(t) or [{}])[0].get("transcript") or []
check("owner msg in transcript (role staff)", any(e.get("role") == "staff" for e in tx),
      f"roles={[e.get('role') for e in tx]}")

# 3. customer writes again → bot must stay SILENT
print("\n[3] cliente riscrive (bot deve tacere) →")
r2 = send(PICNIC, FROM, "Perfecto, ¿me lo confirmáis entonces?")
check("bot SILENT while held (skip=bot_paused)", r2.get("skip") is True,
      f"skip={r2.get('skip')} reply={(r2.get('reply') or '')[:60]!r}")

# 4. wait past the 60s cooldown → still silent (proves HOLD, not the 60s timer)
print("\n[4] attendo oltre il cooldown 60s (prova che è HOLD, non timer) …")
time.sleep(63)
r3 = send(PICNIC, FROM, "¿Hola? ¿Sigue ahí?")
check("bot STILL silent after cooldown (hold holds)", r3.get("skip") is True,
      f"skip={r3.get('skip')}")

# 5. "Completa col bot" → mirror resume-bot: clear hold + re-trigger last user msg
print("\n[5] 'Completa col bot' → riattivazione + ripresa con contesto →")
sb(f"guests?id=eq.{g['id']}", method="PATCH", body={"bot_paused_at": None, "bot_paused_hold": False})
g2 = find_guest()
check("hold cleared", not (g2 and g2.get("bot_paused_hold")), f"hold={g2 and g2.get('bot_paused_hold')}")
# resume-bot re-sends the last USER message; engine has full history incl. owner turn
last_user = ""
for e in reversed(tx):
    if e.get("role") == "user":
        last_user = e.get("content") or ""; break
last_user = last_user or "¿me lo confirmáis?"
r4 = send(PICNIC, FROM, last_user)
resumed = r4.get("ok") and not r4.get("skip") and bool(r4.get("reply"))
check("bot resumed (speaks again, not skip)", resumed,
      f"skip={r4.get('skip')} reply={(r4.get('reply') or '')[:80]!r}")
ctx = (r4.get("reply") or "").lower()
# Context retained if the bot CONTINUES the flow (asks the next missing field /
# acknowledges it already has the data) instead of RESTARTING (re-asking how many
# people / which day). Either is proof it kept the owner-era history.
continues = any(k in ctx for k in ["interior", "exterior", "ya tengo", "nombre", "confirm", "21", "cuatro", "4"])
restarts = any(k in ctx for k in ["cuántas personas", "cuantas personas", "qué día", "que dia", "para cuántos"])
check("reply keeps booking context (continues, not restarts)", resumed and continues and not restarts,
      f"reply={(r4.get('reply') or '')[:100]!r}")

cleanup()
print(f"\n=== {len(PASS)} passed, {len(FAIL)} failed ===")
if FAIL:
    print("FAILED:", FAIL); sys.exit(1)
print("ALL GREEN ✅")
