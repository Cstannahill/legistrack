import { db } from "@/lib/db";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const BILL_ID = "cmg8obl3g00imvgn0reehryo4";

async function fetchBill() {
  const bill = await db.bill.findUnique({
    where: { id: BILL_ID },
    select: { id: true, title: true, fullText: true },
  });
  return bill;
}

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const bill = await fetchBill();
  if (!bill) {
    console.error(`Bill ${BILL_ID} not found`);
    process.exit(1);
  }

  const basePrompt = `You are a legislative analyst. Provide a short summary.\n\nFull Text of Bill:\n${bill.fullText.slice(
    0,
    50000
  )}`;

  console.log("=== First run (expected cache write) ===");
  const first = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You are a legislative analyst. Provide a short structured summary.",
      },
      { role: "user", content: basePrompt },
    ],
  });

  console.log("usage (first):", JSON.stringify(first.usage, null, 2));

  console.log("=== Second run (expected cache read) ===");
  const second = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You are a legislative analyst. Provide a short structured summary.",
      },
      { role: "user", content: basePrompt },
    ],
  });

  console.log("usage (second):", JSON.stringify(second.usage, null, 2));

  // Print high-level deltas
  const firstPrompt = (first.usage as any)?.prompt_tokens ?? null;
  const secondPrompt = (second.usage as any)?.prompt_tokens ?? null;
  const firstComp = (first.usage as any)?.completion_tokens ?? null;
  const secondComp = (second.usage as any)?.completion_tokens ?? null;

  console.log(
    "prompt_tokens first -> second:",
    firstPrompt,
    "->",
    secondPrompt
  );
  console.log(
    "completion_tokens first -> second:",
    firstComp,
    "->",
    secondComp
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
