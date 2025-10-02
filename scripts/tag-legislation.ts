// Script to tag bills and executive orders with EXISTING categories ONLY using AI
import { config } from "dotenv";
import { db } from "@/lib/db";
import OpenAI from "openai";

config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10", 10);
const LEGISLATION_TYPE = process.env.LEGISLATION_TYPE || "all";

interface Category {
  id: string;
  name: string;
  description: string | null;
  slug: string;
}

async function fetchExistingCategories(): Promise<Category[]> {
  return await db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, slug: true },
  });
}

async function assignCategories(
  title: string,
  summary: string | null,
  categories: Category[]
): Promise<string[]> {
  const list = categories
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}${c.description ? ` - ${c.description}` : ""}`
    )
    .join("\n");

  const prompt = `Categorize this legislation using ONLY the numbered categories below.
Return ONLY the numbers (e.g., "1,5,12"). Select 1-3 most relevant categories.

Categories:
${list}

Title: ${title}
Summary: ${summary || "No summary - use title only"}

Numbers only (comma-separated):`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [
        {
          role: "system",
          content:
            "You are a legislative categorization expert. Return ONLY numbers, comma-separated.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const response = completion.choices[0]?.message?.content || "";
    const numbers = response.trim().match(/\d+/g);

    if (!numbers) return [];

    return numbers
      .slice(0, 3)
      .map((n: string) => parseInt(n) - 1)
      .filter((i: number) => i >= 0 && i < categories.length)
      .map((i: number) => categories[i].id);
  } catch (error) {
    console.error(`   ❌ Error:`, error);
    return [];
  }
}

async function tagBills(categories: Category[]) {
  console.log(`\n��� Tagging Bills`);
  const bills = await db.bill.findMany({
    where: { categories: { none: {} } },
    take: BATCH_SIZE,
    orderBy: { introducedDate: "desc" },
    select: {
      id: true,
      billType: true,
      billNumber: true,
      title: true,
      summaries: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { content: true },
      },
    },
  });

  if (!bills.length) {
    console.log("✅ No bills need tagging\n");
    return { success: 0, failed: 0 };
  }

  console.log(`✓ Found ${bills.length} bills\n`);
  let success = 0,
    failed = 0;

  for (const bill of bills) {
    const name = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
    console.log(`�� ${name}: ${bill.title.slice(0, 60)}...`);

    const categoryIds = await assignCategories(
      bill.title,
      bill.summaries[0]?.content || null,
      categories
    );

    if (!categoryIds.length) {
      console.log(`   ⚠️  No categories assigned\n`);
      failed++;
      continue;
    }

    await db.bill.update({
      where: { id: bill.id },
      data: { categories: { connect: categoryIds.map((id) => ({ id })) } },
    });

    const names = categories
      .filter((c) => categoryIds.includes(c.id))
      .map((c) => c.name);
    console.log(`   ✅ ${names.join(", ")}\n`);
    success++;

    await new Promise((r) => setTimeout(r, 500));
  }

  return { success, failed };
}

async function tagExecutiveOrders(categories: Category[]) {
  console.log(`\n��� Tagging Executive Orders`);
  const eos = await db.executiveOrder.findMany({
    where: { categories: { none: {} } },
    take: BATCH_SIZE,
    orderBy: { signingDate: "desc" },
    select: {
      id: true,
      orderNumber: true,
      title: true,
      summaries: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { content: true },
      },
    },
  });

  if (!eos.length) {
    console.log("✅ No executive orders need tagging\n");
    return { success: 0, failed: 0 };
  }

  console.log(`✓ Found ${eos.length} executive orders\n`);
  let success = 0,
    failed = 0;

  for (const eo of eos) {
    console.log(`��� EO ${eo.orderNumber}: ${eo.title.slice(0, 60)}...`);

    const categoryIds = await assignCategories(
      eo.title,
      eo.summaries[0]?.content || null,
      categories
    );

    if (!categoryIds.length) {
      console.log(`   ⚠️  No categories assigned\n`);
      failed++;
      continue;
    }

    await db.executiveOrder.update({
      where: { id: eo.id },
      data: { categories: { connect: categoryIds.map((id) => ({ id })) } },
    });

    const names = categories
      .filter((c) => categoryIds.includes(c.id))
      .map((c) => c.name);
    console.log(`   ✅ ${names.join(", ")}\n`);
    success++;

    await new Promise((r) => setTimeout(r, 500));
  }

  return { success, failed };
}

async function main() {
  console.log(`\n���️  Legislative Tagging Script (Existing Categories Only)`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    console.log(`��� Loading categories...`);
    const categories = await fetchExistingCategories();

    if (!categories.length) {
      console.error(`❌ No categories in database!`);
      process.exit(1);
    }

    console.log(`✓ ${categories.length} categories:\n`);
    categories.forEach((c) => console.log(`   • ${c.name}`));

    let totalSuccess = 0,
      totalFailed = 0;

    if (["bills", "all"].includes(LEGISLATION_TYPE)) {
      const r = await tagBills(categories);
      totalSuccess += r.success;
      totalFailed += r.failed;
    }

    if (["executive-orders", "all"].includes(LEGISLATION_TYPE)) {
      const r = await tagExecutiveOrders(categories);
      totalSuccess += r.success;
      totalFailed += r.failed;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`��� SUMMARY`);
    console.log(`${"=".repeat(60)}`);
    console.log(`✅ Successfully tagged: ${totalSuccess}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`��� Total: ${totalSuccess + totalFailed}`);
    console.log(`\n✅ Complete!`);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
