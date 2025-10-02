import { config } from "dotenv";
config();
import { fetchBillText } from "./src/lib/api/congress";

async function test() {
  console.log("Testing fixed fetchBillText for HR 4398...\n");

  const result = await fetchBillText(119, "hr", 4398);

  if (result) {
    console.log("✅ Success!");
    console.log("Text length:", result.text?.length || 0);
    console.log("URL:", result.url);
    console.log("Date:", result.date);
    console.log("\nFirst 500 chars:");
    console.log(result.text?.substring(0, 500));
  } else {
    console.log("❌ No result returned");
  }
}

test().catch(console.error);
