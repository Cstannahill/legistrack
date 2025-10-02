import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({
  log: ["query"], // Log actual SQL queries
});

async function testSearchPerformance() {
  console.log("\n🔍 Testing Bill Search Performance\n");
  console.log("=".repeat(60));

  // Test 1: Simple bill number search (HR 5370-5379) - OPTIMIZED
  console.log(
    "\n📊 Test 1: Bill number range search (HR 5370-5379) - OPTIMIZED"
  );
  console.time("Query 1");
  const result1 = await db.bill.findMany({
    where: {
      AND: [
        { billType: { equals: "HR", mode: "insensitive" } },
        { billNumber: { gte: 5370, lt: 5380 } },
      ],
    },
    take: 20,
    include: {
      sponsor: {
        select: {
          fullName: true,
          party: true,
          state: true,
        },
      },
      categories: {
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
        },
      },
      summaries: {
        where: { summaryType: "BRIEF" },
        take: 1,
      },
      // Removed companionBills and companionOf for performance
    },
  });
  console.timeEnd("Query 1");
  console.log(`   Found: ${result1.length} bills`);

  // Test 2: Text search
  console.log('\n📊 Test 2: Text search ("healthcare")');
  console.time("Query 2");
  const result2 = await db.bill.findMany({
    where: {
      OR: [
        { title: { contains: "healthcare", mode: "insensitive" } },
        { officialTitle: { contains: "healthcare", mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { introducedDate: "desc" },
    include: {
      sponsor: {
        select: {
          fullName: true,
          party: true,
          state: true,
        },
      },
      categories: {
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
        },
      },
      summaries: {
        where: { summaryType: "BRIEF" },
        take: 1,
      },
    },
  });
  console.timeEnd("Query 2");
  console.log(`   Found: ${result2.length} bills`);

  // Test 3: Simple list (no search)
  console.log("\n📊 Test 3: Simple list (no search, recent bills)");
  console.time("Query 3");
  const result3 = await db.bill.findMany({
    where: {
      congress: 119,
    },
    take: 20,
    orderBy: { introducedDate: "desc" },
    include: {
      sponsor: {
        select: {
          fullName: true,
          party: true,
          state: true,
        },
      },
      categories: {
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
        },
      },
      summaries: {
        where: { summaryType: "BRIEF" },
        take: 1,
      },
    },
  });
  console.timeEnd("Query 3");
  console.log(`   Found: ${result3.length} bills`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ Performance tests complete!\n");

  await db.$disconnect();
}

testSearchPerformance();
