/**
 * Utilities for formatting summary text with markdown-style bold
 */

/**
 * Converts markdown bold syntax (**text**) to React-friendly format
 * Returns an array of text segments with bold indicators
 */
export function parseMarkdownBold(
  text: string
): Array<{ text: string; bold: boolean }> {
  const segments: Array<{ text: string; bold: boolean }> = [];
  const regex = /\*\*(.+?)\*\*/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the bold section
    if (match.index > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, match.index),
        bold: false,
      });
    }

    // Add the bold section
    segments.push({
      text: match[1],
      bold: true,
    });

    lastIndex = regex.lastIndex;
  }

  // Add remaining text after the last bold section
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      bold: false,
    });
  }

  // If no bold sections were found, return the original text
  if (segments.length === 0) {
    segments.push({
      text: text,
      bold: false,
    });
  }

  return segments;
}

/**
 * Check if text contains any markdown bold syntax
 */
export function hasMarkdownBold(text: string): boolean {
  return /\*\*(.+?)\*\*/.test(text);
}
