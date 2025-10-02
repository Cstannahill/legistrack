// Script to migrate bill-category relationships from local to Supabase
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

// Local database connection
const localDb = new PrismaClient({
  datasourceUrl:
    "postgresql://ctan-dev:constResolveLogin1!@localhost:5432/legislation_tracker",
});

// Supabase database connection (uses current env)
const supabaseDb = new PrismaClient();

async function migrateBillCategories() {
  console.log(
    "\n🏷️  Migrating Bill-Category relationships from local to Supabase...\n"
  );

  try {
    // 1. Get all bills with their categories from local DB
    console.log("📋 Fetching bills with categories from local database...");
    const localBillsWithCategories = await localDb.bill.findMany({
      where: {
        categories: {
          some: {},
        },
      },
      include: {
        categories: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    console.log(
      `   Found ${localBillsWithCategories.length} bills with categories\n`
    );

    if (localBillsWithCategories.length === 0) {
      console.log("⚠️  No bills with categories found in local database");
      console.log(
        "   You may need to run the tagging script on your local database first\n"
      );
      return;
    }

    // 2. Get all categories from Supabase to map by slug
    console.log("🔍 Loading categories from Supabase...");
    const supabaseCategories = await supabaseDb.category.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const categoryMap = new Map(
      supabaseCategories.map((cat) => [cat.slug, cat.id])
    );
    console.log(`   Loaded ${supabaseCategories.length} categories\n`);

    // 3. Migrate the relationships
    console.log("🔗 Migrating bill-category relationships...");
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const localBill of localBillsWithCategories) {
      try {
        // Check if bill exists in Supabase
        const supabaseBill = await supabaseDb.bill.findUnique({
          where: { id: localBill.id },
          include: {
            categories: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!supabaseBill) {
          console.log(
            `   ⚠️  Bill ${localBill.billType} ${localBill.billNumber} not found in Supabase`
          );
          skipped++;
          continue;
        }

        // Check if bill already has categories
        if (supabaseBill.categories.length > 0) {
          skipped++;
          continue;
        }

        // Map local category IDs to Supabase category IDs using slugs
        const categoryIdsToConnect: string[] = [];
        for (const localCategory of localBill.categories) {
          const supabaseCategoryId = categoryMap.get(localCategory.slug);
          if (supabaseCategoryId) {
            categoryIdsToConnect.push(supabaseCategoryId);
          } else {
            console.log(
              `   ⚠️  Category "${localCategory.name}" (${localCategory.slug}) not found in Supabase`
            );
          }
        }

        if (categoryIdsToConnect.length === 0) {
          skipped++;
          continue;
        }

        // Update the bill with categories
        await supabaseDb.bill.update({
          where: { id: supabaseBill.id },
          data: {
            categories: {
              connect: categoryIdsToConnect.map((id) => ({ id })),
            },
          },
        });

        const billId = `${localBill.billType.toUpperCase()} ${
          localBill.billNumber
        }`;
        const categoryNames = localBill.categories
          .map((c) => c.name)
          .join(", ");
        console.log(`   ✅ ${billId}: ${categoryNames}`);
        updated++;
      } catch (error) {
        console.error(
          `   ❌ Error updating bill ${localBill.billType} ${localBill.billNumber}:`,
          error
        );
        errors++;
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 Migration Summary");
    console.log("=".repeat(60));
    console.log(`✅ Bills updated: ${updated}`);
    console.log(`⏭️  Bills skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📈 Total processed: ${localBillsWithCategories.length}`);
    console.log("\n✨ Migration completed!\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await localDb.$disconnect();
    await supabaseDb.$disconnect();
  }
}

// Also migrate Executive Order categories
async function migrateEOCategories() {
  console.log(
    "\n📜 Migrating Executive Order-Category relationships from local to Supabase...\n"
  );

  try {
    console.log(
      "📋 Fetching executive orders with categories from local database..."
    );
    const localEOsWithCategories = await localDb.executiveOrder.findMany({
      where: {
        categories: {
          some: {},
        },
      },
      include: {
        categories: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    console.log(
      `   Found ${localEOsWithCategories.length} executive orders with categories\n`
    );

    if (localEOsWithCategories.length === 0) {
      console.log(
        "⚠️  No executive orders with categories found in local database\n"
      );
      return;
    }

    console.log("🔍 Loading categories from Supabase...");
    const supabaseCategories = await supabaseDb.category.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const categoryMap = new Map(
      supabaseCategories.map((cat) => [cat.slug, cat.id])
    );
    console.log(`   Loaded ${supabaseCategories.length} categories\n`);

    console.log("🔗 Migrating EO-category relationships...");
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const localEO of localEOsWithCategories) {
      try {
        const supabaseEO = await supabaseDb.executiveOrder.findUnique({
          where: { id: localEO.id },
          include: {
            categories: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!supabaseEO) {
          console.log(`   ⚠️  EO ${localEO.orderNumber} not found in Supabase`);
          skipped++;
          continue;
        }

        if (supabaseEO.categories.length > 0) {
          skipped++;
          continue;
        }

        const categoryIdsToConnect: string[] = [];
        for (const localCategory of localEO.categories) {
          const supabaseCategoryId = categoryMap.get(localCategory.slug);
          if (supabaseCategoryId) {
            categoryIdsToConnect.push(supabaseCategoryId);
          }
        }

        if (categoryIdsToConnect.length === 0) {
          skipped++;
          continue;
        }

        await supabaseDb.executiveOrder.update({
          where: { id: supabaseEO.id },
          data: {
            categories: {
              connect: categoryIdsToConnect.map((id) => ({ id })),
            },
          },
        });

        const categoryNames = localEO.categories.map((c) => c.name).join(", ");
        console.log(`   ✅ EO ${localEO.orderNumber}: ${categoryNames}`);
        updated++;
      } catch (error) {
        console.error(`   ❌ Error updating EO ${localEO.orderNumber}:`, error);
        errors++;
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 EO Migration Summary");
    console.log("=".repeat(60));
    console.log(`✅ EOs updated: ${updated}`);
    console.log(`⏭️  EOs skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📈 Total processed: ${localEOsWithCategories.length}`);
    console.log("\n✨ Migration completed!\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🏷️  CATEGORY RELATIONSHIPS MIGRATION");
  console.log("=".repeat(60));

  try {
    await migrateBillCategories();
    await migrateEOCategories();

    console.log("\n✅ All migrations completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await localDb.$disconnect();
    await supabaseDb.$disconnect();
  }
}

main();
