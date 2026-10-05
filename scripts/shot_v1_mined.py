#!/usr/bin/env python3
"""VLM round screenshots for the v1-mined features (return loads, driver rating,
night pricing UI, trust trio shell). Sets demo sessions via localStorage."""
import asyncio
import json
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
OUT = "/home/z/my-project/download/vlm"

CUSTOMER = {"state": {"surface": "customer", "user": {"id": "", "phone": "0712000001", "name": "John Kariuki", "role": "CUSTOMER", "accountType": "PERSONAL", "businessName": None, "avatarSeed": "john"}, "driverId": None, "customerTab": "home", "driverTab": "home", "adminTab": "overview", "lang": "en"}, "version": 0}
DRIVER = {"state": {"surface": "driver", "user": {"id": "", "phone": "0712000002", "name": "Peter Kamau", "role": "DRIVER", "accountType": "PERSONAL", "businessName": None, "avatarSeed": "peter"}, "driverId": "", "customerTab": "home", "driverTab": "home", "adminTab": "overview", "lang": "en"}, "version": 0}
ADMIN = {"state": {"surface": "admin", "user": {"id": "", "phone": "0733000011", "name": "Ops Control", "role": "ADMIN", "accountType": "PERSONAL", "businessName": None, "avatarSeed": "ops"}, "driverId": None, "customerTab": "home", "driverTab": "home", "adminTab": "overview", "lang": "en"}, "version": 0}


async def ids(page):
    """resolve demo ids from the API"""
    return await page.evaluate("""async () => {
      const otp = await (await fetch('/api/auth', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'otp',phone:'0712000001'})})).json();
      const v = await (await fetch('/api/auth', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'verify',phone:'0712000001',code:otp.devCode})})).json();
      const c = await (await fetch('/api/customer?userId=' + v.user.id)).json();
      const drv = await (await fetch('/api/driver?driverId=' + c.drivers[0].id || '/api/admin?tab=drivers')).json();
      return { customerId: v.user.id, driverId: null };
    }""")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # ── resolve ids via a scratch page ──
        scratch = await browser.new_page()
        await scratch.goto(BASE, wait_until="networkidle")
        otp = await scratch.evaluate("""async () => (await (await fetch('/api/auth', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'otp',phone:'0712000001'})})).json())""")
        v = await scratch.evaluate("""async (c) => (await (await fetch('/api/auth', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'verify',phone:'0712000001',code:c})})).json())""", otp["devCode"])
        uid = v["user"]["id"]
        home = await scratch.evaluate("""async (u) => (await (await fetch('/api/customer?userId=' + u)).json())""", uid)
        # pick a completed trip with no driver rating for the rate-customer shot
        trip = next((t for t in home["trips"] if t["status"] == "COMPLETED" and not any(r["byRole"] == "DRIVER" for r in t["ratings"])), home["trips"][0])
        adm = await scratch.evaluate("""async () => (await (await fetch('/api/admin?tab=drivers')).json())""")
        amina = next(d for d in adm["drivers"] if d["name"].startswith("Amina"))
        CUSTOMER["state"]["user"]["id"] = uid
        DRIVER["state"]["user"]["id"] = amina.get("userId", "")
        DRIVER["state"]["driverId"] = amina["id"]
        await scratch.close()

        # ── 1. customer home · deals rail (mobile) ──
        pg = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await pg.add_init_script(f"localStorage.setItem('mizigo-session', {json.dumps(json.dumps(CUSTOMER))})")
        await pg.goto(BASE + "?role=customer", wait_until="networkidle")
        await pg.wait_for_timeout(1600)
        await pg.evaluate("document.querySelector('.thin-scrollbar')?.scrollIntoView({block:'center'})")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f"{OUT}/01-customer-deals-rail.png")
        # ── 2. booking sheet open ──
        deal = pg.locator("button:has-text('Runda'), button:has-text('Karen'), button:has-text('Donholm'), button:has-text('Thika Road')").first
        await deal.click()
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=f"{OUT}/02-return-load-sheet.png")
        await pg.close()

        # ── 3. driver home · publisher (Amina) ──
        pg = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await pg.add_init_script(f"localStorage.setItem('mizigo-session', {json.dumps(json.dumps(DRIVER))})")
        await pg.goto(BASE + "?role=driver", wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        await pg.locator("button:has-text('Sell your return leg')").click()
        await pg.wait_for_timeout(500)
        await pg.locator("text=Your published legs").scroll_into_view_if_needed()
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/03-driver-publisher.png")
        await pg.close()

        # ── 4. driver trips · rate customer (Peter has the completed seed trip) ──
        peter = next(d for d in adm["drivers"] if d["name"].startswith("Peter"))
        DRIVER["state"]["driverId"] = peter["id"]
        DRIVER["state"]["user"]["id"] = peter.get("userId", "")
        pg = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await pg.add_init_script(f"localStorage.setItem('mizigo-session', {json.dumps(json.dumps(DRIVER))})")
        await pg.goto(BASE + "?role=driver", wait_until="networkidle")
        await pg.wait_for_timeout(1400)
        await pg.locator("nav button:has-text('Trips')").click()
        await pg.wait_for_timeout(900)
        await pg.locator("button:has-text('COMPLETED')").click()
        await pg.wait_for_timeout(500)
        await pg.locator("text=to work with").first.scroll_into_view_if_needed()
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/04-driver-rate-customer.png")
        await pg.close()

        # ── 5. admin overview · return-leg KPI ──
        pg = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        await pg.add_init_script(f"localStorage.setItem('mizigo-session', {json.dumps(json.dumps(ADMIN))})")
        await pg.goto(BASE + "?role=admin", wait_until="networkidle")
        await pg.wait_for_timeout(1800)
        await pg.screenshot(path=f"{OUT}/05-admin-return-kpi.png")
        await pg.close()

        # ── 6. desktop shell · trust trio ──
        pg = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        await pg.goto(BASE, wait_until="networkidle")
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f"{OUT}/06-desktop-trust-trio.png")
        await pg.close()

        # ── 7. mobile welcome (regression check) ──
        pg = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await pg.goto(BASE, wait_until="networkidle")
        await pg.wait_for_timeout(2200)
        await pg.screenshot(path=f"{OUT}/07-welcome-mobile.png")
        await pg.close()

        # ── 8. public track view via a fresh share link ──
        pg = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await pg.goto(BASE, wait_until="domcontentloaded")
        link = await pg.evaluate("""async (sid) => (await (await fetch('/api/shipments/' + sid + '/action', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'share-link',actor:'CUSTOMER'})})).json())""", trip["id"])
        await pg.goto(BASE + "/?view=track&token=" + link["token"], wait_until="networkidle")
        await pg.wait_for_timeout(1800)
        await pg.screenshot(path=f"{OUT}/08-public-track.png")
        await pg.close()

        await browser.close()
        print("shots done →", OUT)


asyncio.run(main())
