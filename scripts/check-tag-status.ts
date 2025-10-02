// Quick script to check tag/category status in the database
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function checkTagStatus() {
  console.log("\n" + "=".repeat(60));
  console.log("🏷️  TAG STATUS CHECK");
  console.log("=".repeat(60) + "\n");

  try {
    // Count totals
    const [
      totalBills,
      totalCategories,
      billsWithCategories,
      totalEOs,
      eosWithCategories,
    ] = await Promise.all([
      db.bill.count(),
      db.category.count(),
      db.bill.count({ where: { categories: { some: {} } } }),
      db.executiveOrder.count(),
      db.executiveOrder.count({ where: { categories: { some: {} } } }),
    ]);

    console.log("📊 OVERALL STATS");
    console.log("-".repeat(60));
    console.log(`Total Bills: ${totalBills}`);
    console.log(`Total Categories: ${totalCategories}`);
    console.log(`Total Executive Orders: ${totalEOs}`);
    console.log();

    console.log("🏷️  TAGGING STATUS");
    console.log("-".repeat(60));
    console.log(
      `Bills with Categories: ${billsWithCategories} / ${totalBills} (${(
        (billsWithCategories / totalBills) *
        100
      ).toFixed(1)}%)`
    );
    console.log(
      `EOs with Categories: ${eosWithCategories} / ${totalEOs} (${(
        (eosWithCategories / totalEOs) *
        100
      ).toFixed(1)}%)`
    );
    console.log();

    // List categories
    console.log("📁 AVAILABLE CATEGORIES");
    console.log("-".repeat(60));
    const categories = await db.category.findMany({
      orderBy: { name: "asc" },
      select: { name: true, slug: true, color: true },
    });

    categories.forEach((cat, i) => {
      console.log(`${i + 1}. ${cat.name} (${cat.slug})`);
    });
    console.log();

    // Show sample of tagged bills
    if (billsWithCategories > 0) {
      console.log("✅ SAMPLE TAGGED BILLS");
      console.log("-".repeat(60));
      const sampleBills = await db.bill.findMany({
        where: { categories: { some: {} } },
        take: 5,
        include: {
          categories: {
            select: { name: true },
          },
        },
      });

      sampleBills.forEach((bill) => {
        const billId = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
        const cats = bill.categories.map((c) => c.name).join(", ");
        console.log(`${billId}: ${cats}`);
        console.log(`  "${bill.title.slice(0, 80)}..."`);
        console.log();
      });
    } else {
      console.log("⚠️  NO TAGGED BILLS FOUND");
      console.log("-".repeat(60));
      console.log("You need to run one of the following to add tags:\n");
      console.log("Option 1: AI Tagging (Recommended)");
      console.log("  npm run tag-legislation");
      console.log("  or: npx tsx scripts/tag-legislation.ts\n");
      console.log("Option 2: Migrate from Local DB");
      console.log("  npx tsx scripts/migrate-bill-categories.ts\n");
    }

    // Show sample of untagged bills
    if (billsWithCategories < totalBills) {
      console.log("🔖 SAMPLE UNTAGGED BILLS");
      console.log("-".repeat(60));
      const untaggedBills = await db.bill.findMany({
        where: { categories: { none: {} } },
        take: 5,
        select: {
          billType: true,
          billNumber: true,
          title: true,
        },
      });

      untaggedBills.forEach((bill) => {
        const billId = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
        console.log(`${billId}: ${bill.title.slice(0, 80)}...`);
      });
      console.log();
    }

    // Category distribution
    if (billsWithCategories > 0) {
      console.log("📈 CATEGORY DISTRIBUTION");
      console.log("-".repeat(60));

      const categoryStats = await Promise.all(
        categories.map(async (cat) => {
          const count = await db.bill.count({
            where: { categories: { some: { slug: cat.slug } } },
          });
          return { name: cat.name, count };
        })
      );

      categoryStats
        .sort((a, b) => b.count - a.count)
        .forEach((stat) => {
          if (stat.count > 0) {
            const bar = "█".repeat(Math.ceil(stat.count / 5));
            console.log(`${stat.name.padEnd(30)} ${bar} ${stat.count}`);
          }
        });
      console.log();
    }

    console.log("=".repeat(60));
    if (billsWithCategories === totalBills && eosWithCategories === totalEOs) {
      console.log("✅ ALL LEGISLATION IS TAGGED!");
    } else {
      const remaining =
        totalBills + totalEOs - (billsWithCategories + eosWithCategories);
      console.log(`⚠️  ${remaining} items still need tagging`);
    }
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await db.$disconnect();
  }
}

checkTagStatus();
