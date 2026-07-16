#!/usr/bin/env python3
"""Multi-turn conversation against the local bot-engine Worker (see send_worker.py).

convo_worker.py run <from> "t1" "t2" ...   -> sequential conversation
(DB assertions: reuse convo.py db <phone_digits> — same Supabase.)
"""
import json, sys, time

sys.path.insert(0, "/Users/amplaye/CRM/scripts/motore-e2e")
from send_worker import send


def run(frm, turns, pause=3):
    out = []
    for i, body in enumerate(turns):
        r = send(frm, body)
        print("\n[U] %s" % body)
        for rep in (r.get("replies") or ["<no reply>"]):
            print("[B] %s" % rep)
        out.append({"u": body, **r})
        if i < len(turns) - 1:
            time.sleep(pause)
    return out


if __name__ == "__main__":
    if sys.argv[1] == "run":
        out = run(sys.argv[2], sys.argv[3:])
        print("\n===JSON===")
        print(json.dumps(out, ensure_ascii=False))
    else:
        print("usage: convo_worker.py run <from> <turn1> ...")
