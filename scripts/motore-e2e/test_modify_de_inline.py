#!/usr/bin/env python3
"""E2E test for the two BALI Rest modify bugs (2026-06-03):
  Bug 1: German modify trigger ("Ändern") replied in Spanish (missing 'de' branch).
  Bug 2: "Ändern, es kommen noch 2 personen dazu" -> bot lost context, asked
         "what to modify?" instead of applying +2 (inline modify discarded).

Strategy:
  - clean test phone
  - seed a confirmed BALI Rest reservation (4 ppl, German, future date)
  - reset session, then send the inline-modify message
  - assert: reservation party_size becomes 6 AND the reply is German (not Spanish)
"""
import sys, json, time, urllib.request, urllib.error
sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send import send, load_env, http

TENANT = "a085e5bb-11f3-47f9-96da-c6cfdbff2ea0"  # BALI Rest
PHONE_WA = "whatsapp:+34699555201"
PHONE_DIGITS = "34699555201"

env = load_env()
SB = env["NEXT_PUBLIC_SUPABASE_URL"]
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def sb(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    return http(SB + path, data=data, headers=h, method=method)


def cleanup():
    # find guests for this phone (this tenant)
    s, txt = sb("GET", f"/rest/v1/guests?tenant_id=eq.{TENANT}&phone=ilike.*{PHONE_DIGITS}*&select=id")
    gids = [g["id"] for g in (json.loads(txt) if s == 200 else [])]
    if gids:
        inlist = ",".join(gids)
        # conversations FK references reservations -> delete conversations first
        sb("DELETE", f"/rest/v1/conversations?tenant_id=eq.{TENANT}&guest_id=in.({inlist})")
        sb("DELETE", f"/rest/v1/reservations?tenant_id=eq.{TENANT}&guest_id=in.({inlist})")
    sb("DELETE", f"/rest/v1/bot_messages?tenant_id=eq.{TENANT}&phone=eq.{PHONE_DIGITS}")
    # bot_sessions keyed by phone (may be +prefixed)
    for p in (PHONE_DIGITS, "+" + PHONE_DIGITS):
        sb("DELETE", f"/rest/v1/bot_sessions?phone=eq.{urlenc(p)}")
    if gids:
        sb("DELETE", f"/rest/v1/guests?tenant_id=eq.{TENANT}&id=in.({','.join(gids)})")
    print(f"  cleanup: removed {len(gids)} guest(s) + their reservations/messages")


def urlenc(s):
    import urllib.parse
    return urllib.parse.quote(s, safe="")


def seed_reservation():
    # create guest
    s, txt = sb("POST", "/rest/v1/guests",
                {"tenant_id": TENANT, "name": "E2E DE Test", "phone": PHONE_DIGITS},
                prefer="return=representation")
    assert s in (200, 201), f"guest create failed {s}: {txt}"
    gid = json.loads(txt)[0]["id"]
    # future date = today + 7 days
    import datetime
    d = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
    res = {
        "tenant_id": TENANT, "guest_id": gid, "date": d, "time": "13:30:00",
        "party_size": 4, "status": "confirmed", "language": "de",
        "source": "ai_chat",
        "notes": "1 Kind mit schwerer Sesam-Allergie",
    }
    s, txt = sb("POST", "/rest/v1/reservations", res, prefer="return=representation")
    assert s in (200, 201), f"reservation create failed {s}: {txt}"
    rid = json.loads(txt)[0]["id"]
    print(f"  seeded reservation {rid[:8]} : {d} 13:30 party=4 de interior")
    return gid, rid, d


def get_res(rid):
    s, txt = sb("GET", f"/rest/v1/reservations?id=eq.{rid}&select=party_size,status,date,time,language")
    return json.loads(txt)[0] if s == 200 and json.loads(txt) else None


SPANISH_MARKERS = ["¿qué", "qué quieres", "dime el dato", "personas", "modificar", "cuántas", "hora, fecha"]
GERMAN_MARKERS = ["ändern", "personen", "uhr", "möchte", "bestätigt", "geändert", "danke", "bereich", "reservierung", "wie viele", "datum"]


def lang_of(text):
    t = (text or "").lower()
    de = sum(1 for m in GERMAN_MARKERS if m in t)
    es = sum(1 for m in SPANISH_MARKERS if m in t)
    return de, es


def main():
    print("=== SETUP ===")
    cleanup()
    gid, rid, d = seed_reservation()

    print("\n=== TURN 0: reset session (clean slate) ===")
    r0 = send(TENANT, PHONE_WA, "__TENANT_SELECTED__")
    print(f"  status={r0.get('status')} skip={r0.get('skip')}")
    time.sleep(4)

    print("\n=== TURN 1: inline modify in German (real Sofía phrasing) ===")
    # Exact message from Sofía's screenshot. "nich" is colloquial for "nur"
    # (I just wanted to say), NOT the negation "nicht". The bot must read the
    # intent: 2 more people are coming -> 4 + 2 = 6.
    msg = "Ändern. Sorry. Ich wollte nur sagen: es kommen noch 2 Personen dazu, kann man das ändern?"
    r1 = send(TENANT, PHONE_WA, msg)
    reply = r1.get("reply") or ""
    print(f"  status={r1.get('status')} skip={r1.get('skip')} modify={bool(r1.get('modify'))}")
    print(f"  [B reply]: {reply or '<skip-path / no logged text>'}")
    if r1.get("modify"):
        print(f"  modifyData: {json.dumps(r1.get('modify'), ensure_ascii=False)}")

    # let the modify settle in DB
    time.sleep(5)
    res_after = get_res(rid)
    print(f"\n=== ASSERTIONS ===")
    print(f"  reservation now: {json.dumps(res_after, ensure_ascii=False)}")

    de, es = lang_of(reply)
    results = []

    # Bug 2: party_size should become 6 (4 + 2). The modify may go through the LLM
    # which calls modify_reservation -> Book+Notify writes party_size.
    ps_ok = res_after and res_after.get("party_size") == 6
    results.append(("BUG2 party_size 4->6 (inline modify applied)", ps_ok,
                    f"party_size={res_after.get('party_size') if res_after else None}"))

    # Bug 2 alt signal: modifyData captured with personas 6 even if DB write lags
    md = r1.get("modify") or {}
    md_ok = (md.get("personas") == 6) or (md.get("delta_personas") == 2)
    results.append(("BUG2 modify_reservation called w/ 6 (or +2)", md_ok or ps_ok,
                    f"modifyData={json.dumps(md, ensure_ascii=False) if md else 'none'}"))

    # Bug 1: reply must be German, not Spanish. Only meaningful if a reply was logged.
    if reply.strip():
        lang_ok = de > es
        results.append(("BUG1 reply in German not Spanish", lang_ok, f"de_markers={de} es_markers={es}"))
    else:
        results.append(("BUG1 reply language (no logged text — inline path went to LLM)", None,
                        "reply empty; check did NOT hit skip-path ask"))

    # Bug 2 corollary: must NOT be the generic "what to modify" skip-path
    not_generic = not any(m in (reply or "").lower() for m in ["qué quieres modificar", "was möchtest du ändern", "che cosa vuoi modificare", "what would you like to change"])
    results.append(("BUG2 did NOT ask generic 'what to modify?'", not_generic if reply.strip() else (not r1.get("skip")),
                    f"skip={r1.get('skip')}"))

    print()
    allok = True
    for name, ok, detail in results:
        sym = "✓" if ok else ("•" if ok is None else "✗")
        if ok is False:
            allok = False
        print(f"  {sym} {name}  [{detail}]")

    print("\n" + ("✅ PASS" if allok else "❌ FAIL — see above"))
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
