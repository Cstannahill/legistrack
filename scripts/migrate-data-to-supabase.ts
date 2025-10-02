// Script to migrate data from local PostgreSQL to Supabase
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

async function migrateData() {
  console.log("\n🚀 Starting data migration from local dev to Supabase...\n");

  try {
    // 1. Migrate Bills
    console.log("📋 Migrating Bills...");
    const bills = await localDb.bill.findMany();
    console.log(`   Found ${bills.length} bills to migrate`);

    let billsCreated = 0;
    for (const bill of bills) {
      const existing = await supabaseDb.bill.findUnique({
        where: { id: bill.id },
      });

      if (!existing) {
        await supabaseDb.bill.create({
          data: bill,
        });
        billsCreated++;
      }
    }
    console.log(
      `   ✅ Created ${billsCreated} bills (${
        bills.length - billsCreated
      } already existed)\n`
    );

    // 2. Migrate Executive Orders
    console.log("📜 Migrating Executive Orders...");
    const executiveOrders = await localDb.executiveOrder.findMany();
    console.log(
      `   Found ${executiveOrders.length} executive orders to migrate`
    );

    let eosCreated = 0;
    for (const eo of executiveOrders) {
      const existing = await supabaseDb.executiveOrder.findUnique({
        where: { id: eo.id },
      });

      if (!existing) {
        await supabaseDb.executiveOrder.create({
          data: eo,
        });
        eosCreated++;
      }
    }
    console.log(
      `   ✅ Created ${eosCreated} executive orders (${
        executiveOrders.length - eosCreated
      } already existed)\n`
    );

    // 3. Migrate Categories
    console.log("🏷️  Migrating Categories...");
    const categories = await localDb.category.findMany();
    console.log(`   Found ${categories.length} categories to migrate`);

    let categoriesCreated = 0;
    for (const category of categories) {
      const existing = await supabaseDb.category.findUnique({
        where: { id: category.id },
      });

      if (!existing) {
        await supabaseDb.category.create({
          data: category,
        });
        categoriesCreated++;
      }
    }
    console.log(
      `   ✅ Created ${categoriesCreated} categories (${
        categories.length - categoriesCreated
      } already existed)\n`
    );

    // 4. Migrate Summaries
    console.log("📝 Migrating Summaries...");
    const summaries = await localDb.summary.findMany();
    console.log(`   Found ${summaries.length} summaries to migrate`);

    let summariesCreated = 0;
    for (const summary of summaries) {
      const existing = await supabaseDb.summary.findUnique({
        where: { id: summary.id },
      });

      if (!existing) {
        await supabaseDb.summary.create({
          data: summary,
        });
        summariesCreated++;
      }
    }
    console.log(
      `   ✅ Created ${summariesCreated} summaries (${
        summaries.length - summariesCreated
      } already existed)\n`
    );

    // 5. Migrate Companion Bills
    console.log("🤝 Migrating Companion Bill relationships...");
    const companionBills = await localDb.companionBill.findMany();
    console.log(
      `   Found ${companionBills.length} companion bill relationships to migrate`
    );

    let companionBillsCreated = 0;
    for (const companion of companionBills) {
      const existing = await supabaseDb.companionBill.findUnique({
        where: { id: companion.id },
      });

      if (!existing) {
        await supabaseDb.companionBill.create({
          data: companion,
        });
        companionBillsCreated++;
      }
    }
    console.log(
      `   ✅ Created ${companionBillsCreated} companion bill relationships (${
        companionBills.length - companionBillsCreated
      } already existed)\n`
    );

    // Summary
    console.log("\n✨ Migration Summary:");
    console.log(`   📋 Bills: ${billsCreated} created`);
    console.log(`   📜 Executive Orders: ${eosCreated} created`);
    console.log(`   🏷️  Categories: ${categoriesCreated} created`);
    console.log(`   📝 Summaries: ${summariesCreated} created`);
    console.log(`   🤝 Companion Bills: ${companionBillsCreated} created`);
    console.log("\n✅ Data migration completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await localDb.$disconnect();
    await supabaseDb.$disconnect();
  }
}

migrateData();
