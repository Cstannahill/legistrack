import { db } from "./db";

export async function getLegislationCompletenessCounts() {
  // Bills: must have fullText (not null), at least one summary, and at least one category
  const totalBills = await db.bill.count();

  const billsWithoutTags = await db.bill.count({
    where: {
      categories: { none: {} },
    },
  });

  // Count bills without a STANDARD summary (matches completeness scripts)
  const billsWithoutSummaries = await db.bill.count({
    where: {
      summaries: { none: { summaryType: "STANDARD" } },
    },
  });

  const billsWithoutFullText = await db.bill.count({
    where: {
      fullText: null,
    },
  });

  const billsComplete = await db.bill.count({
    where: {
      AND: [
        { fullText: { not: null } },
        { summaries: { some: { summaryType: "STANDARD" } } },
        { categories: { some: {} } },
      ],
    },
  });

  // Executive Orders: same completeness rules but on executiveOrder model
  const totalEOs = await db.executiveOrder.count();

  const eosWithoutTags = await db.executiveOrder.count({
    where: { categories: { none: {} } },
  });

  const eosWithoutSummaries = await db.executiveOrder.count({
    where: { summaries: { none: { summaryType: "STANDARD" } } },
  });

  const eosWithoutFullText = await db.executiveOrder.count({
    where: { fullText: null },
  });

  const eosComplete = await db.executiveOrder.count({
    where: {
      AND: [
        { fullText: { not: null } },
        { summaries: { some: { summaryType: "STANDARD" } } },
        { categories: { some: {} } },
      ],
    },
  });

  const total = totalBills + totalEOs;
  const withoutTags = billsWithoutTags + eosWithoutTags;
  const withoutSummaries = billsWithoutSummaries + eosWithoutSummaries;
  const withoutFullText = billsWithoutFullText + eosWithoutFullText;
  const complete = billsComplete + eosComplete;

  return {
    total,
    withoutTags,
    withoutSummaries,
    withoutFullText,
    complete,
  };
}

// Lightweight helper that returns just the total number of "complete" pieces of legislation (Bills + Executive Orders)
// A piece is considered complete if it has: fullText (not null), at least one STANDARD summary, and at least one category.
// Mirrors the logic used in getLegislationCompletenessCounts but avoids computing intermediate counts.
export async function get_count_complete_legislation(): Promise<number> {
  const [billsComplete, eosComplete] = await Promise.all([
    db.bill.count({
      where: {
        AND: [
          { fullText: { not: null } },
          { summaries: { some: { summaryType: "STANDARD" } } },
          { categories: { some: {} } },
        ],
      },
    }),
    db.executiveOrder.count({
      where: {
        AND: [
          { fullText: { not: null } },
          { summaries: { some: { summaryType: "STANDARD" } } },
          { categories: { some: {} } },
        ],
      },
    }),
  ]);
  return billsComplete + eosComplete;
}
