// Quick test script to debug Federal Register API responses
import {
  fetchExecutiveOrders,
  type FederalRegisterDocument,
} from "../src/lib/api/federal-register";

async function main() {
  console.log("🔍 Testing Federal Register API...\n");

  try {
    // Test 1: Fetch executive orders only
    console.log("Test 1: Fetching executive orders only (per_page=5)");
    console.log("=".repeat(80));
    const eoOnly = await fetchExecutiveOrders({
      perPage: 5,
      conditions: {
        presidentialDocumentType: ["executive_order"],
      },
    });

    console.log(`\nFetched ${eoOnly.length} documents\n`);

    if (eoOnly.length > 0) {
      console.log("First executive order:");
      console.log(JSON.stringify(eoOnly[0], null, 2));
      console.log("\n");
    }

    // Test 2: Fetch all presidential document types
    console.log(
      "\nTest 2: Fetching all presidential document types (per_page=10)"
    );
    console.log("=".repeat(80));
    const allTypes = await fetchExecutiveOrders({
      perPage: 10,
      conditions: {
        presidentialDocumentType: [
          "executive_order",
          "presidential_memorandum",
          "proclamation",
          "determination",
        ],
      },
    });

    console.log(`\nFetched ${allTypes.length} documents\n`);

    // Group by type
    const byType: Record<string, number> = {};
    allTypes.forEach((doc: FederalRegisterDocument) => {
      const type = doc.presidential_document_type || doc.type || "unknown";
      byType[type] = (byType[type] || 0) + 1;
    });

    console.log("Documents by type:");
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
    console.log("\n");

    // Show a sample of each type
    const typesSeen = new Set<string>();
    allTypes.forEach((doc: FederalRegisterDocument) => {
      const type = doc.presidential_document_type || "unknown";
      if (!typesSeen.has(type)) {
        typesSeen.add(type);
        console.log(`\nSample ${type}:`);
        console.log(`  Document Number: ${doc.document_number}`);
        console.log(`  Type: ${doc.type}`);
        console.log(
          `  Presidential Doc Type: ${doc.presidential_document_type}`
        );
        console.log(`  Title: ${doc.title?.substring(0, 80)}...`);
        console.log(`  Signing Date: ${doc.signing_date || "N/A"}`);
        console.log(`  Publication Date: ${doc.publication_date}`);
        console.log(`  EO Number: ${doc.executive_order_number || "N/A"}`);
      }
    });

    console.log("\n" + "=".repeat(80));
    console.log("✅ Tests complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("❌ Fatal error:", e);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
