#!/usr/bin/env python3
"""End-to-end API test of the MIZIGO booking lifecycle (state machine validation)."""
import json, urllib.request, sys, time

BASE = "http://localhost:3000"

def call(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, **json.loads(e.read() or b"{}")}

fails = []
def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond: fails.append(name)

# 1. bootstrap
b = call("/api/bootstrap")
check("bootstrap seeded", len(b["categories"]) == 6)

# 2. login as customer
otp = call("/api/auth", "POST", {"action": "otp", "phone": "0712000001"})
check("otp issued (mock)", "devCode" in otp, otp.get("devCode", ""))
v = call("/api/auth", "POST", {"action": "verify", "phone": "0712000001", "code": otp["devCode"]})
check("customer login", v.get("user", {}).get("name") == "John Kariuki")
uid = v["user"]["id"]

# login demo driver + find Peter
c = call("/api/customer?userId=" + uid)
check("customer home", c["user"]["name"] == "John Kariuki")
check("customer has trip history", len(c["trips"]) >= 3, f"{len(c['trips'])} trips")

# 3. quote furniture with helpers
q = call("/api/quote", "POST", {
    "pickup": {"name": "ABC Industrial Area Godown 47", "area": "Industrial Area", "lat": -1.308, "lng": 36.833},
    "dropoff": {"name": "Riverside Drive, Westlands", "area": "Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"category": "furniture", "items": [{"name": "Sofa", "qty": 2, "weightKg": 60}, {"name": "Dining table", "qty": 1, "weightKg": 45}, {"name": "Boxes", "qty": 6, "weightKg": 20}], "load": "MEDIUM", "helpers": 1, "special": ["fragile"]}})
check("quote ok", "quotes" in q)
check("pickup recommended for furniture", q["recommendedKey"] == "pickup", q["recommendedKey"])
pickup_quote = [x for x in q["quotes"] if x["key"] == "pickup"][0]
check("fare has lines", len(pickup_quote["fare"]["lines"]) >= 4)
check("loading fee applied", pickup_quote["fare"]["loading"] > 0)

# 4. create shipment (idempotent)
s1 = call("/api/shipments", "POST", {"draftId": "test-draft-1", "customerId": uid,
    "pickup": {"name": "ABC Industrial Area Godown 47", "area": "Industrial Area", "lat": -1.308, "lng": 36.833, "note": "Gate B, next to the petrol station"},
    "dropoff": {"name": "Riverside Drive, Westlands", "area": "Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"category": "furniture", "items": [{"name": "Sofa", "qty": 2, "weightKg": 60}, {"name": "Dining table", "qty": 1, "weightKg": 45}, {"name": "Boxes", "qty": 6, "weightKg": 20}], "load": "MEDIUM", "helpers": 1, "special": ["fragile"]},
    "categoryKey": "pickup", "paymentMethod": "MPESA"})
check("shipment created PRICED", s1["shipment"]["status"] == "PRICED", s1["shipment"].get("status"))
sid = s1["shipment"]["id"]
s2 = call("/api/shipments", "POST", {"draftId": "test-draft-1", "customerId": uid,
    "pickup": {"name": "ABC Industrial Area Godown 47", "lat": -1.308, "lng": 36.833},
    "dropoff": {"name": "Riverside Drive, Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"items": [], "load": "MEDIUM", "helpers": 1}, "categoryKey": "pickup"})
check("idempotent create", s2["shipment"]["id"] == sid)

# 5. cannot request before payment
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "request", "actor": "CUSTOMER"})
check("request blocked before payment", "_status" in r)

# 6. M-Pesa lifecycle
p = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay"})
check("STK push initiated", p.get("status") == "PENDING")
pc = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay-confirm", "pin": "1234"})
check("payment confirmed", len(pc.get("receipt", "")) == 10)
check("status PAYMENT_CONFIRMED", pc["shipment"]["status"] == "PAYMENT_CONFIRMED", pc["shipment"]["status"])
pc2 = call(f"/api/shipments/{sid}/action", "POST", {"action": "pay-confirm"})
check("idempotent payment", pc2.get("alreadyPaid") is True)

# 7. request vehicle → matching engine
m = call(f"/api/shipments/{sid}/action", "POST", {"action": "request", "actor": "CUSTOMER"})
check("driver matched", m.get("matched") is True, m.get("match", {}).get("name", ""))
check("status DRIVER_ASSIGNED", m["shipment"]["status"] == "DRIVER_ASSIGNED")

# 8. driver accepts
acc = call(f"/api/shipments/{sid}/action", "POST", {"action": "driver-accept", "actor": "DRIVER"})
check("driver accepted → EN_ROUTE", acc["shipment"]["status"] == "DRIVER_EN_ROUTE", acc["shipment"]["status"])
live = acc["shipment"]["live"]
check("live sim TO_PICKUP", live and live["leg"] == "TO_PICKUP" and live["etaMin"] and live["etaMin"] > 0, f"eta={live and live['etaMin']}")

# 9. illegal transition guard: driver cannot start-trip before arriving
bad = call(f"/api/shipments/{sid}/action", "POST", {"action": "start-trip", "actor": "DRIVER"})
check("illegal transition blocked", "_status" in bad)

# 10. driver flow: arrive → loading → loaded → start-trip
for action, expect in [("arrive", "DRIVER_ARRIVED"), ("start-loading", "LOADING"), ("loaded", "LOADED"), ("start-trip", "IN_TRANSIT")]:
    r = call(f"/api/shipments/{sid}/action", "POST", {"action": action, "actor": "DRIVER"})
    check(f"{action} → {expect}", r.get("shipment", {}).get("status") == expect, r.get("error", ""))

# live sim now TO_DROPOFF
d = call(f"/api/shipments/{sid}")
check("live sim TO_DROPOFF", d["shipment"]["live"]["leg"] == "TO_DROPOFF")

# 11. arriving → deliver → pod → complete
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "arriving", "actor": "DRIVER"})
check("arriving", r["shipment"]["status"] == "ARRIVING")
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "deliver", "actor": "DRIVER"})
check("deliver → DELIVERED", r["shipment"]["status"] == "DELIVERED")
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "pod", "actor": "DRIVER", "recipient": "Mary Wanjiru", "otp": "8821", "photo": True})
check("POD captured", r["shipment"]["status"] == "POD_CONFIRMED" and r["shipment"]["pod"]["recipient"] == "Mary Wanjiru")

# 12. rate → completes
r = call(f"/api/shipments/{sid}/action", "POST", {"action": "rate", "actor": "CUSTOMER", "stars": 5, "tags": ["Arrived on time", "Careful with cargo"]})
check("rating → COMPLETED", r["shipment"]["status"] == "COMPLETED")
check("chain of custody events >= 10", len(r["shipment"]["events"]) >= 10, f"{len(r['shipment']['events'])} events")

# 13. driver earnings reflect the trip
drv = call("/api/driver?driverId=" + r["shipment"]["driver"]["id"])
check("driver earnings today > 0", drv["earnings"]["today"] > 0, f"KES {drv['earnings']['today']:,}")

# 14. admin overview sees the completed trip
adm = call("/api/admin?tab=overview")
check("admin KPIs", adm["kpis"]["totalDrivers"] >= 6 and "revenueToday" in adm["kpis"])

# 15. public tracking page data
tr = call(f"/api/track/{s1['shipment']['shareToken']}")
check("public tracking no phone leak", "phone" not in json.dumps(tr["tracking"]) and tr["tracking"]["code"].startswith("MZG"))

# 16. pricing edit (admin, no redeploy)
z = [zz for zz in call("/api/admin?tab=pricing")["zones"] if zz["key"] == "nairobi"][0]
r = call("/api/admin/action", "POST", {"action": "pricing-zone", "id": z["id"], "platformFee": 150})
check("pricing edit ok", r.get("zone", {}).get("platformFee") == 150)
q2 = call("/api/quote", "POST", {"pickup": {"name": "A", "lat": -1.2841, "lng": 36.8265}, "dropoff": {"name": "B", "lat": -1.2613, "lng": 36.8027}, "cargo": {"items": [], "load": "SMALL", "helpers": 0}})
check("new platform fee picked up", any(x["fare"]["platform"] == 150 for x in q2["quotes"]))
# revert
call("/api/admin/action", "POST", {"action": "pricing-zone", "id": z["id"], "platformFee": 100})

# 17. cancel flow
s3 = call("/api/shipments", "POST", {"draftId": "test-draft-cancel", "customerId": uid,
    "pickup": {"name": "Gikomba Market", "lat": -1.2841, "lng": 36.8329}, "dropoff": {"name": "Kawangware Market", "lat": -1.2862, "lng": 36.7528},
    "cargo": {"items": [{"name": "Bales", "qty": 3, "weightKg": 45}], "load": "SMALL", "helpers": 0}, "categoryKey": "tuktuk"})
r = call(f"/api/shipments/{s3['shipment']['id']}/action", "POST", {"action": "cancel", "actor": "CUSTOMER", "reason": "Changed my mind"})
check("cancel before payment ok", r["shipment"]["status"] == "CANCELLED")

print()
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURES: {fails}")
sys.exit(1 if fails else 0)
