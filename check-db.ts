import { config } from "dotenv";
config();
import { db } from "./src/lib/db";

async function checkDB() {
  // Check HR 4398
  const bill = await db.bill.findFirst({
    where: {
      congress: 119,
      billType: "hr",
      billNumber: 4398
    }
  });
  
  console.log("=== HR 4398 in Database ===");
  console.log("Found:", !!bill);
  if (bill) {
    console.log("Introduced Date:", bill.introducedDate);
    console.log("Full Text Length:", bill.fullText?.length || 0);
    console.log("Full Text URL:", bill.fullTextUrl);
    console.log("Title:", bill.title?.substring(0, 100));
  }
  
  // Check how many bills have text
  const totalBills = await db.bill.count();
  const billsWithText = await db.bill.count({
    where: {
      fullText: { not: null }
    }
  });
  const billsWithTextUrl = await db.bill.count({
    where: {
      fullTextUrl: { not: null }
    }
  });
  
  console.log("\n=== Database Statistics ===");
  console.log("Total bills:", totalBills);
  console.log("Bills with full text:", billsWithText);
  console.log("Bills with text URL:", billsWithTextUrl);
  
  // Check date distribution
  const dateCounts = await db.$queryRaw`
    SELECT 
      DATE(introducedDate) as date,
      COUNT(*) as count
    FROM Bill
    GROUP BY DATE(introducedDate)
    ORDER BY count DESC
    LIMIT 10
  `;
  
  console.log("\n=== Top 10 Introduced Dates ===");
  console.log(dateCounts);
  
  await db.$disconnect();
}

checkDB().catch(console.error);
