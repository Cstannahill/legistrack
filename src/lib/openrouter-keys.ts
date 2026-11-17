// lib/openrouter-keys.ts
const MAX_INDEXED_KEYS = 10;

function visibleKeyNames(envObj: Partial<NodeJS.ProcessEnv>): string[] {
  return Object.keys(envObj).filter((k) => /OPENROUTER_(?:API_)?KEY/.test(k));
}

function parseCommaSeparatedKeys(val?: string | null): string[] {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Loads and deduplicates OpenRouter API keys across supported env formats:
 * `OPENROUTER_API_KEYS` (CSV), `OPENROUTER_API_KEY_1..10`, and `OPENROUTER_KEY_1..10`.
 * Preserves first-seen order and returns `[]` (with a warning) instead of throwing when empty.
 */
export function getOpenRouterKeys(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): string[] {
  const seen = new Set<string>();

  for (const key of parseCommaSeparatedKeys(envObj.OPENROUTER_API_KEYS)) {
    seen.add(key);
  }

  for (let i = 1; i <= MAX_INDEXED_KEYS; i++) {
    const apiKey = envObj[`OPENROUTER_API_KEY_${i}`]?.trim();
    if (apiKey) {
      seen.add(apiKey);
    }
  }

  for (let i = 1; i <= MAX_INDEXED_KEYS; i++) {
    const shortKey = envObj[`OPENROUTER_KEY_${i}`]?.trim();
    if (shortKey) {
      seen.add(shortKey);
    }
  }

  const keys = Array.from(seen);
  if (keys.length === 0) {
    console.warn(
      "[OPENROUTER] No keys found. Visible env keys mentioning OPENROUTER:",
      visibleKeyNames(envObj)
    );
  }

  return keys;
}
