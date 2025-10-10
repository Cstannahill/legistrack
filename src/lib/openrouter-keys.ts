// lib/openrouter-keys.ts
const MAX_INDEXED_KEYS = 10;

function visibleKeyNames(envObj: NodeJS.ProcessEnv) {
  return Object.keys(envObj).filter((k) => k.includes("OPENROUTER_API_KEY"));
}

function parseCommaSeparatedKeys(val?: string | null) {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getOpenRouterKeys(): string[] {
  // 1) Prefer single comma-separated env var (easier to manage in Vercel UI)
  const csv = process.env.OPENROUTER_API_KEYS;
  const csvKeys = parseCommaSeparatedKeys(csv);
  if (csvKeys.length > 0) {
    console.log(
      `[OPENROUTER] Using ${csvKeys.length} key(s) from OPENROUTER_API_KEYS`
    );
    return csvKeys;
  }

  // 2) Fallback to numbered keys OPENROUTER_API_KEY_1..N
  const numbered: string[] = [];
  for (let i = 1; i <= MAX_INDEXED_KEYS; i++) {
    const v = process.env[`OPENROUTER_API_KEY_${i}`];
    if (v) numbered.push(v.trim());
  }
  if (numbered.length > 0) {
    console.log(
      `[OPENROUTER] Using ${numbered.length} key(s) from OPENROUTER_API_KEY_<N>`
    );
    return numbered;
  }

  // 3) Nothing found — log visible names (no secret values)
  console.warn(
    "[OPENROUTER] No keys found. Visible env keys that mention OPENROUTER_API_KEY:",
    visibleKeyNames(process.env)
  );
  throw new Error(
    "No OpenRouter API keys found in runtime env. Ensure OPENROUTER_API_KEYS or OPENROUTER_API_KEY_1..N are configured and exposed to the function runtime."
  );
}
