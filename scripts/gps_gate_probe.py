#!/usr/bin/env python3
"""GPS-mismatch arrival gate probe — end-to-end server validation.

Exercises the Bolt-pattern arrive/deliver GPS confirmation against a running
MIZIGO instance (sandbox/MOCK money is fine — the gate is money-independent):
  1. full lifecycle up to DRIVER_EN_ROUTE (customer pays, driver accepts)
  2. driver pings GPS ~600m from the pickup (real app-ping semantics)
  3. arrive → expect 409 GPS_MISMATCH with distanceM
  4. arrive with gpsMismatchConfirmed → expect DRIVER_ARRIVED + the
     "GPS …m away (confirmed)" timeline label
  5. deliver leg: ping far from dropoff → deliver → 409 → confirm → DELIVERED

Usage: MIZIGO_BASE=http://localhost:3100 python3 scripts/gps_gate_probe.py
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get("MIZIGO_BASE") or "http://localhost:3000"

def call(path, method="GET", body=None, sess=None):
    headers = {"Content-Type": "application/json"}
    if sess:
        headers["Cookie"] = sess
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return {"_status": 200, "_setCookie": r.headers.get("Set-Cookie") or "", **json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:
            return {"_status": e.code, **json.loads(e.read() or b"{}")}
        except Exception:
            return {"_status": e.code}

fails = []
def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        fails.append(name)

def login(phone):
    otp = call("/api/auth", "POST", {"action": "otp", "phone": phone})
    v = call("/api/auth", "POST", {"action": "verify", "phone": phone, "code": otp["devCode"]})
    assert "user" in v, f"login failed: {v}"
    return (v["_setCookie"].split(";")[0] or "").strip()

b = call("/api/bootstrap")
assert b["_status"] == 200, "bootstrap not reachable"

# demo identities only exist in seeded/sandbox environments
demo = b.get("demo")
assert demo, "no demo identities — run against a SEED_DEMO=true sandbox instance"

cust = login(demo["customer"]["phone"])
# admin demo identity carries no phone in bootstrap — the seeded number (see
# seed.ts / e2e_test.py conventions)
admin = login("0733 000 011".replace(" ", ""))

uniq = str(abs(hash("gpsprobe")) % 100000)
s1 = call("/api/shipments", "POST", {"draftId": f"gps-probe-{uniq}",
    "pickup": {"name": "GPS Probe Pickup · Industrial Area", "area": "Industrial Area", "lat": -1.308, "lng": 36.833},
    "dropoff": {"name": "GPS Probe Dropoff · Westlands", "area": "Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"category": "furniture", "items": [{"name": "Sofa", "qty": 1, "weightKg": 40}], "load": "MEDIUM", "helpers": 0},
    "categoryKey": "pickup", "paymentMethod": "MPESA"}, sess=cust)
sid = s1["shipment"]["id"]
call(f"/api/shipments/{sid}/action", "POST", {"action": "pay"}, sess=cust)
pc = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay-confirm", "pin": "1234"}, sess=cust)
check("payment confirmed (MOCK)", pc.get("shipment", {}).get("status") == "PAYMENT_CONFIRMED")

m = call(f"/api/shipments/{sid}/action", "POST", {"action": "request"}, sess=cust)
check("driver matched", m.get("matched") is True)
drv_id = m["shipment"]["driver"]["id"]
drivers = call("/api/admin?tab=drivers", sess=admin)["drivers"]
drv_phone = [d for d in drivers if d["id"] == drv_id][0]["phone"]
drv = login(drv_phone)
acc = call(f"/api/shipments/{sid}/action", "POST", {"action": "driver-accept"}, sess=drv)
check("driver accepted → EN_ROUTE", acc.get("shipment", {}).get("status") == "DRIVER_EN_ROUTE")

# ── 1) arrive with NO GPS report → gate stays open (sandbox default) ──
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "arrive"}, sess=drv)
check("arrive with no GPS report → ungated", r.get("shipment", {}).get("status") == "DRIVER_ARRIVED", str(r.get("_status")))

# back up to DRIVER_EN_ROUTE with a fresh shipment for the gated cases
# (van: Faith is online in Westlands — the first pickup driver is busy)
s2 = call("/api/shipments", "POST", {"draftId": f"gps-probe-2-{uniq}",
    "pickup": {"name": "GPS Probe Pickup 2", "area": "Industrial Area", "lat": -1.308, "lng": 36.833},
    "dropoff": {"name": "GPS Probe Dropoff 2", "area": "Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"category": "retail", "items": [{"name": "Boxes", "qty": 2, "weightKg": 10}], "load": "SMALL", "helpers": 0},
    "categoryKey": "van", "paymentMethod": "MPESA"}, sess=cust)
sid2 = s2["shipment"]["id"]
call(f"/api/shipments/{sid2}/action", "POST", {"action": "pay"}, sess=cust)
call(f"/api/shipments/{sid2}/action", "POST", {"action": "pay-confirm", "pin": "1234"}, sess=cust)
m2 = call(f"/api/shipments/{sid2}/action", "POST", {"action": "request"}, sess=cust)
check("second shipment matched", m2.get("matched") is True, json.dumps({k: v for k, v in m2.items() if k != "shipment"})[:200])
drv2_id = m2["shipment"]["driver"]["id"]
drv2_phone = [d for d in drivers if d["id"] == drv2_id][0]["phone"]
drv2 = login(drv2_phone)
ok2 = call(f"/api/shipments/{sid2}/action", "POST", {"action": "driver-accept"}, sess=drv2)
check("second driver accepted → EN_ROUTE", ok2.get("shipment", {}).get("status") == "DRIVER_EN_ROUTE",
      json.dumps({k: v for k, v in ok2.items() if k not in ("shipment", "_setCookie")})[:200])

# ── 2) ping ~600m from the pickup (0.0054° lat ≈ 600m), then arrive ──
ping = call("/api/driver/action", "POST", {"action": "ping", "lat": -1.308 + 0.0054, "lng": 36.833}, sess=drv2)
check("driver ping accepted", ping.get("ok") is True, json.dumps({k: v for k, v in ping.items() if k != "_setCookie"})[:200])

bad = call(f"/api/shipments/{sid2}/action", "POST", {"action": "arrive"}, sess=drv2)
check("arrive far from pickup → 409 GPS_MISMATCH", bad.get("_status") == 409 and bad.get("code") == "GPS_MISMATCH",
      f"status={bad.get('_status')} code={bad.get('code')}")
check("distance reported (meters)", isinstance(bad.get("distanceM"), int) and 500 <= bad["distanceM"] <= 700, str(bad.get("distanceM")))

ok = call(f"/api/shipments/{sid2}/action", "POST", {"action": "arrive", "gpsMismatchConfirmed": True}, sess=drv2)
check("confirmed arrive passes", ok.get("shipment", {}).get("status") == "DRIVER_ARRIVED")
detail = call(f"/api/shipments/{sid2}", sess=cust)
labels = " | ".join(e.get("label", "") for e in detail["shipment"].get("events", []))
check("timeline records the off-location confirm", "GPS" in labels and "confirmed" in labels, labels[-160:])

# ── 3) deliver leg: far from dropoff → gated, then confirmed ──
for action in ["start-loading", "loaded", "start-trip", "arriving"]:
    call(f"/api/shipments/{sid2}/action", "POST", {"action": action}, sess=drv2)
# ping far from the dropoff (dropoff -1.267, 36.801) — ~800m north
call("/api/driver/action", "POST", {"action": "ping", "lat": -1.2598, "lng": 36.801}, sess=drv2)
badd = call(f"/api/shipments/{sid2}/action", "POST", {"action": "deliver"}, sess=drv2)
check("deliver far from dropoff → 409 GPS_MISMATCH", badd.get("_status") == 409 and badd.get("code") == "GPS_MISMATCH",
      f"status={badd.get('_status')}")
okd = call(f"/api/shipments/{sid2}/action", "POST", {"action": "deliver", "gpsMismatchConfirmed": True}, sess=drv2)
check("confirmed deliver passes", okd.get("shipment", {}).get("status") == "DELIVERED")

print()
if fails:
    print(f"GPS GATE PROBE: {len(fails)} FAIL → {fails}")
    sys.exit(1)
print("GPS GATE PROBE: ALL PASS")
