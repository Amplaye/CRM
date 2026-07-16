#!/usr/bin/env python3
"""E2E verify the large-group MODIFY fix (2026-06-10) on Oraz:

  Fix 1 (CRM /api/ai/modify): a 5->7 modify escalates WITHOUT holding tables
    (mirror the book route). Was wrongly calling atomic_book_tables -> the
    pending "solicitud" occupied tables on the floor.
  Fix 2 (motore Book+Notify): on a modify with requires_review, the CLIENT now
    gets the "en revisión / grupo grande" notice (before: only the owner).

TEST A (direct): seed 5p reservation WITH 2 table links, PUT /api/ai/modify
  party_size=7, assert response {requires_review, status:escalated,
  tables_assigned:[]} and DB reservation_tables == 0.
TEST B (bot): seed again, drive the live motore to modify to 7, assert DB
  escalated + party=7 + 0 table links (proves the bot path reaches the fix).
"""
import sys, json, time, datetime, urllib.parse
sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send import send, load_env, http

TENANT = "93eebe9c-8af5-4ca5-a315-3376ef4976e5"  # Oraz
PHONE_WA = "whatsapp:+34699555307"
PHONE_DIGITS = "34699555307"

env = load_env()
SB = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
CRM = env.get("CRM_API_BASE") or "https://crm.baliflowagency.com"
AI_SECRET = env["AI_WEBHOOK_SECRET"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))

def sb(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer: h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    return http(SB + path, data=data, headers=h, method=method)

def urlenc(s): return urllib.parse.quote(s, safe="")

def cleanup():
    s, txt = sb("GET", f"/rest/v1/guests?tenant_id=eq.{TENANT}&phone=ilike.*{PHONE_DIGITS}*&select=id")
    gids = [x["id"] for x in (json.loads(txt) if s == 200 else [])]
    if gids:
        inlist = ",".join(gids)
        s2, t2 = sb("GET", f"/rest/v1/reservations?tenant_id=eq.{TENANT}&guest_id=in.({inlist})&select=id")
        rids = [x["id"] for x in (json.loads(t2) if s2 == 200 else [])]
        if rids:
            sb("DELETE", f"/rest/v1/reservation_tables?reservation_id=in.({','.join(rids)})")
        sb("DELETE", f"/rest/v1/conversations?tenant_id=eq.{TENANT}&guest_id=in.({inlist})")
        sb("DELETE", f"/rest/v1/reservations?tenant_id=eq.{TENANT}&guest_id=in.({inlist})")
    sb("DELETE", f"/rest/v1/bot_messages?tenant_id=eq.{TENANT}&phone=eq.{PHONE_DIGITS}")
    for p in (PHONE_DIGITS, "+" + PHONE_DIGITS):
        sb("DELETE", f"/rest/v1/bot_sessions?phone=eq.{urlenc(p)}")
    if gids:
        sb("DELETE", f"/rest/v1/guests?tenant_id=eq.{TENANT}&id=in.({','.join(gids)})")
    print(f"  cleanup: removed {len(gids)} guest(s)")

def free_tables(n):
    s, txt = sb("GET", f"/rest/v1/restaurant_tables?tenant_id=eq.{TENANT}&status=eq.active&select=id,name&order=name&limit={n}")
    return json.loads(txt) if s == 200 else []

def seed(party=5, ntables=2):
    s, txt = sb("POST", "/rest/v1/guests",
                {"tenant_id": TENANT, "name": "E2E LargeGroup", "phone": PHONE_DIGITS},
                prefer="return=representation")
    assert s in (200, 201), f"guest {s}:{txt}"
    gid = json.loads(txt)[0]["id"]
    d = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    res = {"tenant_id": TENANT, "guest_id": gid, "date": d, "time": "20:30:00",
           "party_size": party, "status": "confirmed", "language": "it",
           "source": "ai_chat", "shift": "dinner", "end_time": "22:30:00"}
    s, txt = sb("POST", "/rest/v1/reservations", res, prefer="return=representation")
    assert s in (200, 201), f"res {s}:{txt}"
    rid = json.loads(txt)[0]["id"]
    tbls = free_tables(ntables)
    s, txt = sb("POST", "/rest/v1/reservation_tables",
                [{"reservation_id": rid, "table_id": t["id"]} for t in tbls],
                prefer="return=minimal")
    assert s in (200, 201), f"links {s}:{txt}"
    print(f"  seeded {rid[:8]} {d} 20:30 party={party} + {len(tbls)} tables {[t['name'] for t in tbls]}")
    return gid, rid

def table_count(rid):
    s, txt = sb("GET", f"/rest/v1/reservation_tables?reservation_id=eq.{rid}&select=id")
    return len(json.loads(txt)) if s == 200 else -1

def get_res(rid):
    s, txt = sb("GET", f"/rest/v1/reservations?id=eq.{rid}&select=party_size,status")
    a = json.loads(txt) if s == 200 else []
    return a[0] if a else None

def test_direct():
    print("\n=== TEST A: Fix 1 — direct /api/ai/modify 5->7 releases tables ===")
    gid, rid = seed(5, 2)
    pre = table_count(rid)
    print(f"  pre-modify links: {pre}")
    body = json.dumps({"tenant_id": TENANT, "reservation_id": rid, "party_size": 7}).encode()
    st, txt = http(CRM + "/api/ai/modify", data=body,
                   headers={"Content-Type": "application/json", "x-ai-secret": AI_SECRET},
                   method="PUT")
    print(f"  modify HTTP {st}: {txt[:280]}")
    data = json.loads(txt) if txt[:1] in "{[" else {}
    check("A1 pre-seed had 2 table links", pre == 2, f"pre={pre}")
    check("A2 response requires_review=true", data.get("requires_review") is True, f"={data.get('requires_review')}")
    check("A3 response status=escalated", data.get("status") == "escalated", f"={data.get('status')}")
    check("A4 response tables_assigned=[]", data.get("tables_assigned") == [], f"={data.get('tables_assigned')}")
    time.sleep(2)
    post = table_count(rid); res = get_res(rid)
    check("A5 DB tables released (0 links)", post == 0, f"post={post}")
    check("A6 DB status=escalated & party=7", res and res.get("status") == "escalated" and res.get("party_size") == 7,
          f"status={res.get('status') if res else None} party={res.get('party_size') if res else None}")

def test_bot():
    print("\n=== TEST B: Fix 2 — bot modify 5->7 reaches escalated + 0 tables ===")
    gid, rid = seed(5, 2)
    send(TENANT, PHONE_WA, "__TENANT_SELECTED__"); time.sleep(4)
    r = send(TENANT, PHONE_WA, "Ciao, vorrei modificare la mia prenotazione: ora saremo in 7")
    print(f"  bot status={r.get('status')} modify={bool(r.get('modify'))} reply={(r.get('reply') or '<no logged text>')[:160]}")
    time.sleep(6)
    post = table_count(rid); res = get_res(rid)
    check("B1 DB status=escalated after bot modify", res and res.get("status") == "escalated",
          f"status={res.get('status') if res else None}")
    check("B2 DB party_size=7", res and res.get("party_size") == 7, f"party={res.get('party_size') if res else None}")
    check("B3 DB tables released (0 links)", post == 0, f"post={post}")

def main():
    print("=== CLEANUP (pre) ==="); cleanup()
    try:
        test_direct()
        test_bot()
    finally:
        print("\n=== CLEANUP (post) ==="); cleanup()
    print("\n=== RESULTS ===")
    allok = True
    for name, ok, detail in results:
        if not ok: allok = False
        print(f"  {'✓' if ok else '✗'} {name}  [{detail}]")
    print("\n" + ("✅ PASS" if allok else "❌ FAIL — see above"))
    return 0 if allok else 1

if __name__ == "__main__":
    sys.exit(main())
