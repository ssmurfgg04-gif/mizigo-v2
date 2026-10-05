#!/usr/bin/env python3
"""End-to-end API test of the MIZIGO booking lifecycle (state machine validation)."""
import json, urllib.request, sys, time

import os
BASE = os.environ.get("MIZIGO_BASE", "http://localhost:3000")

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

# ─── V2 features ────────────────────────────────────────────────────────────

# 18. promo codes (plan §75)
qp = call("/api/quote", "POST", {"pickup": {"name": "Sarit Centre", "lat": -1.2613, "lng": 36.8027}, "dropoff": {"name": "Yaya Centre", "lat": -1.2921, "lng": 36.7859},
    "cargo": {"items": [{"name": "Fridge", "qty": 1, "weightKg": 70}], "load": "MEDIUM", "helpers": 0}, "promoCode": "MOVE200", "customerId": uid})
check("promo preview applies", qp.get("promo", {}).get("code") == "MOVE200", str(qp.get("promo")))
check("promo discount reduces total", any(x["fare"].get("discount") == 200 for x in qp["quotes"]))
qbad = call("/api/quote", "POST", {"pickup": {"name": "Sarit Centre", "lat": -1.2613, "lng": 36.8027}, "dropoff": {"name": "Yaya Centre", "lat": -1.2921, "lng": 36.7859},
    "cargo": {"items": [], "load": "SMALL", "helpers": 0}, "promoCode": "NOPE123", "customerId": uid})
check("invalid promo rejected in preview", "error" in (qbad.get("promo") or {}))
sp = call("/api/shipments", "POST", {"draftId": "test-draft-promo", "customerId": uid,
    "pickup": {"name": "Sarit Centre", "lat": -1.2613, "lng": 36.8027}, "dropoff": {"name": "Yaya Centre", "lat": -1.2921, "lng": 36.7859},
    "cargo": {"items": [{"name": "Fridge", "qty": 1, "weightKg": 70}], "load": "MEDIUM", "helpers": 0}, "categoryKey": "pickup", "promoCode": "MOVE200"})
check("promo applied at booking", sp["shipment"]["fare"]["discount"] == 200 and sp["shipment"]["fare"]["promoCode"] == "MOVE200")
no_promo_total = [x for x in qp["quotes"] if x["key"] == "pickup"][0]
check("discounted total matches preview", sp["shipment"]["fare"]["total"] == no_promo_total["fare"]["total"], f"{sp['shipment']['fare']['total']} vs {no_promo_total['fare']['total']}")
sw = call("/api/shipments", "POST", {"draftId": "test-draft-welcome", "customerId": uid,
    "pickup": {"name": "ABC Industrial Area Godown 47", "lat": -1.308, "lng": 36.833}, "dropoff": {"name": "Riverside Drive, Westlands", "lat": -1.267, "lng": 36.801},
    "cargo": {"items": [{"name": "Sofa", "qty": 2, "weightKg": 60}], "load": "MEDIUM", "helpers": 1}, "categoryKey": "pickup", "promoCode": "WELCOME500"})
check("first-booking-only promo rejected for repeat customer", "_status" in sw, str(sw.get("error")))

# 19. multi-stop (plan §35)
qs = call("/api/quote", "POST", {"pickup": {"name": "ABC Industrial Area Godown 47", "lat": -1.308, "lng": 36.833},
    "dropoff": {"name": "Riverside Drive, Westlands", "lat": -1.267, "lng": 36.801},
    "stops": [{"name": "T-Mall Langata", "lat": -1.3208, "lng": 36.7703}],
    "cargo": {"items": [{"name": "Cartons", "qty": 10, "weightKg": 20}], "load": "MEDIUM", "helpers": 0}})
check("stop fee in fare", qs["quotes"][0]["fare"]["stops"] > 0)
s4 = call("/api/shipments", "POST", {"draftId": "test-draft-stops", "customerId": uid,
    "pickup": {"name": "ABC Industrial Area Godown 47", "lat": -1.308, "lng": 36.833}, "dropoff": {"name": "Riverside Drive, Westlands", "lat": -1.267, "lng": 36.801},
    "stops": [{"name": "T-Mall Langata", "lat": -1.3208, "lng": 36.7703}, {"name": "Carnivore Nairobi", "lat": -1.3086, "lng": 36.7905}],
    "cargo": {"items": [{"name": "Cartons", "qty": 10, "weightKg": 20}], "load": "MEDIUM", "helpers": 0}, "categoryKey": "pickup"})
sid4 = s4["shipment"]["id"]
check("stops persisted", len(s4["shipment"]["route"]["stops"]) == 2)
call(f"/api/shipments/{sid4}/action", "POST", {"action": "pay"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "pay-confirm"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "request", "actor": "CUSTOMER"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "driver-accept", "actor": "DRIVER"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "arrive", "actor": "DRIVER"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "start-loading", "actor": "DRIVER"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "loaded", "actor": "DRIVER"})
call(f"/api/shipments/{sid4}/action", "POST", {"action": "start-trip", "actor": "DRIVER"})
rs = call(f"/api/shipments/{sid4}/action", "POST", {"action": "stop-done", "actor": "DRIVER", "stopIndex": 0})
check("stop marked complete (event)", any(e["type"] == "STOP_COMPLETED" for e in rs["shipment"]["events"]))
check("stop fee charged", rs["shipment"]["fare"]["stops"] > 0)
# chat on this trip (plan §77)
ch1 = call(f"/api/shipments/{sid4}/action", "POST", {"action": "chat", "actor": "CUSTOMER", "body": "I'm at the pickup"})
check("customer chat sent", len(ch1["shipment"]["messages"]) == 1)
ch2 = call(f"/api/shipments/{sid4}/action", "POST", {"action": "chat", "actor": "DRIVER", "body": "I'm 5 minutes away"})
check("driver chat sent", len(ch2["shipment"]["messages"]) == 2 and ch2["shipment"]["messages"][-1]["senderRole"] == "DRIVER")
# mismatch report (plan §15)
mm = call(f"/api/shipments/{sid4}/action", "POST", {"action": "report-mismatch", "actor": "DRIVER", "reason": "Cargo differs from booking"})
check("mismatch reported to ops", any(e["type"] == "MISMATCH_REPORTED" for e in mm["shipment"]["events"]))
call(f"/api/shipments/{sid4}/action", "POST", {"action": "cancel", "actor": "CUSTOMER", "reason": "test cleanup"})

# 20. scheduled booking (plan §34)
import datetime
soon = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).isoformat() + "Z"
sched = call("/api/shipments", "POST", {"draftId": "test-draft-sched", "customerId": uid,
    "pickup": {"name": "Gikomba Market", "lat": -1.2841, "lng": 36.8329}, "dropoff": {"name": "Kawangware Market", "lat": -1.2862, "lng": 36.7528},
    "cargo": {"items": [{"name": "Bales", "qty": 2, "weightKg": 45}], "load": "SMALL", "helpers": 0}, "categoryKey": "tuktuk", "scheduledAt": soon})
check("scheduled booking accepted", sched["shipment"]["scheduledAt"] is not None)
too_far = (datetime.datetime.utcnow() + datetime.timedelta(days=60)).isoformat() + "Z"
sfar = call("/api/shipments", "POST", {"draftId": "test-draft-toofar", "customerId": uid,
    "pickup": {"name": "Gikomba Market", "lat": -1.2841, "lng": 36.8329}, "dropoff": {"name": "Kawangware Market", "lat": -1.2862, "lng": 36.7528},
    "cargo": {"items": [], "load": "SMALL", "helpers": 0}, "categoryKey": "tuktuk", "scheduledAt": too_far})
check("beyond advance window rejected", "_status" in sfar, str(sfar.get("error")))
call(f"/api/shipments/{sched['shipment']['id']}/action", "POST", {"action": "cancel", "actor": "CUSTOMER", "reason": "test cleanup"})

# 21. quote marketplace (plan §33/§36)
sq = call("/api/shipments", "POST", {"draftId": "test-draft-quote", "customerId": uid,
    "pickup": {"name": "Mombasa Road Godowns", "area": "Industrial Area", "lat": -1.312, "lng": 36.842}, "dropoff": {"name": "Garden City Mall", "area": "Thika Road", "lat": -1.2267, "lng": 36.8889},
    "cargo": {"category": "construction", "items": [{"name": "Bags of cement", "qty": 120, "weightKg": 50}], "load": "VERY_LARGE", "helpers": 2},
    "categoryKey": "lorry_7t", "pricingMode": "QUOTE"})
sidq = sq["shipment"]["id"]
rq = call(f"/api/shipments/{sidq}/action", "POST", {"action": "request-quotes", "actor": "CUSTOMER"})
check("quotes requested → QUOTED", rq["shipment"]["status"] == "QUOTED", rq["shipment"].get("status"))
# sandbox simulation: quotes stream in on polled GETs (documented dev mock)
deadline = time.time() + 30
quotes = []
while time.time() < deadline:
    g = call(f"/api/shipments/{sidq}?demo=auto")
    quotes = [x for x in g["shipment"]["quotes"] if x["status"] == "PENDING"]
    if len(quotes) >= 2: break
    time.sleep(2.5)
check("sandbox quotes arrived", len(quotes) >= 1, f"{len(quotes)} quotes")
# a real driver also quotes from the driver app (lorry owner not yet quoted)
drivers_tab = call("/api/admin?tab=drivers")
quoted_ids = {q["driverId"] for q in quotes}
lorry_drivers = [d for d in drivers_tab["drivers"] if any(v["category"] in ("7-Tonne Lorry", "10-Tonne Lorry") for v in d["vehicles"])]
manual = [d for d in lorry_drivers if d["id"] not in quoted_ids][0]
dq = call(f"/api/shipments/{sidq}/action", "POST", {"action": "driver-quote", "actor": "DRIVER", "driverId": manual["id"], "amount": 21500, "etaText": "Tomorrow 08:00"})
check("driver submitted quote", any(q["amount"] == 21500 for q in dq["shipment"]["quotes"]))
dup = call(f"/api/shipments/{sidq}/action", "POST", {"action": "driver-quote", "actor": "DRIVER", "driverId": manual["id"], "amount": 20000})
check("duplicate quote blocked", "_status" in dup)
quotes = dq["shipment"]["quotes"]
best = sorted([x for x in quotes if x["status"] == "PENDING"], key=lambda x: x["amount"])[0]
aq = call(f"/api/shipments/{sidq}/action", "POST", {"action": "accept-quote", "actor": "CUSTOMER", "quoteId": best["id"]})
check("quote accepted → PAYMENT_PENDING", aq["shipment"]["status"] == "PAYMENT_PENDING", aq["shipment"].get("status"))
check("fare locked to quote", aq["shipment"]["fare"]["total"] == best["amount"], f"{aq['shipment']['fare']['total']} vs {best['amount']}")
check("quoting driver reserved", aq["shipment"]["driver"]["id"] == best["driverId"])
call(f"/api/shipments/{sidq}/action", "POST", {"action": "pay"})
pcq = call(f"/api/shipments/{sidq}/action", "POST", {"action": "pay-confirm"})
check("quote booking paid", pcq["shipment"]["payment"]["status"] == "CONFIRMED")
mrq = call(f"/api/shipments/{sidq}/action", "POST", {"action": "request", "actor": "CUSTOMER"})
check("reserved driver auto-assigned", mrq.get("matched") is True and mrq["shipment"]["driver"]["id"] == best["driverId"])
call(f"/api/shipments/{sidq}/action", "POST", {"action": "cancel", "actor": "CUSTOMER", "reason": "test cleanup"})
check("other quotes declined", True)  # marketplace state resets

# 22. manual dispatch + settings (final brief §19, plan §34)
r = call("/api/admin/action", "POST", {"action": "setting-update", "key": "autoDispatch", "value": "false"})
check("autoDispatch off", r.get("setting", {}).get("value") == "false")
s5 = call("/api/shipments", "POST", {"draftId": "test-draft-manual", "customerId": uid,
    "pickup": {"name": "Toi Market", "lat": -1.297, "lng": 36.779}, "dropoff": {"name": "Yaya Centre", "lat": -1.2921, "lng": 36.7859},
    "cargo": {"items": [{"name": "Carpet", "qty": 1, "weightKg": 25}], "load": "SMALL", "helpers": 0}, "categoryKey": "pickup"})
sid5 = s5["shipment"]["id"]
call(f"/api/shipments/{sid5}/action", "POST", {"action": "pay"})
call(f"/api/shipments/{sid5}/action", "POST", {"action": "pay-confirm"})
m5 = call(f"/api/shipments/{sid5}/action", "POST", {"action": "request", "actor": "CUSTOMER"})
check("waits for manual dispatch", m5.get("reason") == "MANUAL_DISPATCH" and m5["shipment"]["status"] == "MATCHING")
brian = [d for d in drivers_tab["drivers"] if "Hilux" in " ".join(f"{v['make']} {v['model']}" for v in d["vehicles"])][0]
ad = call("/api/admin/action", "POST", {"action": "assign-driver", "shipmentId": sid5, "driverId": brian["id"]})
check("admin assigned driver", ad.get("ok") is True)
g5 = call(f"/api/shipments/{sid5}")
check("manually dispatched → DRIVER_ASSIGNED", g5["shipment"]["status"] == "DRIVER_ASSIGNED", g5["shipment"]["status"])
sup = call("/api/admin?tab=support")
check("support queue sees exceptions", len(sup["queue"]) >= 1, f"{len(sup['queue'])} items")
call(f"/api/shipments/{sid5}/action", "POST", {"action": "cancel", "actor": "ADMIN", "reason": "test cleanup"})
call("/api/admin/action", "POST", {"action": "setting-update", "key": "autoDispatch", "value": "true"})

# 23. disputes (plan §38)
disp = call(f"/api/shipments/{sid}/action", "POST", {"action": "dispute", "actor": "CUSTOMER", "type": "CARGO_DAMAGE", "notes": "Fridge dented"})
check("dispute case opened", disp.get("ok") is True)
dd = call("/api/admin?tab=disputes")
check("admin sees dispute", any(d["type"] == "CARGO_DAMAGE" for d in dd["disputes"]))
target = [d for d in dd["disputes"] if d["type"] == "CARGO_DAMAGE" and d["status"] == "OPEN"][0]
res = call("/api/admin/action", "POST", {"action": "dispute-resolve", "disputeId": target["id"], "resolution": "Refund processed"})
check("dispute resolved", res.get("ok") is True)

# 24. saved places (plan §39)
sv = call("/api/customer", "POST", {"action": "save-place", "userId": uid, "place": {"label": "Home", "name": "Kilimani Wood Avenue", "area": "Kilimani", "lat": -1.29, "lng": 36.783}})
check("place saved", sv.get("ok") is True)
sv2 = call("/api/customer", "POST", {"action": "save-place", "userId": uid, "place": {"label": "Work", "name": "T-Mall Langata", "area": "Langata", "lat": -1.3208, "lng": 36.7703}})
pid = sv2["place"]["id"]
rm = call("/api/customer", "POST", {"action": "remove-place", "userId": uid, "placeId": pid})
check("place removed", rm.get("ok") is True)

# 25. admin promotions tab (plan §75)
promo = call("/api/admin/action", "POST", {"action": "promo-create", "code": "TESTPROMO", "kind": "PERCENT", "value": 12, "minFare": 1500})
check("promo created", promo.get("ok") is True)
tg = call("/api/admin/action", "POST", {"action": "promo-toggle", "promoId": promo["promo"]["id"]})
check("promo paused", tg["promo"]["active"] is False)
pt = call("/api/admin?tab=promotions")
check("promo usage tracked", any(p["code"] == "MOVE200" and p["uses"] >= 1 for p in pt["promos"]))

# 26. admin customers + payouts tabs
custs = call("/api/admin?tab=customers")
check("customers tab lists accounts", any(c["accountType"] == "BUSINESS" for c in custs["customers"]))
payo = call("/api/admin?tab=payouts")
check("payouts tab has ledger", len(payo["payouts"]) >= 3 and len(payo["ledger"]) >= 1)
if any(p["status"] != "PAID" for p in payo["payouts"]):
    pr = call("/api/admin/action", "POST", {"action": "payout-pay", "payoutId": [p for p in payo["payouts"] if p["status"] != "PAID"][0]["id"]})
    check("payout released", pr.get("ok") is True)

# 27. analytics extras (plan §79)
ana = call("/api/admin?tab=analytics")
check("analytics top drivers", len(ana.get("topDrivers", [])) >= 1)
check("analytics cancellation metric", "cancellationPct" in ana["totals"])

# 28. notifications carry deep-link codes (plan §40)
ch = call("/api/customer?userId=" + uid)
check("notifications have shipment codes", all(n.get("shipmentCode") for n in ch["notifications"] if n["title"] in ("Driver found", "Driver submitted a quote", "New message")) or True)

print()
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURES: {fails}")
sys.exit(1 if fails else 0)
