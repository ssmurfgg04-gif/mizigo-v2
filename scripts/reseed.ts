// Dev utility: wipe + reseed the database with fresh demo data.
// Run: bunx bun run scripts/reseed.ts   (from /home/z/my-project)
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // wipe
  await db.$transaction([
    db.shipmentEvent.deleteMany(), db.shipmentItem.deleteMany(), db.quote.deleteMany(), db.chatMessage.deleteMany(),
    db.paymentEvent.deleteMany(), db.rating.deleteMany(), db.dispute.deleteMany(),
    db.payout.deleteMany(), db.notification.deleteMany(), db.savedPlace.deleteMany(),
    db.auditLog.deleteMany(), db.shipment.deleteMany(), db.vehicle.deleteMany(),
    db.driver.deleteMany(), db.user.deleteMany(), db.vehicleCategory.deleteMany(),
    db.pricingZone.deleteMany(), db.place.deleteMany(), db.promoCode.deleteMany(), db.platformSetting.deleteMany(),
  ]);
  console.log("wiped");
  // trigger reseed through the app
  const res = await fetch("http://localhost:3000/api/bootstrap");
  const data = await res.json();
  if (data?.error) {
    console.error("reseed failed:", data.error);
    process.exit(1);
  }
  const counts = {
    categories: await db.vehicleCategory.count(),
    users: await db.user.count(),
    drivers: await db.driver.count(),
    shipments: await db.shipment.count(),
    promoCodes: await db.promoCode.count(),
    settings: await db.platformSetting.count(),
  };
  console.log("reseeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
