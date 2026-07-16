#!/usr/bin/env python3
"""Local Meta Graph API capture server for bot-engine E2E (golden diff).

The Worker runs with META_GRAPH_BASE_URL=http://localhost:8788 so every
"WhatsApp send" lands here instead of graph.facebook.com.

Endpoints:
  POST /v21.0/<phone_number_id>/messages  -> store payload, reply {"messages":[{"id":"wamid.mockN"}]}
  GET  /sent?to=<digits>[&since=<epoch>]  -> text messages sent to that recipient
  GET  /all                               -> everything captured (debug)

Read receipts / typing indicators (status payloads) are stored but excluded
from /sent (only type=text messages count as replies).
"""
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

LOCK = threading.Lock()
CAPTURED = []  # {t, phone_number_id, payload}
COUNTER = [0]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[2] == "messages":
            ln = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(ln)
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {"_raw": raw.decode(errors="replace")}
            with LOCK:
                COUNTER[0] += 1
                CAPTURED.append({"t": time.time(), "phone_number_id": parts[1], "payload": payload})
                mid = "wamid.mock%d" % COUNTER[0]
            self._json(200, {"messaging_product": "whatsapp", "messages": [{"id": mid}]})
            return
        self._json(404, {"error": "not_found"})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/sent":
            to = (q.get("to") or [""])[0]
            since = float((q.get("since") or ["0"])[0])
            with LOCK:
                rows = [
                    {"t": c["t"], "to": c["payload"].get("to"), "text": (c["payload"].get("text") or {}).get("body")}
                    for c in CAPTURED
                    if c["t"] > since
                    and c["payload"].get("type") == "text"
                    and (not to or str(c["payload"].get("to", "")).endswith(to[-9:]))
                ]
            self._json(200, {"messages": rows})
            return
        if u.path == "/all":
            with LOCK:
                self._json(200, {"captured": CAPTURED})
            return
        self._json(200, {"ok": True})

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8788), H).serve_forever()
