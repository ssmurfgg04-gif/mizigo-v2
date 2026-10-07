#!/usr/bin/env python3
"""Focused production-DB check (Supabase Postgres) — runs in one foreground pass.

Complements the full e2e suite (which runs against SQLite prod-sim + CI Postgres):
this exercises the remote-DB-critical path — bootstrap/seed, auth, quote,
booking, M-PESA lifecycle, matching, driver flow, the new safety-alert flow,
cancellation economics — in ~20 API calls so it stays fast over a WAN.

Usage: MIZIGO_BASE=http://localhost:3100 python3 scripts/supabase_check.py
"""
import json
import os
import urllib.request

BASE = os.environ.get("MIZIGO_BASE", "http://localhost:3100")
PASS, FAIL = 0, []


def call(path, method="GET", body=None, sess=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if sess:
        req.add_header("Cookie", sess)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=120) as r:
            payload = json.loads(r.read().decode())
            set_cookie = r.headers.get("Set-Cookie", "")
            if set_cookie:
                payload["_setCookie"] = set_cookie
            return payload
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {}
        payload["_status"] = e.code
        return payload


def check(name, ok, extra=""):
    global PASS
    mark = "PASS" if ok else "FAIL"
    print(f"  {mark}  {name} {extra if not ok else ''}")
    if ok:
        PASS += 1
    else:
        FAIL.append(name)


def login(phone):
    otp = call("/api/auth", "POST", {"action": "otp", "phone": phone})
    v = call("/api/auth", "POST", {"action": "verify", "phone": phone, "code": otp["devCode"], "name": "Check"})
    return (v.get("_setCookie", "").split(";")[0] or "").strip()


print("── supabase production check ──")
b = call("/api/bootstrap")
check("bootstrap + seed on remote DB", len(b.get("categories", [])) == 7, str(b)[:100])
check("calibrated pricing present (pickup min 2200)", any(c["key"] == "pickup" and c["minimumFare"] == 2200 for c in b["categories"]))

CUST = login("0712000001")
ADMIN = login("0733000011")
check("customer + admin auth", bool(CUST) and bool(ADMIN))

q = call("/api/quote", "POST", {"pickup": {"name": "Gikomba Market", "lat": -1.2841, "lng": 36.8329},
                                "dropoff": {"name": "Kawangware Market", "lat": -1.2862, "lng": 36.7528},
                                "cargo": {"items": [{"name": "Bales", "qty": 2, "weightKg": 40}], "load": "SMALL"}})
check("quote + fare lines", len(q.get("quotes", [])) == 7 and len(q["quotes"][0]["fare"]["lines"]) >= 4, str(q)[:100])

s = call("/api/shipments", "POST", {"draftId": "supa-check-1",
                                    "pickup": {"name": "Gikomba Market", "lat": -1.2841, "lng": 36.8329},
                                    "dropoff": {"name": "Kawangware Market", "lat": -1.2862, "lng": 36.7528},
                                    "cargo": {"items": [{"name": "Bales", "qty": 2, "weightKg": 40}], "load": "SMALL"},
                                    "categoryKey": "tuktuk", "paymentMethod": "MPESA"}, sess=CUST)
sid = s["shipment"]["id"]
check("booking created", s["shipment"]["status"] == "PRICED")

call(f"/api/shipments/{sid}/action", "POST", {"action": "pay"}, sess=CUST)
pc = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay-confirm"}, sess=CUST)
check("M-PESA lifecycle on Postgres", pc["shipment"]["status"] == "PAYMENT_CONFIRMED")

m = call(f"/api/shipments/{sid}/action", "POST", {"action": "request"}, sess=CUST)
check("matching on Postgres", m.get("matched") is True, str(m)[:120])

drivers = call("/api/admin?tab=drivers", sess=ADMIN)["drivers"]
drv = next((x for x in drivers if x["id"] == m["shipment"]["driver"]["id"]), None)
check("assigned driver resolvable", drv is not None)
DRV = login(drv["phone"])

acc = call(f"/api/shipments/{sid}/action", "POST", {"action": "driver-accept"}, sess=DRV)
check("driver accepted", acc["shipment"]["status"] == "DRIVER_EN_ROUTE")

sa = call(f"/api/shipments/{sid}/action", "POST", {"action": "safety-alert"}, sess=CUST)
check("safety alert (event + DTO)", any(e["type"] == "SAFETY_ALERT" for e in sa["shipment"]["events"]) and sa["shipment"]["safety"]["open"])
adm = call("/api/admin?tab=overview", sess=ADMIN)
check("admin safety queue", any(a["shipmentId"] == sid and not a["resolved"] for a in adm.get("safetyAlerts", [])))
ck = call(f"/api/shipments/{sid}/action", "POST", {"action": "safety-ack"}, sess=ADMIN)
check("ops ack resolves", ck["shipment"]["safety"]["acked"] is True)

q3 = call(f"/api/shipments/{sid}/action", "POST", {"action": "cancel-quote"}, sess=CUST)
check("cancel-quote in grace window (free)", q3.get("quote", {}).get("free") is True, str(q3)[:120])
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "cancel", "reason": "production check complete"}, sess=CUST)
check("cancel + refund", r["shipment"]["status"] == "CANCELLED" and r["shipment"]["payment"]["status"] == "REFUNDED")

print(f"RESULT: {PASS} passed, {len(FAIL)} failed" + (f" — {FAIL}" if FAIL else " — SUPABASE PRODUCTION PATH VERIFIED"))
exit(1 if FAIL else 0)
