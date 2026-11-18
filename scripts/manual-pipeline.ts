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
Manual End-to-End Pipeline (Ingest -> Text Backfill -> Summarize & Categorize)

Usage:
  npx tsx scripts/manual-pipeline.ts [options]

Options:
  --model=<name>         deepseek | gemini | glm | mimo | cascade (default: cascade)
  --fallback             Allow fallback when a specific OpenRouter model is pinned
  --bill=<id>            Ingest and summarize one specific bill (e.g. "HR 4398")
  --replace              With --bill, regenerate existing STANDARD summary
  --days=<n>             Ingestion lookback days (default: 1)
  --congress=<n>         Target Congress number (default: 119)
  --types=<csv>          Bill types filter (e.g. "hr,s")
  --limit=<n>            Cap discovered items hydrated during ingestion
  --include-eos          Include presidential executive orders
  --backfill-texts=<n>   Backfill up to N bills/EOs missing fullText
  --bills=<n>            Bills to summarize in batch mode (default: 5)
  --eos=<n>              Executive orders to summarize in batch mode (default: 0)
  --batch-size=<n>       Items per LLM batch request (default: 3)
  --skip-ingest          Skip ingestion and only run summarization
  --skip-summarize       Skip summarization and only run ingestion
  --dry-run              Preview ingestion and summarization without API/DB writes
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
  const includeEos = getBooleanFlag(flags, "include-eos");
  const skipIngest = getBooleanFlag(flags, "skip-ingest");
  const skipSummarize = getBooleanFlag(flags, "skip-summarize");

  if (!skipIngest) {
    await runManualIngest({
      bill,
      congress: getPositiveIntFlag(flags, "congress"),
      lookbackDays: getPositiveIntFlag(flags, "days"),
      billTypes: getCsvFlag(flags, "types"),
      startDate: getStringFlag(flags, "start-date"),
      endDate: getStringFlag(flags, "end-date"),
      limit: getPositiveIntFlag(flags, "limit"),
      includeEos,
      eosOnly: getBooleanFlag(flags, "eos-only"),
      backfillTexts: getNonNegativeIntFlag(flags, "backfill-texts"),
      dryRun,
    });
  }

  if (!skipSummarize) {
    const model = getStringFlag(flags, "model") || process.env.AI_MODEL || "cascade";
    const outcome = await runManualSummarize({
      model,
      allowFallback: getBooleanFlag(flags, "fallback"),
      bill,
      bills: getNonNegativeIntFlag(flags, "bills", 5),
      eos: getNonNegativeIntFlag(flags, "eos", includeEos ? 5 : 0),
      batchSize: getPositiveIntFlag(flags, "batch-size"),
      replace: getBooleanFlag(flags, "replace"),
      dryRun,
    });

    if (outcome.failed > 0 && outcome.persisted === 0) {
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error(
      "Manual pipeline failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
