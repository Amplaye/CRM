#!/usr/bin/env python3
"""Motore unico E2E harness: POST a WhatsApp message to the engine webhook,
poll executions, return the engine's reply + structured data.

Usage:
  python3 send.py <tenant_id> <from> "<body>" [msgsid]
Reads N8N_BASE_URL / N8N_API_KEY from CRM/.env.local
"""
import sys, json, time, os, urllib.request, urllib.parse, re

WF = "166QnQsGHqXDpBxa"
ENV = "/Users/amplaye/CRM/.env.local"

def load_env():
    e = {}
    for line in open(ENV):
        m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line)
        if m: e[m.group(1)] = m.group(2)
    return e

def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def send(tenant, frm, body, msgsid=None):
    env = load_env()
    base = env["N8N_BASE_URL"]; key = env["N8N_API_KEY"]
    msgsid = msgsid or ("E2E_%d" % int(time.time()*1000))
    payload = {"From": frm, "Body": body, "ProfileName": "E2E",
               "MessageSid": msgsid, "tenant_id": tenant}
    st, _ = http(base + "/webhook/picnic-whatsapp",
                 data=json.dumps(payload).encode(),
                 headers={"Content-Type": "application/json"}, method="POST")
    # poll executions for our msgsid
    deadline = time.time() + 70
    while time.time() < deadline:
        time.sleep(3)
        s, txt = http(base + "/api/v1/executions?workflowId=%s&limit=6&includeData=true" % WF,
                      headers={"X-N8N-API-KEY": key})
        if s != 200:
            continue
        for ex in json.loads(txt).get("data", []):
            try:
                rd = ex["data"]["resultData"]["runData"]
                par = rd["Process AI Response"][0]["data"]["main"][0][0]["json"]
            except Exception:
                continue
            # match our message via Extract Message msgsid if present, else by body
            try:
                em = rd["Extract Message"][0]["data"]["main"][0][0]["json"]
                if em.get("messageSid") != msgsid:
                    continue
            except Exception:
                continue
            return {
                "ok": True, "status": ex.get("status"),
                "reply": par.get("cleanResponse", ""),
                "skip": par.get("skip", False),
                "booking": par.get("bookingData"),
                "waitlist": par.get("waitlistData"),
                "modify": par.get("modifyData"),
                "lang": par.get("lang") or (par.get("botConfig") or {}).get("primary_language"),
                "intent": par.get("intent"),
                "execId": ex.get("id"),
            }
    return {"ok": False, "status": "timeout", "msgsid": msgsid}

if __name__ == "__main__":
    tenant, frm, body = sys.argv[1], sys.argv[2], sys.argv[3]
    msgsid = sys.argv[4] if len(sys.argv) > 4 else None
    print(json.dumps(send(tenant, frm, body, msgsid), ensure_ascii=False, indent=1))
