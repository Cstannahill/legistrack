/**
 * Delete test executive orders
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🗑️  Deleting test executive orders...\n");

  const result = await db.executiveOrder.deleteMany({
    where: {
      orderNumber: {
        in: [14350, 14351, 14352],
      },
    },
  });

  console.log(`✅ Deleted ${result.count} executive orders`);
}

main()
  .catch(console.error)
  .finally(async () => await db.$disconnect());
