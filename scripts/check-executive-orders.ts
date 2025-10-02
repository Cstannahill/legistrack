/**
 * Check executive orders in the database
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🔍 Checking executive orders in database...\n");

  const executiveOrders = await db.executiveOrder.findMany({
    orderBy: {
      orderNumber: "desc",
    },
    take: 10,
  });

  if (executiveOrders.length === 0) {
    console.log("❌ No executive orders found in database");
    return;
  }

  console.log(`✅ Found ${executiveOrders.length} executive orders:\n`);

  executiveOrders.forEach((eo) => {
    console.log(`📋 EO ${eo.orderNumber} - ${eo.executiveOrderType}`);
    console.log(`   Title: ${eo.title}`);
    console.log(`   Signed: ${eo.signingDate.toISOString().split("T")[0]}`);
    console.log(
      `   Published: ${
        eo.publicationDate?.toISOString().split("T")[0] || "N/A"
      }`
    );
    console.log(`   President: ${eo.presidentName}`);
    console.log(`   URL: ${eo.federalRegisterUrl}`);
    console.log(
      `   Full Text: ${
        eo.fullText
          ? `${Math.round(eo.fullText.length / 1000)}KB`
          : "Not fetched"
      }`
    );
    console.log("");
  });

  const count = await db.executiveOrder.count();
  console.log(`\n📊 Total executive orders in database: ${count}`);
}

main()
  .catch(console.error)
  .finally(async () => await db.$disconnect());
