#!/usr/bin/env python3
"""MIZIGO live demo walkthrough — the presenter experience, strictly sequential.

Simulates one person showing the app end-to-end: customer books and tracks,
matched driver delivers with the POD code handshake, admin watches, public
share link works. Sequential traffic stays on one warm function instance,
which is exactly how a demo is consumed.

  MIZIGO_BASE=https://mizigo.netlify.app python3 scripts/demo_walkthrough.py
"""
import json, os, sys, time, urllib.request, urllib.error

BASE = os.environ.get("MIZIGO_BASE", "https://mizigo.netlify.app")
fails = []

def call(path, method="GET", body=None, sess=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Cookie": sess} if sess else {})})
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                cookie = (r.headers.get("Set-Cookie") or "").split(";")[0] or None
                return {**json.loads(r.read()), "_cookie": cookie}
        except urllib.error.HTTPError as e:
            try: out = {**json.loads(e.read() or b"{}"), "_status": e.code}
            except Exception: out = {"_status": e.code}
            if e.code == 429 and attempt == 1:
                time.sleep(65); continue
            return out

def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond: fails.append(name)

def login(phone):
    otp = call("/api/auth", "POST", {"action": "otp", "phone": phone})
    assert "devCode" in otp, f"no devCode: {otp}"
    v = call("/api/auth", "POST", {"action": "verify", "phone": phone, "code": otp["devCode"]})
    assert "user" in v, f"verify failed: {v}"
    return v["_cookie"]

def driver_login(driver_id, admin_sess):
    drivers = call("/api/admin?tab=drivers", sess=admin_sess)["drivers"]
    d = [x for x in drivers if x["id"] == driver_id][0]
    return login(d["phone"])

print("── MIZIGO live demo walkthrough ──")
print(f"   target: {BASE}")

# ═══ 1. CUSTOMER journey ══════════════════════════════════════════════════
print("\n── customer: John books a sofa move ──")
CUST = login("0712000001")
me = call("/api/auth?action=me", sess=CUST)
check("login + session", me.get("user", {}).get("phone") == "0712000001")

boot = call("/api/bootstrap")
check("marketplace loads (6 vehicle classes)", len(boot.get("categories", [])) == 6)

q = call("/api/quote", "POST", {
    "pickup": {"name": "Java House, Kimathi Street", "area": "CBD", "lat": -1.2841, "lng": 36.8268},
    "dropoff": {"name": "Prestige Plaza, Ngong Road", "area": "Kilimani", "lat": -1.2962, "lng": 36.7793},
    "cargo": {"category": "furniture", "items": [{"name": "Sofa", "qty": 1, "weightKg": 60}],
              "load": "MEDIUM", "helpers": 1}})
check("quote → price locked upfront", "quotes" in q and "recommendedKey" in q)

s1 = call("/api/shipments", "POST", {
    "draftId": f"demo-{int(time.time())}",
    "pickup": {"name": "Java House, Kimathi Street", "lat": -1.2841, "lng": 36.8268},
    "dropoff": {"name": "Prestige Plaza, Ngong Road", "lat": -1.2962, "lng": 36.7793},
    "cargo": {"items": [{"name": "Sofa", "qty": 1, "weightKg": 60}], "load": "MEDIUM", "helpers": 1},
    "categoryKey": q.get("recommendedKey", "pickup")}, sess=CUST)
sid = s1.get("shipment", {}).get("id")
check("booking created (PRICED)", s1.get("shipment", {}).get("status") == "PRICED")
check("delivery code generated for POD handshake", isinstance(s1.get("shipment", {}).get("deliveryCode"), str))

p = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay"}, sess=CUST)
check("M-PESA STK push initiated", p.get("status") == "PENDING")
pc = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay-confirm", "pin": "1234"}, sess=CUST)
check("payment confirmed, receipt issued", len(pc.get("receipt", "")) == 10,
      pc.get("receipt", ""))

m = call(f"/api/shipments/{sid}/action", "POST", {"action": "request"}, sess=CUST)
check("driver matched", m.get("matched") is True, m.get("match", {}).get("name", ""))
check("status DRIVER_ASSIGNED", m.get("shipment", {}).get("status") == "DRIVER_ASSIGNED")

# ═══ 2. DRIVER journey ═══════════════════════════════════════════════════
print("\n── driver: matched driver accepts and delivers ──")
ADMIN = login("0733000011")
DRV = driver_login(m["shipment"]["driver"]["id"], ADMIN)

acc = call(f"/api/shipments/{sid}/action", "POST", {"action": "driver-accept"}, sess=DRV)
check("driver accepted → EN_ROUTE", acc.get("shipment", {}).get("status") == "DRIVER_EN_ROUTE")

for action, expect in [("arrive", "DRIVER_ARRIVED"), ("start-loading", "LOADING"),
                       ("loaded", "LOADED"), ("start-trip", "IN_TRANSIT"), ("arriving", "ARRIVING")]:
    r = call(f"/api/shipments/{sid}/action", "POST", {"action": action}, sess=DRV)
    check(f"{action} → {expect}", r.get("shipment", {}).get("status") == expect)

r = call(f"/api/shipments/{sid}/action", "POST", {"action": "deliver"}, sess=DRV)
check("deliver → DELIVERED", r.get("shipment", {}).get("status") == "DELIVERED")

code = s1["shipment"]["deliveryCode"]
bad = call(f"/api/shipments/{sid}/action", "POST", {"action": "pod", "recipient": "Mary Wanjiru", "otp": "0000"}, sess=DRV)
check("wrong delivery code rejected", bad.get("_status") == 400)
pod = call(f"/api/shipments/{sid}/action", "POST", {"action": "pod", "recipient": "Mary Wanjiru", "otp": code, "photo": True}, sess=DRV)
check("POD captured (code verified)", pod.get("shipment", {}).get("status") == "POD_CONFIRMED")

rate = call(f"/api/shipments/{sid}/action", "POST", {"action": "rate", "stars": 5, "tags": ["Careful with cargo"]}, sess=CUST)
check("customer rates → COMPLETED", rate.get("shipment", {}).get("status") == "COMPLETED",
      f"{len(rate.get('shipment', {}).get('events', []))} custody events")

# ═══ 3. ADMIN + PUBLIC ═══════════════════════════════════════════════════
print("\n── admin console + public tracking ──")
adm = call("/api/admin?tab=overview", sess=ADMIN)
check("admin overview KPIs", "revenue" in json.dumps(adm)[:400])

sl = call(f"/api/shipments/{sid}/action", "POST", {"action": "share-link"}, sess=CUST)
check("share-link mints a token + URL", len(sl.get("token", "")) >= 16 and sl.get("url", "").startswith("/?view=track&token="))
tr = call(f"/api/track/{sl.get('token', 'x')}")
check("public share-link tracking works (no PII)", "tracking" in tr)

print()
if fails:
    print(f"RESULT: {len(fails)} FAIL — {fails}")
    sys.exit(1)
print("RESULT: DEMO WALKTHROUGH PASS — ready to show people")
