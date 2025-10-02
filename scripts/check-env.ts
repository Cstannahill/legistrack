// Quick script to check if environment variables are loaded
import { config } from "dotenv";

// Load environment variables from .env file
config();

console.log("\n🔍 Environment Variable Check\n");

const requiredVars = [
  "CONGRESS_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DATABASE_URL",
];

let allPresent = true;

for (const varName of requiredVars) {
  const value = process.env[varName];
  if (value) {
    // Show first 10 chars for security
    const preview = value.substring(0, 10) + "...";
    console.log(`✓ ${varName}: ${preview} (${value.length} chars)`);
  } else {
    console.log(`✗ ${varName}: NOT SET`);
    allPresent = false;
  }
}

console.log("");

if (!allPresent) {
  console.log("❌ Some required environment variables are missing!");
  console.log("💡 Create a .env file based on .env.example\n");
  process.exit(1);
} else {
  console.log("✅ All required environment variables are set!\n");
}
