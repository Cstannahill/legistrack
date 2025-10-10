import { BillStatus } from "@prisma/client";
import { db } from "@/lib/db";

async function main() {
  const uniqueSuffix = `search-regression-${Date.now()}`;
  const introducedAt = new Date();
  const billNumber = 900000 + Math.floor(Math.random() * 1000);

  console.log("\n🔍 Running bill search regression test\n");

  const createdBill = await db.bill.create({
    data: {
      billType: "HR",
      billNumber,
      congress: 119,
      title: `${uniqueSuffix} Title`,
      officialTitle: `${uniqueSuffix} Official Title`,
      introducedDate: introducedAt,
      currentStatus: BillStatus.INTRODUCED,
      statusDate: introducedAt,
      fullText: null,
      sourceUrl: "https://example.com/search-regression",
    },
  });

  try {
    const results = await db.bill.findMany({
      where: {
        congress: 119,
        OR: [
          { title: { contains: uniqueSuffix, mode: "insensitive" } },
          { officialTitle: { contains: uniqueSuffix, mode: "insensitive" } },
        ],
      },
      take: 10,
      orderBy: { introducedDate: "desc" },
      select: {
        id: true,
        title: true,
        fullText: true,
      },
    });

    const found = results.some((bill) => bill.id === createdBill.id);

    if (!found) {
      console.error(
        "❌ Regression detected: search did not return an incomplete bill despite an active query."
      );
      console.error(
        "   Hint: ensure the search path does not filter on fullText when a query is provided."
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      "✅ Search regression test passed: search results include bills without full text when a query is present."
    );
  } finally {
    await db.bill.delete({ where: { id: createdBill.id } }).catch((error) => {
      console.warn("⚠️ Unable to delete test bill:", error);
    });

    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "❌ Search regression test failed with an unexpected error:",
    error
  );
  process.exitCode = 1;
});
