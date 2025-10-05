/**
 * Enhanced Pagination Validation Script
 * Detects:
 *  - Missing items (0 extracted on a page)
 *  - Duplicate IDs across ANY pages
 *  - Overlap between adjacent pages (should be 0 if offset paging correct)
 *  - Alternating repetition patterns (page n equals page n-2 start)
 *  - Early truncation (< pageSize before final page)
 *
 * Usage: npx ts-node scripts/validate-pagination.ts [baseUrl] [pages] [pageSize]
 * Example: npx ts-node scripts/validate-pagination.ts http://localhost:3000 7 20
 */

interface PageResult {
  page: number;
  ids: string[];
}

async function fetchPage(baseUrl: string, page: number): Promise<string> {
  const url = `${baseUrl}/bills?type=ALL&page=${page}`;
  const res = await fetch(url, { headers: { accept: "text/html" } });
  const html = await res.text();
  if (!res.ok) throw new Error(`Failed to fetch page ${page}: ${res.status}`);
  return html;
}

function extractIds(html: string, max: number): string[] {
  // Match links for bills and EOs: /bills/<id> or /bills/eo/<id>
  const re = /<a[^>]+href=\"(\/bills(?:\/eo)?\/([a-z0-9]+))\"/gi;
  const ordered: string[] = [];
  const local = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[2];
    if (!local.has(id)) {
      ordered.push(id);
      local.add(id);
      if (ordered.length === max) break;
    }
  }
  return ordered;
}

function analyze(results: PageResult[], pageSize: number) {
  const globalSeen = new Set<string>();
  let duplicates = 0;
  const anomalies: string[] = [];
  for (const r of results) {
    if (r.ids.length === 0) anomalies.push(`Page ${r.page} extracted 0 items`);
    else if (r.page !== results.length && r.ids.length < pageSize)
      anomalies.push(
        `Page ${r.page} underfilled (${r.ids.length}/${pageSize}) before last page`
      );
    for (const id of r.ids) {
      if (globalSeen.has(id)) duplicates++;
      else globalSeen.add(id);
    }
  }
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    const overlap = curr.ids.filter((id) => prev.ids.includes(id));
    if (overlap.length > 0)
      anomalies.push(
        `Pages ${prev.page}-${curr.page} overlap ${
          overlap.length
        } IDs (e.g. ${overlap.slice(0, 3).join(",")})`
      );
    if (curr.ids[0] && curr.ids[0] === prev.ids[0])
      anomalies.push(
        `Pages ${prev.page} & ${curr.page} share first ID ${curr.ids[0]}`
      );
  }
  for (let i = 2; i < results.length; i++) {
    const curr = results[i];
    const twoBack = results[i - 2];
    if (curr.ids[0] && curr.ids[0] === twoBack.ids[0])
      anomalies.push(
        `Alternating repetition: pages ${twoBack.page} & ${curr.page} start with ${curr.ids[0]}`
      );
  }
  return { duplicates, anomalies };
}

async function main() {
  const baseUrl = process.argv[2] || "http://localhost:3000";
  const pages = parseInt(process.argv[3] || "5", 10);
  const pageSize = parseInt(process.argv[4] || "20", 10);
  const results: PageResult[] = [];
  for (let p = 1; p <= pages; p++) {
    const html = await fetchPage(baseUrl, p);
    const ids = extractIds(html, pageSize);
    results.push({ page: p, ids });
    console.log(
      `Page ${p}: ${ids.length} items${ids.length ? ` (first=${ids[0]})` : ""}`
    );
  }
  const { duplicates, anomalies } = analyze(results, pageSize);
  console.log("--- Summary ---");
  console.log(`Pages checked: ${pages}`);
  console.log(
    `Total extracted: ${results.reduce((a, r) => a + r.ids.length, 0)}`
  );
  console.log(`Unique IDs: ${new Set(results.flatMap((r) => r.ids)).size}`);
  console.log(`Duplicates across all pages: ${duplicates}`);
  if (anomalies.length) {
    console.error("Anomalies:");
    anomalies.forEach((a) => console.error(" - " + a));
  }
  if (duplicates > 0 || anomalies.length > 0) {
    console.error("FAIL: Pagination anomalies detected");
    process.exit(1);
  } else {
    console.log("PASS: No anomalies detected");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
