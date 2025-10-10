/**
 * Utilities for cleaning and formatting legislative full text
 */

/**
 * Cleans legislative text by:
 * 1. Decoding HTML entities (&lt; to <, &gt; to >, &amp; to &)
 * 2. Removing <DOC> and <all> markers
 * 3. Reducing excessive whitespace while preserving formatting
 * 4. Trimming leading/trailing whitespace
 */
export function cleanLegislativeText(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Remove <DOC> and <all> markers (with any surrounding whitespace)
  cleaned = cleaned.replace(/<DOC>\s*/g, "");
  cleaned = cleaned.replace(/\s*<all>/g, "");

  // Reduce excessive blank lines (more than 2 consecutive newlines) to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // Trim leading and trailing whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Extracts structured sections from legislative text
 * Returns an object with header info and main content
 */
export function parseLegislativeText(text: string): {
  header: string | null;
  billInfo: string | null;
  title: string | null;
  content: string;
} {
  if (!text) {
    return { header: null, billInfo: null, title: null, content: "" };
  }

  const cleaned = cleanLegislativeText(text);
  const lines = cleaned.split("\n");

  // Try to identify sections
  let headerEndIndex = -1;
  let billInfoEndIndex = -1;
  let titleStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for GPO header (starts with [Congressional Bills...)
    if (line.startsWith("[Congressional Bills") && headerEndIndex === -1) {
      // Find the end of header section (usually ends with IH], ATS], etc.)
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (
          lines[j].match(/\[(IH|ATS|AS|RH|RS|ENR|EH|ES|RDS|RFS|CPS|PCS)\]$/)
        ) {
          headerEndIndex = j;
          break;
        }
      }
    }

    // Look for Congress session info (e.g., "119th CONGRESS")
    if (line.match(/^\d+th CONGRESS/) && billInfoEndIndex === -1) {
      // Bill info section typically ends before "IN THE HOUSE" or "IN THE SENATE"
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        if (
          lines[j].includes("IN THE HOUSE OF REPRESENTATIVES") ||
          lines[j].includes("IN THE SENATE OF THE UNITED STATES")
        ) {
          billInfoEndIndex = j - 1;
          titleStartIndex = j;
          break;
        }
      }
    }
  }

  // Extract sections
  const header =
    headerEndIndex > -1
      ? lines
          .slice(0, headerEndIndex + 1)
          .join("\n")
          .trim()
      : null;

  const billInfo =
    headerEndIndex > -1 && billInfoEndIndex > headerEndIndex
      ? lines
          .slice(headerEndIndex + 1, billInfoEndIndex + 1)
          .join("\n")
          .trim()
      : null;

  // The rest is the main content
  const contentStartIndex =
    Math.max(headerEndIndex, billInfoEndIndex, titleStartIndex) + 1;
  const content = lines.slice(contentStartIndex).join("\n").trim();

  // Try to extract title from bill info
  const title = billInfo ? extractBillTitle(billInfo) : null;

  return { header, billInfo, title, content };
}

/**
 * Extracts the bill title from the bill info section
 */
function extractBillTitle(billInfo: string): string | null {
  // Title is usually on its own line after the bill number
  const lines = billInfo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  // Look for a line that looks like a title (longer than 20 chars, not all caps section header)
  for (const line of lines) {
    if (
      line.length > 20 &&
      !line.match(/^\d+th CONGRESS/) &&
      !line.match(/^[A-Z\s.]+$/) &&
      !line.match(/Session$/)
    ) {
      return line;
    }
  }

  return null;
}

/**
 * Formats a date string from legislative text (e.g., "September 30, 2025")
 */
export function parseLegislativeDate(text: string): Date | null {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthPattern = months.join("|");
  const dateRegex = new RegExp(`(${monthPattern})\\s+(\\d{1,2}),\\s+(\\d{4})`);
  const match = text.match(dateRegex);

  if (match) {
    try {
      return new Date(match[0]);
    } catch {
      return null;
    }
  }

  return null;
}
