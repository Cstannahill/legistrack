// Manual script to fetch and persist bill actions from Congress.gov
// Usage examples:
//   tsx scripts/fetch-bill-actions.ts --bill hr-123
//   tsx scripts/fetch-bill-actions.ts --bill-id <uuid>
//   tsx scripts/fetch-bill-actions.ts --limit 25
//   tsx scripts/fetch-bill-actions.ts --limit 25 --refetch
//   tsx scripts/fetch-bill-actions.ts --dry-run --bill 118-hr-123

import { config } from "dotenv";

config();

import { db } from "@/lib/db";
import {
  fetchBillActions,
  fetchBillText,
  fetchBillDetails,
} from "@/lib/api/congress";
import llmRedis from "@/lib/llmRedis";
import { CURRENT_CONGRESS } from "@/lib/constants";
import { determineBillStatus } from "@/workflows/summarize-bill-standard";

interface CLIOptions {
  billId?: string;
  billIdentifier?: {
    congress: number;
    billType: string;
    billNumber: number;
  };
  limit: number;
  refetch: boolean;
  dryRun: boolean;
}

const DEFAULT_LIMIT = parseInt(process.env.ACTION_BATCH_SIZE || "20", 10);
const ACTION_CONCURRENCY = parseInt(process.env.ACTION_CONCURRENCY || "5", 10);
const ARCHIVE_AFTER_DAYS = parseInt(
  process.env.ARCHIVE_AFTER_DAYS || "365",
  10
);

type RawCongressAction = {
  actionDate?: string;
  actionTime?: string;
  actionCode?: string;
  type?: string;
  text?: string;
  description?: string;
  actionDescription?: string;
  sourceSystem?: {
    code?: string;
    name?: string;
  };
};

type NormalizedAction = {
  actionDate: Date;
  actionCode: string | null;
  actionType: string;
  text: string;
};

type BillRecord = {
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  title: string | null;
  currentStatus: string;
  statusDate: Date;
};

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    limit: DEFAULT_LIMIT,
    refetch: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    switch (arg) {
      case "--bill-id": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("Missing value for --bill-id");
        }
        options.billId = value;
        i += 1;
        break;
      }
      case "--bill": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("Missing value for --bill");
        }
        options.billIdentifier = parseBillIdentifier(value, CURRENT_CONGRESS);
        i += 1;
        break;
      }
      case "--limit": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("Missing value for --limit");
        }
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          throw new Error("--limit must be a positive integer");
        }
        options.limit = parsed;
        i += 1;
        break;
      }
      case "--refetch": {
        options.refetch = true;
        break;
      }
      case "--dry-run": {
        options.dryRun = true;
        break;
      }
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
      }
      default: {
        console.warn(`Unknown option: ${arg}`);
      }
    }
  }

  return options;
}

function printHelp() {
  console.log(
    `\nFetch and store Congress.gov actions for bills.\n\nOptions:\n  --bill-id <uuid>          Fetch actions for a specific bill by database id\n  --bill <slug>             Fetch by bill identifier (e.g., hr-123 or 118-hr-123)\n  --limit <number>          Number of bills to process when no bill specified (default ${DEFAULT_LIMIT})\n  --refetch                 Force refresh even if actions already exist\n  --dry-run                 Do not write to the database\n  --help                    Show this message\n`
  );
}

function parseBillIdentifier(input: string, fallbackCongress: number) {
  const sanitized = input.trim().toLowerCase().replace(/\s+/g, "-");
  const parts = sanitized.split("-").filter(Boolean);

  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Invalid bill identifier '${input}'. Use formats like 'hr-123' or '118-hr-123'.`
    );
  }

  let congress = fallbackCongress;
  let billType: string;
  let billNumberRaw: string;

  if (parts.length === 3) {
    congress = parseInt(parts[0], 10);
    if (Number.isNaN(congress)) {
      throw new Error(`Invalid congress value in identifier: '${parts[0]}'`);
    }
    billType = parts[1];
    billNumberRaw = parts[2];
  } else {
    billType = parts[0];
    billNumberRaw = parts[1];
  }

  const billNumber = parseInt(billNumberRaw, 10);
  if (Number.isNaN(billNumber)) {
    throw new Error(`Invalid bill number in identifier: '${billNumberRaw}'`);
  }

  return { congress, billType, billNumber };
}

async function getBills(options: CLIOptions): Promise<BillRecord[]> {
  if (options.billId) {
    const bill = await db.bill.findUnique({
      where: { id: options.billId },
      select: {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
        currentStatus: true,
        statusDate: true,
      },
    });

    if (!bill) {
      throw new Error(`Bill not found with id ${options.billId}`);
    }

    return [bill];
  }

  if (options.billIdentifier) {
    const { congress, billType, billNumber } = options.billIdentifier;
    const bill = await db.bill.findUnique({
      where: {
        congress_billType_billNumber: {
          congress,
          billType: billType.toLowerCase(),
          billNumber,
        },
      },
      select: {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
        currentStatus: true,
        statusDate: true,
      },
    });

    if (!bill) {
      throw new Error(
        `Bill not found matching ${congress}-${billType}-${billNumber}`
      );
    }

    return [bill];
  }

  const whereClause = options.refetch
    ? {}
    : {
        actions: {
          none: {},
        },
      };

  const bills = await db.bill.findMany({
    where: whereClause,
    take: options.limit,
    orderBy: { introducedDate: "desc" },
    select: {
      id: true,
      billType: true,
      billNumber: true,
      congress: true,
      title: true,
      currentStatus: true,
      statusDate: true,
    },
  });

  return bills;
}

function formatBillLabel(bill: BillRecord) {
  return `${bill.billType.toUpperCase()} ${bill.billNumber} (Congress ${
    bill.congress
  })`;
}

function normalizeAction(raw: RawCongressAction): NormalizedAction | null {
  const dateSource = raw.actionDate;
  if (!dateSource) {
    return null;
  }

  const parsedDate = new Date(dateSource);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const text =
    raw.text?.trim() ||
    raw.actionDescription?.trim() ||
    raw.description?.trim();

  if (!text) {
    return null;
  }

  const actionType =
    raw.type?.trim() ||
    raw.sourceSystem?.code?.trim() ||
    raw.sourceSystem?.name?.trim() ||
    "unspecified";

  const actionCode = raw.actionCode?.trim() || null;

  return {
    actionDate: parsedDate,
    actionCode,
    actionType,
    text,
  };
}

async function processBill(bill: BillRecord, options: CLIOptions) {
  const label = formatBillLabel(bill);
  console.log(`\n📄 ${label}`);
  console.log(`   Title: ${bill.title || "(untitled)"}`);
  const redisKeyStatus = `actions:bill:${bill.id}:status`;
  const redisKeyAttempts = `actions:bill:${bill.id}:attempts`;

  try {
    // Archiving rule: skip bills that became law long ago
    try {
      if (
        bill.currentStatus === "BECAME_LAW" &&
        bill.statusDate &&
        new Date(bill.statusDate) <
          new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000)
      ) {
        console.log("   🗄️  Bill archived by policy; skipping actions fetch");
        await llmRedis.redis.set(redisKeyStatus, "archived");
        return { status: "archived" as const, count: 0 };
      }
    } catch {
      console.warn("Archive check failed, continuing");
    }

    // mark processing in redis and increment attempts
    await llmRedis.redis.set(redisKeyStatus, "processing");
    await llmRedis.redis.incr(redisKeyAttempts);

    const apiActions = await fetchBillActions(
      bill.congress,
      bill.billType.toLowerCase(),
      bill.billNumber
    );

    if (!Array.isArray(apiActions) || apiActions.length === 0) {
      console.log("   ⚠️  No actions returned from Congress.gov");

      if (!options.dryRun && options.refetch) {
        await db.action.deleteMany({ where: { billId: bill.id } });
        console.log("   🗑️  Cleared existing actions for bill");
      }

      return { status: "empty" as const, count: 0 };
    }

    const normalized = apiActions
      .map((entry: RawCongressAction) => normalizeAction(entry))
      .filter((item): item is NormalizedAction => item !== null)
      .sort((a, b) => a.actionDate.getTime() - b.actionDate.getTime());

    if (normalized.length === 0) {
      console.log("   ⚠️  No valid actions after normalization");
      await llmRedis.redis.set(redisKeyStatus, "invalid");
      return { status: "invalid" as const, count: 0 };
    }

    console.log(
      `   ✅ Retrieved ${normalized.length} actions (latest: ${
        normalized[normalized.length - 1].actionDate.toISOString().split("T")[0]
      })`
    );

    if (options.dryRun) {
      normalized.slice(-5).forEach((action) => {
        console.log(
          `      • ${action.actionDate.toISOString().split("T")[0]} | ${
            action.actionType
          } | ${action.text.substring(0, 80)}${
            action.text.length > 80 ? "…" : ""
          }`
        );
      });

      return { status: "dry-run" as const, count: normalized.length };
    }

    // Persist actions and update bill within a transaction
    await db.$transaction(async (tx) => {
      await tx.action.deleteMany({ where: { billId: bill.id } });
      await tx.action.createMany({
        data: normalized.map((action) => ({
          billId: bill.id,
          actionDate: action.actionDate,
          actionCode: action.actionCode || undefined,
          actionType: action.actionType,
          text: action.text,
        })),
      });

      const latestAction = normalized[normalized.length - 1];
      const latestText = apiActions[apiActions.length - 1]?.text as
        | string
        | undefined;
      const resolvedStatus = determineBillStatus(latestText);

      // Also fetch and store bill text/details so downstream LLM has all data
      try {
        const details = await fetchBillDetails(
          bill.congress,
          bill.billType.toLowerCase(),
          bill.billNumber
        );
        // If details include updated title or other metadata, we can persist minimal updates
        if (details?.title && details.title !== bill.title) {
          // handled below in the same tx update
        }
      } catch (e) {
        console.warn("Failed to fetch bill details", e);
      }

      try {
        const textResult = await fetchBillText(
          bill.congress,
          bill.billType.toLowerCase(),
          bill.billNumber
        );
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            currentStatus: resolvedStatus || bill.currentStatus,
            statusDate: latestAction.actionDate,
            lastFetchedAt: new Date(),
            fullText: textResult?.text ?? undefined,
            fullTextUrl: textResult?.url ?? undefined,
          },
        });
      } catch {
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            currentStatus: resolvedStatus || bill.currentStatus,
            statusDate: latestAction.actionDate,
            lastFetchedAt: new Date(),
          },
        });
      }
    });

    await llmRedis.redis.set(redisKeyStatus, "completed");

    console.log(`   💾 Stored ${normalized.length} actions in database`);
    return { status: "stored" as const, count: normalized.length };
  } catch (error) {
    console.error(`   ❌ Error processing actions:`, error);
    await llmRedis.redis.set(redisKeyStatus, "failed");
    await llmRedis.redis.hset(`actions:bill:${bill.id}:error`, {
      message: String(error),
      at: new Date().toISOString(),
    });
    return { status: "error" as const, count: 0 };
  }
}

async function main() {
  let jobRunId: string | null = null;
  try {
    const options = parseArgs();

    // sanitize options for JSON storage (avoid TS Json typing issues)
    const optionsForMetadata = {
      limit: options.limit,
      refetch: options.refetch,
      dryRun: options.dryRun,
      billId: options.billId ?? null,
      billIdentifier: options.billIdentifier ?? null,
    };

    // Create a JobRun record to persist processing metadata
    try {
      const jr = await db.jobRun.create({
        data: {
          jobName: "fetch-bill-actions",
          status: "RUNNING",
          itemsProcessed: 0,
          itemsFailed: 0,
          metadata: { options: optionsForMetadata },
        },
      });
      jobRunId = jr.id;
    } catch (e) {
      console.warn(
        "Failed to create JobRun record, continuing without persistent job logging",
        e
      );
      jobRunId = null;
    }

    console.log("\n⚙️  Fetch Bill Actions Script");
    console.log(`   ▶︎ Mode: ${options.dryRun ? "DRY RUN" : "WRITE"}`);
    if (options.billId) {
      console.log(`   ▶︎ Bill ID: ${options.billId}`);
    } else if (options.billIdentifier) {
      const { congress, billType, billNumber } = options.billIdentifier;
      console.log(
        `   ▶︎ Bill: ${congress}-${billType.toUpperCase()}-${billNumber}`
      );
    } else {
      console.log(`   ▶︎ Limit: ${options.limit}`);
      console.log(`   ▶︎ Refetch existing: ${options.refetch ? "yes" : "no"}`);
    }

    const bills = await getBills(options);
    if (bills.length === 0) {
      console.log("\nℹ️  No bills matched the criteria.");
      if (!options.refetch) {
        console.log(
          "   Tip: Use --refetch to refresh actions for bills that already have stored data."
        );
      }
      return;
    }

    console.log(`\n🔍 Processing ${bills.length} bill(s)...`);

    let stored = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < bills.length; i += ACTION_CONCURRENCY) {
      const chunk = bills.slice(i, i + ACTION_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((b) => processBill(b, options))
      );
      for (const result of results) {
        if (!result) continue;
        switch (result.status) {
          case "stored":
            stored += 1;
            break;
          case "dry-run":
          case "empty":
          case "invalid":
          case "archived":
            skipped += 1;
            break;
          case "error":
            failed += 1;
            break;
        }
      }

      // update JobRun counters incrementally (best-effort)
      if (jobRunId) {
        try {
          const processedDelta = results.filter(
            (r) => r?.status === "stored"
          ).length;
          const failedDelta = results.filter(
            (r) => r?.status === "error"
          ).length;
          await db.jobRun.update({
            where: { id: jobRunId },
            data: {
              itemsProcessed: { increment: processedDelta },
              itemsFailed: { increment: failedDelta },
              metadata: {
                options: optionsForMetadata,
                lastChunkAt: new Date().toISOString(),
              },
            },
          });
        } catch (e) {
          console.warn("Failed to update JobRun during processing", e);
        }
      }
    }

    console.log("\n📊 Summary");
    console.log(`   ✓ Stored: ${stored}`);
    console.log(`   ~ Skipped: ${skipped}`);
    console.log(`   ✗ Failed: ${failed}`);

    // finalize JobRun
    if (jobRunId) {
      try {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            itemsProcessed: stored,
            itemsFailed: failed,
            metadata: { summary: { stored, skipped, failed } },
          },
        });
      } catch (e) {
        console.warn("Failed to finalize JobRun", e);
      }
    }
  } catch (error) {
    console.error("\n❌ Fatal error in fetch-bill-actions script:", error);
    // mark job as failed if we have a jobRun
    try {
      if (typeof jobRunId === "string" && jobRunId) {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: String(error),
          },
        });
      }
    } catch (e) {
      console.warn("Failed to mark JobRun as failed", e);
    }
    process.exit(1);
  }
}

main().then(() => {
  console.log("\n✅ Done\n");
  process.exit(0);
});
