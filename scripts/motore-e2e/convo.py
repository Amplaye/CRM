#!/usr/bin/env python3
"""Run a multi-turn conversation against the motore unico, load-safe (sequential, paused).
Also DB helpers to assert reservation state (for skip-path cancel/modify).

convo.py run <tenant_id> <from> <turn1> <turn2> ...    -> drives a conversation
convo.py db  <phone_digits>                            -> dump reservations for a phone
"""
import sys, json, time, re, urllib.request, urllib.error
sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send import send, load_env, http

def run(tenant, frm, turns, pause=4):
    out = []
    for i, body in enumerate(turns):
        r = send(tenant, frm, body)
        tag = []
        if r.get("booking"): tag.append("BOOK")
        if r.get("waitlist"): tag.append("WAITLIST")
        if r.get("modify"): tag.append("MODIFY")
        if r.get("skip"): tag.append("skip")
        print("\n[U] %s" % body)
        print("[B] (%s %s) %s" % (r.get("status"), "/".join(tag) or "-", r.get("reply") or "<no text / skip-path>"))
        out.append({"u": body, **r})
        if i < len(turns) - 1:
            time.sleep(pause)
    return out

def db(phone):
    env = load_env()
    base = env["NEXT_PUBLIC_SUPABASE_URL"]; key = env["SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": "Bearer " + key}
    s, txt = http(base + "/rest/v1/guests?select=id,name,phone&phone=ilike.*%s*" % phone, headers=h)
    guests = json.loads(txt) if s == 200 else []
    ids = [g["id"] for g in guests]
    rows = []
    if ids:
        inlist = ",".join(ids)
        s, txt = http(base + "/rest/v1/reservations?select=id,guest_id,date,time,party_size,status,notes,allergies,language,source&guest_id=in.(%s)&order=created_at.desc&limit=20" % inlist, headers=h)
        rows = json.loads(txt) if s == 200 else txt
        gn = {g["id"]: (g.get("name"), g.get("phone")) for g in guests}
        for r in (rows if isinstance(rows, list) else []):
            r["_guest"] = gn.get(r.get("guest_id"))
    print(json.dumps({"guests": guests, "reservations": rows}, ensure_ascii=False, indent=1))
    return rows

if __name__ == "__main__":
    if sys.argv[1] == "db":
        db(sys.argv[2])
    else:
        # run <tenant> <from> turns...
        run(sys.argv[2], sys.argv[3], sys.argv[4:])
