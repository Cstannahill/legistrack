import { config } from "dotenv";
config();
import { db } from "./src/lib/db";

async function check() {
  // Search by title for HR 4398
  const bill = await db.bill.findFirst({
    where: {
      congress: 119,
      title: {
        contains: "Veteran Burial"
      }
    }
  });
  
  console.log("=== Veteran Burial Bill ===");
  if (bill) {
    console.log("Found:", bill.billType, bill.billNumber);
    console.log("Title:", bill.title);
    console.log("Introduced Date:", bill.introducedDate);
    console.log("Full Text Length:", bill.fullText?.length || 0);
    console.log("Full Text URL:", bill.fullTextUrl);
    console.log("\nFirst 500 chars of fullText:");
    console.log(bill.fullText?.substring(0, 500) || "NO TEXT");
  } else {
    console.log("NOT FOUND by title search");
  }
  
  // Also check total stats
  const totalBills = await db.bill.count();
  const billsWithText = await db.bill.count({
    where: { fullText: { not: null } }
  });
  const billsWithTextUrl = await db.bill.count({
    where: { fullTextUrl: { not: null } }
  });
  
  console.log("\n=== Overall Stats ===");
  console.log("Total bills:", totalBills);
  console.log("Bills with full text:", billsWithText);
  console.log("Bills with text URL:", billsWithTextUrl);
  
  // Sample a few bills to see their text status
  const sampleBills = await db.bill.findMany({
    take: 10,
    select: {
      billType: true,
      billNumber: true,
      title: true,
      fullText: true,
      fullTextUrl: true
    }
  });
  
  console.log("\n=== Sample of 10 Bills ===");
  sampleBills.forEach(b => {
    const textLen = b.fullText?.length || 0;
    const hasUrl = !!b.fullTextUrl;
    console.log(`${b.billType} ${b.billNumber}: text=${textLen} chars, url=${hasUrl}`);
  });
  
  await db.$disconnect();
}

check().catch(console.error);
