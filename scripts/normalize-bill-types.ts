// One-time script to normalize billType to lowercase for all existing bills
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log(
    "🔄 Normalizing billType to lowercase for all existing bills...\n"
  );

  // Get all bills
  const bills = await db.bill.findMany({
    select: {
      id: true,
      billType: true,
      billNumber: true,
      congress: true,
    },
  });

  console.log(`📊 Found ${bills.length} bills to check\n`);

  let updated = 0;
  let skipped = 0;

  for (const bill of bills) {
    const normalizedType = bill.billType.toLowerCase();

    if (bill.billType !== normalizedType) {
      console.log(
        `✏️  Updating: ${bill.billType.toUpperCase()} ${
          bill.billNumber
        } → ${normalizedType}`
      );

      await db.bill.update({
        where: { id: bill.id },
        data: { billType: normalizedType },
      });

      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Migration Complete!`);
  console.log(`${"=".repeat(60)}`);
  console.log(`📝 Updated: ${updated} bills`);
  console.log(`⏭️  Skipped: ${skipped} bills (already lowercase)`);
  console.log(`📊 Total: ${bills.length} bills`);
  console.log(`${"=".repeat(60)}\n`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
