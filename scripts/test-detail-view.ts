/**
 * Test script to inspect the Federal Register detail view API response
 */

import { fetchExecutiveOrderDetails } from "../src/lib/api/federal-register";

async function main() {
  console.log("🔍 Testing Federal Register Detail View API...\n");

  // Test with the document number from our previous test
  const documentNumber = "2025-19139";

  try {
    console.log(`Fetching details for document: ${documentNumber}`);
    console.log("=".repeat(80));

    const details = await fetchExecutiveOrderDetails(documentNumber);

    console.log("\nDocument details:");
    console.log(JSON.stringify(details, null, 2));

    // Check for key fields we need
    console.log("\n" + "=".repeat(80));
    console.log("\n✅ Key fields check:");
    console.log(
      `- presidential_document_type: ${
        details.presidential_document_type || "❌ MISSING"
      }`
    );
    console.log(
      `- executive_order_number: ${
        details.executive_order_number || "❌ MISSING"
      }`
    );
    console.log(`- signing_date: ${details.signing_date || "❌ MISSING"}`);
    console.log(`- type: ${details.type || "❌ MISSING"}`);
    console.log(
      `- document_number: ${details.document_number || "❌ MISSING"}`
    );
    console.log(`- title: ${details.title || "❌ MISSING"}`);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();
