import { config } from "dotenv";
config();

async function testTextFetch() {
  const API_KEY = process.env.CONGRESS_API_KEY;
  
  // First get the text versions
  const textUrl = `https://api.congress.gov/v3/bill/119/hr/4398/text?api_key=${API_KEY}&format=json`;
  const textResponse = await fetch(textUrl);
  const textData = await textResponse.json();
  
  console.log("=== TEXT VERSIONS AVAILABLE ===");
  console.log(JSON.stringify(textData.textVersions[0], null, 2));
  
  // Now try to fetch the formatted text
  const formattedTextUrl = textData.textVersions[0].formats[0].url;
  console.log("\n=== FETCHING FORMATTED TEXT ===");
  console.log("URL:", formattedTextUrl);
  
  const contentResponse = await fetch(`${formattedTextUrl}?api_key=${API_KEY}`);
  const contentText = await contentResponse.text();
  
  console.log("\n=== CONTENT PREVIEW (first 1000 chars) ===");
  console.log(contentText.substring(0, 1000));
  console.log("\n... Total length:", contentText.length, "characters");
}

testTextFetch().catch(console.error);
