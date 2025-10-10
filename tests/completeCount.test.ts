import { db } from "@/lib/db";
import { get_count_complete_legislation } from "@/lib/stats";

// Helper to call the unified SQL function with minimal filters and get total_count
async function fetchSqlCount(): Promise<number> {
  // Select only total_count; include correct parameter placeholders (offset, limit, then 9 NULL filter params, then sort field & dir)
  const rows = await db.$queryRawUnsafe<
    Array<{ total_count: number | string | bigint }>
  >(
    `SELECT total_count FROM get_bills_and_orders($1::int,$2::int, NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'introducedDate','desc') LIMIT 1`,
    0,
    1
  );
  if (!rows.length) return 0;
  return Number(rows[0].total_count) || 0;
}

describe("get_count_complete_legislation alignment", () => {
  it("matches total_count from get_bills_and_orders SQL function (completeness criteria)", async () => {
    const [sqlCount, fnCount] = await Promise.all([
      fetchSqlCount(),
      get_count_complete_legislation(),
    ]);

    expect(fnCount).toBe(sqlCount);
  });
});

afterAll(async () => {
  await db.$disconnect();
});
