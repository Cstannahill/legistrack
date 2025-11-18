export const OPENROUTER_KEYS = [
  process.env.OPENROUTER_KEY_1,
  process.env.OPENROUTER_KEY_2,
].filter((value): value is string => Boolean(value));

const keyCooldowns: Record<string, number> = {};
let roundRobinIndex = 0;

const nowMs = () => Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function maskKey(key: string | undefined) {
  if (!key) return "(unset)";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function normalizeIndex(index: number): number {
  if (OPENROUTER_KEYS.length === 0) return 0;
  const normalized = index % OPENROUTER_KEYS.length;
  return normalized < 0 ? normalized + OPENROUTER_KEYS.length : normalized;
}

function keyReady(key: string) {
  return (keyCooldowns[key] ?? 0) <= nowMs();
}

export function markKeyCooldown(key: string, waitMs: number) {
  if (!key) return;
  const until = nowMs() + Math.max(waitMs, 0);
  keyCooldowns[key] = Math.max(keyCooldowns[key] ?? 0, until);
  console.warn(
    `[openrouter] Cooling down key ${maskKey(key)} for ${(waitMs / 1000).toFixed(1)}s`
  );
}

async function waitForNextWindow() {
  const nextAvailable = Math.min(
    ...OPENROUTER_KEYS.map((key) => keyCooldowns[key] ?? nowMs())
  );
  const delay = Math.max(0, nextAvailable - nowMs()) + 1000;
  console.warn(`[openrouter] All keys on cooldown. Sleeping ${delay}ms`);
  await sleep(delay);
}

export async function getApiKey(preferredIndex?: number): Promise<string> {
  if (OPENROUTER_KEYS.length === 0) {
    throw new Error("No OpenRouter API keys configured");
  }

  const indices: number[] = [];
  if (preferredIndex !== undefined) {
    indices.push(normalizeIndex(preferredIndex));
  }
  for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
    const idx = normalizeIndex(roundRobinIndex + i);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }

  for (const idx of indices) {
    const key = OPENROUTER_KEYS[idx]!;
    if (keyReady(key)) {
      roundRobinIndex = normalizeIndex(idx + 1);
      return key;
    }
  }

  await waitForNextWindow();
  return getApiKey(preferredIndex);
}
