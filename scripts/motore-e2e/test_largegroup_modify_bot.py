#!/usr/bin/env python3
"""Bot-path confirmation of the large-group modify fix on an ACTIVE tenant
(Oraz is paused for a kill-switch test, so use BALI Rest). Drives the live
motore: seed 4p reservation WITH 2 tables, ask the bot to grow to 8, assert
DB reaches escalated + party=8 + 0 table links (the requires_review branch
that now also notifies the client). Cleans up after."""
import sys, json, time, datetime, urllib.parse
sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send import send, load_env, http

TENANT = "a085e5bb-11f3-47f9-96da-c6cfdbff2ea0"  # BALI Rest (active)
PHONE_WA = "whatsapp:+34699555312"
PHONE_DIGITS = "34699555312"

env = load_env()
SB = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

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

def seed():
    s, txt = sb("POST", "/rest/v1/guests", {"tenant_id": TENANT, "name": "E2E LG Bot", "phone": PHONE_DIGITS}, prefer="return=representation")
    gid = json.loads(txt)[0]["id"]
    d = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    res = {"tenant_id": TENANT, "guest_id": gid, "date": d, "time": "20:30:00", "party_size": 4,
           "status": "confirmed", "language": "es", "source": "ai_chat", "shift": "dinner", "end_time": "22:30:00"}
    s, txt = sb("POST", "/rest/v1/reservations", res, prefer="return=representation")
    rid = json.loads(txt)[0]["id"]
    s, txt = sb("GET", f"/rest/v1/restaurant_tables?tenant_id=eq.{TENANT}&status=eq.active&select=id,name&order=name&limit=2")
    tbls = json.loads(txt)
    sb("POST", "/rest/v1/reservation_tables", [{"reservation_id": rid, "table_id": t["id"]} for t in tbls], prefer="return=minimal")
    print(f"  seeded {rid[:8]} {d} 20:30 party=4 + {len(tbls)} tables {[t['name'] for t in tbls]}")
    return rid

def tcount(rid):
    s, txt = sb("GET", f"/rest/v1/reservation_tables?reservation_id=eq.{rid}&select=id")
    return len(json.loads(txt)) if s == 200 else -1

def getres(rid):
    s, txt = sb("GET", f"/rest/v1/reservations?id=eq.{rid}&select=party_size,status")
    a = json.loads(txt) if s == 200 else []
    return a[0] if a else None

def main():
    print("=== CLEANUP (pre) ==="); cleanup()
    rid = seed()
    send(TENANT, PHONE_WA, "__TENANT_SELECTED__"); time.sleep(4)
    # Turn 1: request the change (the bot asks to confirm which reservation).
    r = send(TENANT, PHONE_WA, "Hola, quiero modificar mi reserva: ahora seremos 8 personas")
    print(f"  [T1] status={r.get('status')} modify={bool(r.get('modify'))} reply={(r.get('reply') or '-')[:180]}")
    time.sleep(5)
    # Turn 2: confirm (modify only applies after the client confirms).
    r2 = send(TENANT, PHONE_WA, "Sí, confirmo")
    print(f"  [T2] status={r2.get('status')} modify={bool(r2.get('modify'))} reply={(r2.get('reply') or '<no logged text>')[:200]}")
    if r2.get('modify'):
        print(f"  modifyData: {json.dumps(r2.get('modify'), ensure_ascii=False)}")
    time.sleep(7)
    res = getres(rid); post = tcount(rid)
    checks = [
        ("party_size 4->8 applied", res and res.get("party_size") == 8, f"party={res.get('party_size') if res else None}"),
        ("status=escalated (requires_review path)", res and res.get("status") == "escalated", f"status={res.get('status') if res else None}"),
        ("tables released (0 links)", post == 0, f"links={post}"),
    ]
    print("\n=== CLEANUP (post) ==="); cleanup()
    print("\n=== RESULTS (bot path, BALI Rest) ===")
    allok = True
    for n, ok, d in checks:
        if not ok: allok = False
        print(f"  {'✓' if ok else '✗'} {n}  [{d}]")
    print("\n" + ("✅ PASS" if allok else "❌ FAIL"))
    return 0 if allok else 1

if __name__ == "__main__":
    sys.exit(main())
