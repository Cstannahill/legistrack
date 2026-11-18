import { db } from "@/lib/db";
import {
  getBooleanFlag,
  getNonNegativeIntFlag,
  getPositiveIntFlag,
  getStringFlag,
  loadManualEnv,
  parseCliFlags,
  runManualSummarize,
} from "./lib/manual-pipeline";

loadManualEnv();

function printHelp() {
  console.log(`
Manual Bill & Executive Order Summarization (DeepSeek / Gemini / GLM / MiMo)

Usage:
  npx tsx scripts/manual-summarize.ts --model=<name> [options]

Models:
  deepseek   DeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash-1017 via OpenRouter)
  mimo       Xiaomi MiMo V2.6 Flash (xiaomi/mimo-v2.6-flash via OpenRouter)
  glm        GLM 5.3 Flash (z-ai/glm-5.3-flash via OpenRouter)
  gemini     Gemini 3.8 Flash (gemini-3.8-flash directly via @google/genai)
  cascade    Full production cascade (deepseek -> mimo -> glm -> gemini)

Options:
  --model=<name>       Model alias or OpenRouter slug (default: AI_MODEL or cascade)
  --fallback           Allow fallback to remaining cascade/Gemini if pinned model fails
  --bills=<n>          Number of unsummarized bills to process (default: 5)
  --eos=<n>            Number of unsummarized EOs to process (default: 0)
  --batch-size=<n>     Items per LLM batch request (default: SUMMARIZE_BATCH_SIZE or 3)
  --bill=<id>          Target a single bill (e.g. "HR 4398" or "119-hr-4398")
  --eo=<orderNumber>   Target a single Executive Order by orderNumber (e.g. 14363)
  --id=<cuid>          Target a single Bill or ExecutiveOrder by database id
  --replace            Regenerate STANDARD summary for single target (--bill/--eo/--id)
  --dry-run            Preview selected work items and quotas without calling LLMs
  --help               Show this help message
`);
}

async function main() {
  const { flags, positionals } = parseCliFlags(process.argv.slice(2));
  if (getBooleanFlag(flags, "help")) {
    printHelp();
    return;
  }

  const model =
    getStringFlag(flags, "model") ||
    positionals[0] ||
    process.env.AI_MODEL ||
    "cascade";

  const outcome = await runManualSummarize({
    model,
    allowFallback: getBooleanFlag(flags, "fallback"),
    bill: getStringFlag(flags, "bill"),
    eo: getPositiveIntFlag(flags, "eo"),
    id: getStringFlag(flags, "id"),
    bills: getNonNegativeIntFlag(flags, "bills", 5),
    eos: getNonNegativeIntFlag(flags, "eos", 0),
    batchSize: getPositiveIntFlag(flags, "batch-size"),
    replace: getBooleanFlag(flags, "replace"),
    dryRun: getBooleanFlag(flags, "dry-run"),
  });

  if (outcome.failed > 0 && outcome.persisted === 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      "Manual summarization failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
