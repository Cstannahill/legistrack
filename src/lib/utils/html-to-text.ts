/**
 * Convert HTML content to readable plain text
 * Specifically designed for Federal Register executive order content
 */

export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html;

  // Remove script and style tags and their content
  text = text.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Convert heading tags to uppercase text with spacing
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n\n$1\n\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n\n$1\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n\n$1\n");
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n$1\n");
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "\n$1\n");
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "\n$1\n");

  // Convert paragraph tags to newlines
  text = text.replace(/<p[^>]*>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");

  // Convert br tags to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Convert div tags to spacing
  text = text.replace(/<div[^>]*>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");

  // Convert list items
  text = text.replace(/<li[^>]*>/gi, "\n• ");
  text = text.replace(/<\/li>/gi, "");

  // Convert strong/bold tags
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "$1");
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, "$1");

  // Convert emphasis/italic tags
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, "$1");
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, "$1");

  // Convert links (keep the text, discard the href)
  text = text.replace(/<a[^>]*>(.*?)<\/a>/gi, "$1");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  // Clean up excessive whitespace while preserving intentional spacing
  text = text.replace(/[ \t]+/g, " "); // Multiple spaces/tabs to single space
  text = text.replace(/\n[ \t]+/g, "\n"); // Remove leading spaces on lines
  text = text.replace(/[ \t]+\n/g, "\n"); // Remove trailing spaces on lines
  text = text.replace(/\n{3,}/g, "\n\n"); // Max 2 consecutive newlines

  // Trim leading and trailing whitespace
  text = text.trim();

  return text;
}

/**
 * Format executive order HTML content specifically
 * Adds proper structure and formatting for executive orders
 */
export function formatExecutiveOrderText(html: string): string {
  if (!html) return "";

  // First convert to plain text
  let text = htmlToText(html);

  // Add section separators for better readability
  text = text.replace(
    /Section (\d+)\./g,
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nSection $1."
  );
  text = text.replace(
    /Sec\. (\d+)\./g,
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nSec. $1."
  );

  // Format "NOW, THEREFORE" clause
  text = text.replace(/NOW, THEREFORE,/g, "\n\nNOW, THEREFORE,");

  // Format signature sections
  text = text.replace(
    /THE WHITE HOUSE,/g,
    "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nTHE WHITE HOUSE,"
  );

  return text;
}
