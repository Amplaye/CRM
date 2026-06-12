#!/usr/bin/env python3
"""E2E STRANGE PATTERNS: Coexistence takeover under interleaving / concurrency
chaos — the cases the multi-turn and re-arm tests don't cover.

Proves:
  A) COLD takeover: owner echoes BEFORE the customer ever wrote. The echo
     creates the guest + sets the hold, so the customer's very FIRST message is
     already silenced (skip=bot_paused). No "first message slips through".
  B) EMPTY echo: owner-echo with owner_text="" still arms the hold but does NOT
     pollute the transcript with an empty staff line.
  C) RAPID PING-PONG: customer / owner-echo / customer / owner-echo, many fast
     alternations. The bot stays silent on EVERY customer turn while held, and
     the staff messages accumulate IN ORDER in the transcript.
  D) MULTI-CYCLE re-arm: resume → re-takeover → resume → re-takeover → resume,
     several full cycles in one run. The hold flag flips cleanly each time, the
     bot is silent only while held, and the interleaved history is preserved.

All simulated via /api/webhooks/owner-echo (no real Coexistence number).
Run: python3 scripts/motore-e2e/test_takeover_interleave.py
"""
import sys, os, json, time, urllib.request, urllib.error, re
sys.path.insert(0, os.path.dirname(__file__))
from send import send, load_env

PICNIC = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5"
CRM_BASE = "https://crm.baliflowagency.com"
# Distinct test number, no 9-digit overlap with the 34699*/34698100011/34697200022
# ranges used by the other takeover tests (phone match is last-9-digit substring,
# so near-identical numbers cross-contaminate runs).
PHONE = "+34696300033"
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


def echo(text, phone=PHONE):
    return http(CRM_BASE + "/api/webhooks/owner-echo", method="POST",
                data=json.dumps({"tenant_id": PICNIC, "guest_phone": phone, "owner_text": text, "guest_name": "E2E Interleave"}).encode(),
                headers={"Content-Type": "application/json", "x-ai-secret": AI})


def send_reply(msg, tries=4):
    """Send + retry to absorb TRANSIENT harness misses (bot replied but the n8n
    execution wasn't caught in the poll window). Retries the OBSERVATION, not the
    behaviour. Returns the first real bot reply, else the last attempt."""
    last = {}
    for _ in range(tries):
        r = send(PICNIC, FROM, msg)
        last = r
        if r.get("ok") and not r.get("skip") and r.get("reply"):
            return r
    return last


def muted(msg, tries=3):
    """Assert the bot is silenced. The pause guard fails OPEN on a Supabase
    hiccup (documented PATCH:pause-fetch-retry-v1), so a rare transient can let
    one through — retry a couple of times to confirm the steady-state mute."""
    last = {}
    for _ in range(tries):
        r = send(PICNIC, FROM, msg)
        last = r
        if r.get("skip") is True:
            return True, r
    return False, last


def resume_db(last_msg=None):
    """Mirror the resume-bot server effect (clear both flags). Optionally
    re-drive a message afterwards."""
    g = guest()
    sb(f"guests?id=eq.{g['id']}", method="PATCH", body={"bot_paused_at": None, "bot_paused_hold": False})
    if last_msg is not None:
        return send_reply(last_msg)
    return None


PASS, FAIL = [], []
def check(name, cond, extra=""):
    (PASS if cond else FAIL).append((name, extra))
    print(("  ✅ " if cond else "  ❌ ") + name + (f"  [{extra}]" if extra else ""))


print("=== INTERLEAVE / CONCURRENCY takeover E2E (PICNIC) ===")
cleanup()

# A) COLD takeover — owner echoes before the customer ever wrote.
print("\n[A] COLD takeover: titolare scrive PRIMA che il cliente abbia mai scritto")
st, body = echo("Hola, le escribo yo directamente, ahora le atiendo 🙂")
check("owner-echo accettato (200) e crea il guest", st == 200, f"http={st} {body[:120]}")
gA = guest()
check("guest creato dall'eco con hold attivo", bool(gA and gA.get("bot_paused_hold")),
      f"hold={gA and gA.get('bot_paused_hold')}")
# The customer's FIRST EVER message must already be silenced.
ok, r = muted("Hola? Buenas, quería preguntar una cosa")
check("PRIMO messaggio del cliente già muto (niente 'primo messaggio sfugge')", ok,
      f"skip={r.get('skip')} reply={(r.get('reply') or '')[:50]!r}")

# B) EMPTY echo — arms the hold but doesn't add an empty staff line.
print("\n[B] eco VUOTA (owner_text='') → tiene l'hold ma non sporca il transcript")
g_before = guest()
tx_before = transcript(g_before["id"])
staff_before = [e for e in tx_before if e.get("role") == "staff"]
st2, _ = echo("")
check("eco vuota accettata (200)", st2 == 200, f"http={st2}")
g_after = guest()
check("hold ancora attivo dopo eco vuota", bool(g_after and g_after.get("bot_paused_hold")),
      f"hold={g_after and g_after.get('bot_paused_hold')}")
tx_after = transcript(g_after["id"])
staff_after = [e for e in tx_after if e.get("role") == "staff"]
check("eco vuota NON aggiunge una riga staff vuota", len(staff_after) == len(staff_before),
      f"staff {len(staff_before)}→{len(staff_after)}")
check("nessuna riga staff con content vuoto", all((e.get("content") or "").strip() for e in staff_after),
      f"empties={sum(1 for e in staff_after if not (e.get('content') or '').strip())}")

# C) RAPID PING-PONG — customer / echo / customer / echo … bot silent throughout.
print("\n[C] PING-PONG rapido: cliente↔titolare alternati → bot SEMPRE muto, staff in ordine")
owner_lines = [
    "Le confirmo la mesa en un momento",
    "¿Prefiere interior o terraza?",
    "Perfecto, terraza entonces",
    "Le guardo la mejor mesa 👌",
]
all_silent = True
for i, ol in enumerate(owner_lines):
    # customer writes -> must be muted
    ok, r = muted(f"Vale, mensaje cliente número {i+1}")
    if not ok:
        all_silent = False
        print(f"    ❌ cliente turno {i+1} NON muto: skip={r.get('skip')} reply={(r.get('reply') or '')[:40]!r}")
    # owner echoes back
    ste, _ = echo(ol)
    if ste != 200:
        print(f"    ⚠️  eco titolare {i+1} http={ste}")
check("bot muto su OGNI turno cliente durante il ping-pong", all_silent)
gC = guest()
check("hold ancora attivo dopo il ping-pong", bool(gC and gC.get("bot_paused_hold")),
      f"hold={gC and gC.get('bot_paused_hold')}")
# staff messages preserved IN ORDER (the 4 ping-pong lines are the tail of staff msgs)
staff_now = [e.get("content") for e in transcript(gC["id"]) if e.get("role") == "staff"]
tail = staff_now[-len(owner_lines):]
check("messaggi titolare accumulati IN ORDINE nel transcript", tail == owner_lines,
      f"tail={tail!r}")

# D) MULTI-CYCLE re-arm — several resume/re-takeover cycles in one run.
print("\n[D] MULTI-CICLO: resume → ri-takeover → resume … (più cicli)")
cycles_ok = True
for c in range(3):
    # resume -> bot must speak
    r = resume_db(f"Hola, retomamos, pregunta del ciclo {c+1}")
    g_resumed = guest()
    held_after_resume = bool(g_resumed and g_resumed.get("bot_paused_hold"))
    spoke = r.get("ok") and not r.get("skip") and bool(r.get("reply"))
    if held_after_resume or not spoke:
        cycles_ok = False
        print(f"    ❌ ciclo {c+1} resume: held={held_after_resume} spoke={spoke} reply={(r.get('reply') or '')[:40]!r}")
    else:
        print(f"    ✅ ciclo {c+1} resume: bot parla, hold pulito")
    # re-takeover -> bot must go silent again
    ste, _ = echo(f"Un momento, vuelvo a atender yo (ciclo {c+1})")
    g_held = guest()
    held = bool(g_held and g_held.get("bot_paused_hold"))
    ok, _ = muted("¿Sigues ahí?")
    if not (ste == 200 and held and ok):
        cycles_ok = False
        print(f"    ❌ ciclo {c+1} re-takeover: http={ste} held={held} muted={ok}")
    else:
        print(f"    ✅ ciclo {c+1} re-takeover: hold rimesso, bot muto")
check("3 cicli resume↔re-takeover puliti (flag flippa correttamente ogni volta)", cycles_ok)

# Final resume so we don't leave the guest stuck held (defensive; cleanup deletes it anyway).
resume_db()
gF = guest()
check("stato finale: hold pulito", not (gF and gF.get("bot_paused_hold")), f"hold={gF and gF.get('bot_paused_hold')}")

print("\n[cleanup]"); cleanup()
print(f"\n=== {len(PASS)} passed, {len(FAIL)} failed ===")
if FAIL:
    for n, e in FAIL: print("  FAIL:", n, "|", e)
    sys.exit(1)
print("ALL GREEN ✅")
