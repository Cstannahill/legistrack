import { db } from "@/lib/db";
import {
  getBooleanFlag,
  getCsvFlag,
  getNonNegativeIntFlag,
  getPositiveIntFlag,
  getStringFlag,
  loadManualEnv,
  parseCliFlags,
  runManualIngest,
  runManualSummarize,
} from "./lib/manual-pipeline";

loadManualEnv();

function printHelp() {
  console.log(`
Manual Bill & Executive Order Ingestion (CongressClient + Federal Register)

Usage:
  npx tsx scripts/manual-ingest-bills.ts [options]

Options:
  --bill=<id>            Ingest a single bill (e.g. "HR 4398" or "119-hr-4398")
  --days=<n>             Lookback days (default: INGEST_LOOKBACK_DAYS or 1)
  --congress=<n>         Target Congress number (default: TARGET_CONGRESS or 119)
  --types=<csv>          Comma-separated bill types (e.g. "hr,s")
  --start-date=<iso>     Explicit start date (YYYY-MM-DD)
  --end-date=<iso>       Explicit end date (YYYY-MM-DD)
  --limit=<n>            Cap number of discovered items to hydrate
  --include-eos          Also ingest recent presidential documents
  --eos-only             Ingest only presidential documents
  --backfill-texts=<n>   Backfill up to N bills/EOs missing fullText
  --summarize            Chain into manual summarization after ingestion
  --model=<name>         Model when --summarize is set (deepseek|gemini|glm|mimo|cascade)
  --dry-run              Preview discovered items without writing to the database
  --help                 Show this help message
`);
}

async function main() {
  const { flags } = parseCliFlags(process.argv.slice(2));
  if (getBooleanFlag(flags, "help")) {
    printHelp();
    return;
  }

  const dryRun = getBooleanFlag(flags, "dry-run");
  const bill = getStringFlag(flags, "bill");
  const congress = getPositiveIntFlag(flags, "congress");
  const lookbackDays = getPositiveIntFlag(flags, "days");
  const billTypes = getCsvFlag(flags, "types");
  const startDate = getStringFlag(flags, "start-date");
  const endDate = getStringFlag(flags, "end-date");
  const limit = getPositiveIntFlag(flags, "limit");
  const includeEos = getBooleanFlag(flags, "include-eos");
  const eosOnly = getBooleanFlag(flags, "eos-only");
  const backfillTexts = getNonNegativeIntFlag(flags, "backfill-texts");
  const shouldSummarize = getBooleanFlag(flags, "summarize");

  const result = await runManualIngest({
    bill,
    congress,
    lookbackDays,
    billTypes,
    startDate,
    endDate,
    limit,
    includeEos,
    eosOnly,
    backfillTexts,
    dryRun,
  });

  console.log("\nIngestion Summary:");
  console.log(
    `  Bills: fetched=${result.billSummary.fetched}, created=${result.billSummary.created}, updated=${result.billSummary.updated}, skipped=${result.billSummary.skipped}, failed=${result.billSummary.failed}, needsSummary=${result.billSummary.needsSummarizationCount}`
  );
  if (includeEos || eosOnly) {
    console.log(
      `  EOs:   fetched=${result.eoSummary.fetched}, created=${result.eoSummary.created}, updated=${result.eoSummary.updated}, skipped=${result.eoSummary.skipped}, failed=${result.eoSummary.failed}, needsSummary=${result.eoSummary.needsSummarizationCount}`
    );
  }

  if (shouldSummarize) {
    const model = getStringFlag(flags, "model") || process.env.AI_MODEL || "cascade";
    await runManualSummarize({
      model,
      allowFallback: getBooleanFlag(flags, "fallback"),
      bill,
      bills: getPositiveIntFlag(flags, "bills", 5),
      eos: getPositiveIntFlag(flags, "eos", includeEos || eosOnly ? 5 : 0),
      batchSize: getPositiveIntFlag(flags, "batch-size"),
      dryRun,
    });
  }
}

main()
  .catch((error) => {
    console.error(
      "Manual ingestion failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
