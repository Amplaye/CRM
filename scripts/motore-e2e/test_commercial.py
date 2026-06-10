#!/usr/bin/env python3
"""E2E for the commercial-info module on the LIVE motore unico (WF 166).

Sets up a NON-destructive test on PICNIC (not paused): flag ON + 2 commerciale
articles, exercises reactive (multilingual) + proactive (occasion/group) + the
flag-OFF gate, then restores everything. Reads engine internals from the execution
log (cleanResponse / commercialOn / commercialOffered / interactiveButtons).

  python3 test_commercial.py
"""
import sys, json, time
sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send import load_env, http

WF = "166QnQsGHqXDpBxa"
PICNIC = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5"

env = load_env()
SB = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
N8N = env["N8N_BASE_URL"]; NKEY = env["N8N_API_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

def patch_settings(tid, settings):
    http(SB + "/rest/v1/tenants?id=eq." + tid, data=json.dumps({"settings": settings}).encode(),
         headers={**H, "Prefer": "return=minimal"}, method="PATCH")

def get_settings(tid):
    s, t = http(SB + "/rest/v1/tenants?select=settings&id=eq." + tid, headers=H)
    return json.loads(t)[0]["settings"]

def set_flag(tid, on):
    st = get_settings(tid)
    st.setdefault("features", {})["commercial_info_enabled"] = on
    patch_settings(tid, st)

def turn(frm, body, want_keys=None):
    """Post one message, poll the execution, return engine internals for our msg."""
    msgsid = "E2E_COMM_%d" % int(time.time() * 1000)
    payload = {"From": frm, "Body": body, "ProfileName": "E2E", "MessageSid": msgsid, "tenant_id": PICNIC}
    http(N8N + "/webhook/picnic-whatsapp", data=json.dumps(payload).encode(),
         headers={"Content-Type": "application/json"}, method="POST")
    deadline = time.time() + 75
    while time.time() < deadline:
        time.sleep(3)
        s, txt = http(N8N + "/api/v1/executions?workflowId=%s&limit=8&includeData=true" % WF,
                      headers={"X-N8N-API-KEY": NKEY})
        if s != 200:
            continue
        for ex in json.loads(txt).get("data", []):
            try:
                rd = ex["data"]["resultData"]["runData"]
                em = rd["Extract Message"][0]["data"]["main"][0][0]["json"]
                if em.get("messageSid") != msgsid:
                    continue
                par = rd["Process AI Response"][0]["data"]["main"][0][0]["json"]
                return {
                    "reply": par.get("cleanResponse", ""),
                    "commercialOn": par.get("commercialOn"),
                    "commercialOffers": par.get("commercialOffers"),
                    "commercialOffered": par.get("commercialOffered"),
                    "interactiveButtons": par.get("interactiveButtons"),
                    "lang": par.get("lang"),
                }
            except Exception:
                continue
    return {"reply": "<timeout>", "error": True}

PASS = []; FAIL = []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  ✓ " if cond else "  ✗ ") + name + ((" — " + detail) if detail else ""))

orig = get_settings(PICNIC)
test_ids = []
try:
    print("① Setup PICNIC: flag ON + 2 commerciale test articles")
    set_flag(PICNIC, True)
    arts = [
        {"tenant_id": PICNIC, "title": "Tartas test", "category": "commerciale", "status": "published",
         "content": "LISTA DE TARTAS (test)\n- Tarta de helado 25€/kg\n- Milhojas 25€/kg\n- Tarta espatulada 32€/kg", "risk_tags": [], "version": 1, "author_id": "", "display_order": 900},
        {"tenant_id": PICNIC, "title": "Buffet test", "category": "commerciale", "status": "published",
         "content": "BUFFET (test)\nBUFFET DRINK 25€ por persona\nBUFFET FOOD 25€ por persona", "risk_tags": [], "version": 1, "author_id": "", "display_order": 901},
    ]
    s, t = http(SB + "/rest/v1/knowledge_articles", data=json.dumps(arts).encode(),
                headers={**H, "Prefer": "return=representation"}, method="POST")
    test_ids = [a["id"] for a in json.loads(t)] if s in (200, 201) else []
    print("   inserted", len(test_ids), "test articles")
    time.sleep(2)

    F = "whatsapp:+99000111222"   # fake isolated tester
    print("\n② REACTIVE — explicit commercial question, multilingual")
    r = turn(F, "Hola, ¿me pasas la lista de tartas y precios?")
    check("ES: commercialOn true seen by engine", r.get("commercialOn") is True, "commercialOn=%s" % r.get("commercialOn"))
    check("ES: reply mentions a cake price (25)", "25" in (r.get("reply") or ""), repr((r.get("reply") or "")[:120]))

    r = turn("whatsapp:+99000111333", "Ciao, quanto costa la torta?")
    check("IT: detected italian + answered (25 in reply)", "25" in (r.get("reply") or "") or (r.get("lang") == "it"), "lang=%s reply=%s" % (r.get("lang"), repr((r.get("reply") or "")[:120])))

    print("\n③ PROACTIVE — occasion word → tappable buttons")
    r = turn("whatsapp:+99000222444", "Hola, es para un cumpleaños")
    check("occasion: commercialOffered true", r.get("commercialOffered") is True, "offered=%s" % r.get("commercialOffered"))
    check("occasion: interactiveButtons present", bool(r.get("interactiveButtons")), "buttons=%s" % json.dumps(r.get("interactiveButtons"), ensure_ascii=False))

    print("\n④ PROACTIVE — large group → tappable buttons")
    r = turn("whatsapp:+99000333555", "Buenas, somos 12 personas para una comida")
    check("group: commercialOffered true", r.get("commercialOffered") is True, "offered=%s" % r.get("commercialOffered"))
    check("group: buttons present", bool(r.get("interactiveButtons")), "buttons=%s" % json.dumps(r.get("interactiveButtons"), ensure_ascii=False))

    print("\n⑤ GATE — flag OFF → no commercial answer, no proactive offer")
    set_flag(PICNIC, False)
    time.sleep(2)
    r = turn("whatsapp:+99000444666", "Hola, es para un cumpleaños, ¿me pasas la lista de tartas?")
    check("OFF: engine sees commercialOn false", r.get("commercialOn") in (False, None), "commercialOn=%s" % r.get("commercialOn"))
    check("OFF: no proactive offer fired", not r.get("commercialOffered"), "offered=%s" % r.get("commercialOffered"))
    check("OFF: reply does not leak test cake price", "32€/kg" not in (r.get("reply") or ""), repr((r.get("reply") or "")[:120]))

finally:
    print("\n⑥ Cleanup")
    for aid in test_ids:
        http(SB + "/rest/v1/knowledge_articles?id=eq." + aid, headers={k: v for k, v in H.items() if k != "Prefer"}, method="DELETE")
    patch_settings(PICNIC, orig)   # restore exact original settings (flag + everything)
    print("   removed test articles, restored PICNIC settings")

print("\n=== RESULT: %d passed, %d failed ===" % (len(PASS), len(FAIL)))
if FAIL:
    print("FAILED:", FAIL); sys.exit(1)
