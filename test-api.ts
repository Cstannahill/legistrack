import { config } from "dotenv";
config();

async function testAPI() {
  const API_KEY = process.env.CONGRESS_API_KEY;
  const url = `https://api.congress.gov/v3/bill/119?api_key=${API_KEY}&limit=5&offset=0&format=json`;
  
  console.log("Fetching from:", url);
  
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  
  const data = await response.json();
  console.log("\n=== SAMPLE BILL DATA ===");
  console.log(JSON.stringify(data.bills[0], null, 2));
  
  // Now test fetching bill text for HR 4398
  console.log("\n\n=== TESTING HR 4398 SPECIFICALLY ===");
  const textUrl = `https://api.congress.gov/v3/bill/119/hr/4398/text?api_key=${API_KEY}&format=json`;
  console.log("Fetching text from:", textUrl);
  
  const textResponse = await fetch(textUrl, {
    headers: { Accept: "application/json" },
  });
  
  if (!textResponse.ok) {
    console.log("Text response NOT OK:", textResponse.status, textResponse.statusText);
  } else {
    const textData = await textResponse.json();
    console.log("Text data structure:");
    console.log(JSON.stringify(textData, null, 2));
  }
}

testAPI().catch(console.error);
