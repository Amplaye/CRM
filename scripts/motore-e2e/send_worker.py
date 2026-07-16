#!/usr/bin/env python3
"""bot-engine (Cloudflare Worker) E2E harness — mirror of send.py for the Worker.

Builds a REAL Meta webhook payload, signs the raw bytes with HMAC-SHA256
(META_APP_SECRET dev value), POSTs it to the local `wrangler dev` Worker and
polls the local capture server (capture_server.py) for the reply text(s).

Usage:
  python3 send_worker.py "<from digits or whatsapp:+...>" "<body>" [wamid]
  (tenant is resolved by the Worker via phone_number_id -> Oraz)

Env knobs (defaults match the Task 1.6 setup):
  WORKER_URL   http://localhost:8787/webhooks/meta/whatsapp
  CAPTURE_URL  http://localhost:8788
  APP_SECRET   dev-secret-e2e
  PHONE_NUMBER_ID 1095078260361095  (Oraz)
"""
import hashlib, hmac, json, os, sys, time, urllib.request

WORKER_URL = os.environ.get("WORKER_URL", "http://localhost:8787/webhooks/meta/whatsapp")
CAPTURE_URL = os.environ.get("CAPTURE_URL", "http://localhost:8788")
APP_SECRET = os.environ.get("APP_SECRET", "dev-secret-e2e")
PHONE_NUMBER_ID = os.environ.get("PHONE_NUMBER_ID", "1095078260361095")


def http(url, data=None, headers=None, method=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def digits(frm):
    return "".join(ch for ch in str(frm) if ch.isdigit())


def send(frm, body, wamid=None, profile_name="E2E", timeout_s=90, settle_s=6):
    """POST one inbound message; wait for reply text(s) from the capture server.

    Returns {ok, replies:[...], wamid}. Waits `settle_s` after the first reply
    for possible extra messages (recap cards etc.).
    """
    frm_digits = digits(frm)
    wamid = wamid or ("wamid.E2E%d" % int(time.time() * 1000))
    now = int(time.time())
    payload = {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "0",
            "changes": [{
                "field": "messages",
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "34600000000", "phone_number_id": PHONE_NUMBER_ID},
                    "contacts": [{"profile": {"name": profile_name}, "wa_id": frm_digits}],
                    "messages": [{
                        "from": frm_digits,
                        "id": wamid,
                        "timestamp": str(now),
                        "type": "text",
                        "text": {"body": body},
                    }],
                },
            }],
        }],
    }
    raw = json.dumps(payload).encode()  # serialize ONCE, sign these bytes
    sig = "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    t0 = time.time() - 1
    st, txt = http(WORKER_URL, data=raw, method="POST",
                   headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig})
    if st != 200:
        return {"ok": False, "status": st, "error": txt[:300], "wamid": wamid}

    # Debounce is 3s (9s after a notes question) + LLM latency: poll capture.
    deadline = time.time() + timeout_s
    replies = []
    first_at = None
    while time.time() < deadline:
        time.sleep(1.5)
        s, t = http(CAPTURE_URL + "/sent?to=%s&since=%f" % (frm_digits, t0), timeout=10)
        if s != 200:
            continue
        msgs = json.loads(t).get("messages", [])
        if msgs:
            replies = [m["text"] for m in msgs]
            if first_at is None:
                first_at = time.time()
            if time.time() - first_at >= settle_s:
                break
    return {"ok": bool(replies), "replies": replies, "wamid": wamid}


if __name__ == "__main__":
    frm, body = sys.argv[1], sys.argv[2]
    wamid = sys.argv[3] if len(sys.argv) > 3 else None
    print(json.dumps(send(frm, body, wamid), ensure_ascii=False, indent=1))
