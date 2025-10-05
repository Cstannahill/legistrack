// Script to migrate data from local PostgreSQL to Supabase
// @ts-nocheck
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

type ConnectionTarget =
  | "local"
  | "supabase (pooled)"
  | "supabase (non-pooling)";

config();

const LOCAL_DB_URL = process.env.DATABASE_URL;
const SUPABASE_PRISMA_URL = process.env.SUPABASE_POSTGRES_PRISMA_URL;
const SUPABASE_NON_POOLING_URL = process.env.SUPABASE_POSTGRES_URL_NON_POOLING;
const SUPABASE_DB_URL = SUPABASE_NON_POOLING_URL ?? SUPABASE_PRISMA_URL;
const SUPABASE_TARGET: ConnectionTarget = SUPABASE_NON_POOLING_URL
  ? "supabase (non-pooling)"
  : "supabase (pooled)";

if (!LOCAL_DB_URL) {
  throw new Error(
    "DATABASE_URL is not set. Please ensure your local database connection string is defined before running the migration."
  );
}

if (!SUPABASE_DB_URL) {
  throw new Error(
    "Supabase connection string not found. Set SUPABASE_POSTGRES_PRISMA_URL or SUPABASE_POSTGRES_URL_NON_POOLING in your environment."
  );
}

const describeConnection = (urlString: string, target: ConnectionTarget) => {
  try {
    const url = new URL(urlString);
    return `${target} → ${url.hostname}:${url.port || "5432"}`;
  } catch (error) {
    console.warn(`Unable to parse ${target} connection string`, error);
    return `${target} → (unknown host)`;
  }
};

console.log("\n🔗 Using database connections:");
console.log(`   • ${describeConnection(LOCAL_DB_URL, "local")}`);
console.log(`   • ${describeConnection(SUPABASE_DB_URL, SUPABASE_TARGET)}\n`);

if (SUPABASE_NON_POOLING_URL && SUPABASE_PRISMA_URL) {
  console.log(
    "   ℹ️  Both pooled and non-pooling Supabase URLs detected; defaulting to non-pooling for long-running migrations."
  );
} else if (!SUPABASE_NON_POOLING_URL) {
  console.log(
    "   ⚠️  Non-pooling Supabase URL not set; using pooled connection which may stall on large writes."
  );
}

// Local database connection (uses local DATABASE_URL)
const localDb = new PrismaClient({
  datasourceUrl: LOCAL_DB_URL,
});

// Supabase database connection (explicit env-based URL)
const supabaseDb = new PrismaClient({
  datasourceUrl: SUPABASE_DB_URL,
});

async function migrateData() {
  console.log("\n🚀 Starting data migration from local dev to Supabase...\n");

  try {
    // 1. Migrate Bills
    console.log("📋 Migrating Bills...");
    const bills = await localDb.bill.findMany();
    console.log(`   Found ${bills.length} bills to migrate`);

    // Map local bill id -> supabase bill id so we can resolve foreign keys later
    const billIdMap = new Map<string | number, string | number>();
    const localBillsById = new Map<string | number, unknown>(
      bills.map((b) => [b.id, b as unknown])
    );

    let billsCreated = 0;
    for (const bill of bills) {
      // First try by primary id (fast path)
      let existing = await supabaseDb.bill.findUnique({
        where: { id: bill.id },
      });

      // If no record with the same id exists in Supabase, someone may have
      // already inserted the same bill under a different id. The DB has a
      // unique constraint on (congress, billType, billNumber) so check for
      // that composite key before attempting to create.
      if (!existing) {
        existing = await supabaseDb.bill.findFirst({
          where: {
            congress: bill.congress,
            billType: bill.billType,
            billNumber: bill.billNumber,
          },
        });
      }

      if (!existing) {
        try {
          const created = await supabaseDb.bill.create({ data: bill });
          billsCreated++;
          billIdMap.set(bill.id, created.id);
        } catch (err: unknown) {
          const prismaCode =
            typeof err === "object" && err !== null && "code" in err
              ? (err as { code?: unknown }).code
              : undefined;

          if (prismaCode === "P2002") {
            // Find the conflicting supabase record by composite key and map to it
            const conflict = await supabaseDb.bill.findFirst({
              where: {
                congress: bill.congress,
                billType: bill.billType,
                billNumber: bill.billNumber,
              },
            });

            if (conflict) {
              billIdMap.set(bill.id, conflict.id);
              console.warn(
                `   ⚠️ Detected existing bill in Supabase (mapped local ${bill.id} -> supabase ${conflict.id})`
              );
              continue;
            }

            console.warn(
              `   ⚠️ Skipping bill (congress=${bill.congress}, billType=${bill.billType}, billNumber=${bill.billNumber}) due to unique constraint`
            );
            continue;
          }

          throw err;
        }
      } else {
        // existing by id or composite — map local -> supabase id
        billIdMap.set(bill.id, existing.id);
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
        // Resolve foreign keys: summary may reference billId or executiveOrderId
        const data: Record<string, unknown> = { ...summary } as Record<
          string,
          unknown
        >;

        if (summary.billId) {
          // Try mapping from the local bill id -> supabase id
          const mapped = billIdMap.get(summary.billId);
          let targetBillId = mapped;

          // If not mapped yet, attempt to find by id on Supabase
          if (!targetBillId) {
            const foundById = await supabaseDb.bill.findUnique({
              where: { id: summary.billId },
            });
            if (foundById) targetBillId = foundById.id;
          }

          // If still not found, try to find local bill metadata and search supabase by composite
          if (!targetBillId) {
            const localBill = localBillsById.get(summary.billId);
            if (localBill && typeof localBill === "object") {
              const lb = localBill as {
                congress?: number | string;
                billType?: string | null;
                billNumber?: string | null;
              };
              const foundComposite = await supabaseDb.bill.findFirst({
                where: {
                  congress:
                    typeof lb.congress === "string" ? lb.congress : lb.congress,
                  billType:
                    typeof lb.billType === "string" ? lb.billType : lb.billType,
                  billNumber:
                    typeof lb.billNumber === "string"
                      ? lb.billNumber
                      : lb.billNumber,
                },
              });
              if (foundComposite) targetBillId = foundComposite.id;
            }
          }

          if (!targetBillId) {
            console.warn(
              `   ⚠️ Skipping summary ${summary.id}: parent bill ${summary.billId} not found in Supabase`
            );
            continue;
          }

          data.billId = targetBillId;
        }

        if (summary.executiveOrderId) {
          // similar mapping for executive orders
          const eoMapped =
            typeof summary.executiveOrderId !== "undefined"
              ? summary.executiveOrderId
              : undefined;
          let targetEoId = eoMapped;

          // try direct id
          if (!targetEoId) {
            const found = await supabaseDb.executiveOrder.findUnique({
              where: { id: summary.executiveOrderId },
            });
            if (found) targetEoId = found.id;
          }

          if (!targetEoId) {
            console.warn(
              `   ⚠️ Skipping summary ${summary.id}: parent executive order ${summary.executiveOrderId} not found in Supabase`
            );
            continue;
          }

          data.executiveOrderId = targetEoId;
        }

        try {
          // Build a typed payload for create to satisfy Prisma types.
          const summaryCreateData = {
            id: summary.id,
            summaryType: summary.summaryType,
            content: summary.content,
            aiModel: summary.aiModel,
            billId: (data.billId as string) ?? null,
            executiveOrderId: (data.executiveOrderId as string) ?? null,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            // Only include source when present on the source object
            ...(summary && (summary as any).source
              ? { source: (summary as any).source }
              : {}),
          } as const;

          await supabaseDb.summary.create({ data: summaryCreateData as any });
          summariesCreated++;
        } catch (err: unknown) {
          const prismaCode =
            typeof err === "object" && err !== null && "code" in err
              ? (err as { code?: unknown }).code
              : undefined;
          if (prismaCode === "P2003") {
            console.warn(
              `   ⚠️ Skipping summary ${summary.id} due to FK violation (parent not present)`
            );
            continue;
          }
          throw err;
        }
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
