// Simple in-process count caching to avoid repetitive heavy COUNT(*) queries on hot paths.
// For production scale, replace with Redis / KV store and incorporate invalidation via events.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<number>>();

export function getCachedCount(key: string): number | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCachedCount(
  key: string,
  value: number,
  ttlMs: number
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function cachedCount(
  key: string,
  ttlMs: number,
  fn: () => Promise<number>
): Promise<number> {
  const existing = getCachedCount(key);
  if (existing !== undefined) return existing;
  const value = await fn();
  setCachedCount(key, value, ttlMs);
  return value;
}

// Helper for invalidation when data import jobs run.
export function invalidateCount(keyPrefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(keyPrefix)) store.delete(key);
  }
}
