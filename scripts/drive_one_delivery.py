#!/usr/bin/env python3
"""Drive one booking to DELIVERED for browser verification of the rating sheet."""
import json, time, urllib.request

BASE = "http://localhost:3100"

def req(path, body=None, cookie=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("Content-Type", "application/json")
    if cookie: r.add_header("Cookie", cookie)
    try:
        resp = urllib.request.urlopen(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        raise RuntimeError(f"HTTP {e.code} on {path}: {body}") from e
    return json.loads(resp.read() or b"{}"), (resp.headers.get("Set-Cookie") or cookie or "")

def login(phone):
    r, _ = req("/api/auth", {"action": "otp", "phone": phone})
    v, c = req("/api/auth", {"action": "verify", "phone": phone, "code": r.get("devCode")})
    assert v.get("user", {}).get("phone") == phone, v
    return c

def main():
    cust = login("0712000001")
    # 1. book
    book, _ = req("/api/shipments", {
        "draftId": f"verify-rate-{int(time.time())}",
        "pickup": {"name": "Sarit Centre", "area": "Westlands", "lat": -1.2617, "lng": 36.8028},
        "dropoff": {"name": "Yaya Centre", "area": "Kilimani", "lat": -1.2921, "lng": 36.7841},
        "cargo": {"category": "household", "load": "SMALL", "helpers": 0, "items": [{"name": "Boxes", "qty": 4, "weightKg": 30}]},
        "categoryKey": "van", "paymentMethod": "mpesa",
    }, cookie=cust)
    shp = book.get("shipment") or book
    sid, code = shp["id"], shp["code"]
    print("booked:", code, sid)
    # 2. pay (STK sim)
    a, _ = req(f"/api/shipments/{sid}/action", {"action": "pay"}, cookie=cust)
    print("pay:", a.get("status") or a)
    a, _ = req(f"/api/shipments/{sid}/action", {"action": "pay-confirm", "pin": "1234"}, cookie=cust)
    print("pay-confirm:", a.get("status") or a)
    # 3. request a vehicle (matchDriver assigns), then the driver accepts
    m, _ = req(f"/api/shipments/{sid}/action", {"action": "request"}, cookie=cust)
    drv_id = ((m.get("shipment") or {}).get("driver") or {}).get("id")
    if not m.get("matched") or not drv_id:
        print("NO MATCH:", json.dumps(m)[:200]); return
    print("matched:", m.get("matched"), "| driver id:", drv_id)
    # resolve the driver's phone via the admin console (seeded drivers only)
    ra, _ = req("/api/auth", {"action": "otp", "phone": "0733000011"})
    va, ca = req("/api/auth", {"action": "verify", "phone": "0733000011", "code": ra.get("devCode")})
    drivers, _ = req("/api/admin?tab=drivers", cookie=ca)
    dphone = [x["phone"] for x in drivers.get("drivers", []) if x["id"] == drv_id][0]
    drv = login(dphone)
    d, _ = req(f"/api/shipments/{sid}/action", {"action": "driver-accept"}, cookie=drv)
    print("driver accept:", ((d.get("shipment") or d).get("status")) or d)
    # 4. poll until DELIVERED (sandbox sim auto-advances on GET)
    for i in range(60):
        s, _ = req(f"/api/shipments/{sid}?demo=auto", cookie=cust)
        s = s.get("shipment") if isinstance(s.get("shipment"), dict) else s
        st = s.get("status")
        if i % 6 == 0: print("  state:", st)
        if st in ("DELIVERED", "POD_CONFIRMED", "COMPLETED"):
            print(f"{st} ✓  shipment:", code)
            return
        if st in ("CANCELLED", "DISPUTED", "NO_DRIVERS"):
            print("UNEXPECTED:", st); return
        time.sleep(3)
    print("timeout — last state:", st)

if __name__ == "__main__":
    main()
