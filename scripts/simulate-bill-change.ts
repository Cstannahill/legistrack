import "dotenv/config";
import { db } from "../src/lib/db";
import { createNotification } from "../src/lib/notifications";

async function run() {
  const billId = process.env.TEST_BILL_ID;
  if (!billId) {
    console.error("Please set TEST_BILL_ID in .env to a valid bill id");
    process.exit(1);
  }

  // simulate a status change
  const bill = await db.bill.update({
    where: { id: billId },
    data: { currentStatus: "PASSED_HOUSE", statusDate: new Date() },
  });

  // find users tracking this bill
  const trackers = await db.billTracking.findMany({ where: { billId } });

  for (const t of trackers) {
    const prefs = await db.notificationPreference.findUnique({
      where: { userId: t.userId },
    });
    const viaEmail = !!prefs?.emailNotifications;
    await createNotification(
      t.userId,
      `Bill status changed: ${bill.title}`,
      `The status for bill ${bill.title} (${bill.billType} ${bill.billNumber}) changed to ${bill.currentStatus}`,
      { billId, newStatus: bill.currentStatus },
      viaEmail
    );
  }

  console.log(`Notified ${trackers.length} trackers for bill ${billId}`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
