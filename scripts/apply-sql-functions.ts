#!/usr/bin/env tsx
/**
 * Apply SQL Functions to Database
 *
 * This script reads all .plpgsql files from prisma/functions and applies them to the database.
 * Run this after updating any SQL function files to ensure they're deployed.
 *
 * Usage:
 *   tsx scripts/apply-sql-functions.ts
 */

import { db } from "@/lib/db";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

async function applySqlFunctions() {
  console.log("🔧 Applying SQL Functions to Database");
  console.log(
    "================================================================================\n"
  );

  const functionsDir = join(process.cwd(), "prisma", "functions");
  const files = readdirSync(functionsDir).filter((f) => f.endsWith(".plpgsql"));

  console.log(
    `📁 Found ${files.length} function file(s) in prisma/functions/\n`
  );

  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = join(functionsDir, file);
    const functionName = file.replace(".plpgsql", "");

    try {
      console.log(`📄 Applying: ${functionName}`);
      const sql = readFileSync(filePath, "utf-8");

      // Execute the SQL to create/replace the function
      await db.$executeRawUnsafe(sql);

      console.log(`   ✅ Successfully applied\n`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Error applying ${functionName}:`);
      console.error(
        `   ${error instanceof Error ? error.message : String(error)}\n`
      );
      errorCount++;
    }
  }

  console.log(
    "================================================================================"
  );
  console.log("📊 SUMMARY");
  console.log(
    "================================================================================"
  );
  console.log(`✅ Successfully applied: ${successCount}`);
  console.log(`❌ Failed: ${errorCount}`);
  console.log(`📊 Total processed: ${files.length}`);
  console.log(
    "================================================================================"
  );

  await db.$disconnect();

  if (errorCount > 0) {
    process.exit(1);
  }
}

applySqlFunctions().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
