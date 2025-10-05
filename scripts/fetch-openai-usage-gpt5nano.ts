import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function main() {
  try {
    // Step 1: Get oldest & newest Summary with aiModel = 'gpt-5-nano'
    const [oldest, newest] = await Promise.all([
      prisma.summary.findFirst({
        where: { aiModel: "gpt-5-nano" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.summary.findFirst({
        where: { aiModel: "gpt-5-nano" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    if (!oldest || !newest) {
      console.log("No summaries found for aiModel = gpt-5-nano");
      return;
    }

    const startDate = oldest.createdAt.toISOString().split("T")[0];
    const endDate = newest.createdAt.toISOString().split("T")[0];

    console.log(`Querying usage from ${startDate} → ${endDate}`);

    // Step 2: Call OpenAI Usage Costs API
    const response = await openai.costs.list({
      start_date: startDate,
      end_date: endDate,
    });

    // Step 3: Output relevant usage data
    console.log("=== OpenAI Usage Report ===");
    console.log(JSON.stringify(response, null, 2));
  } catch (err) {
    console.error("Error fetching usage data:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
