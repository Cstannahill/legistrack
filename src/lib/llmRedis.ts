import Redis from "ioredis";

const REDIS_URL =
  process.env.REDIS_STORAGE_REDIS_URL ||
  process.env.VERCEL_REDIS_URL ||
  "redis://127.0.0.1:6379";

export const redis = new Redis(REDIS_URL);

// Keys and limits per OpenRouter key index
// Per-key limits expected to be provided via env: LLM_PER_MINUTE and LLM_PER_DAY
const PER_MINUTE = +(process.env.LLM_PER_MINUTE || "20");
const PER_DAY = +(process.env.LLM_PER_DAY || "50");

// Lua script to atomically reserve a slot for a given key index.
// KEYS: [minuteKey, dayKey]
// ARGV: [perMinuteLimit, perDayLimit, minuteTtlSeconds, dayTtlSeconds]
// Returns: 1 on success, 0 on failure
const RESERVE_LUA = `
local mkey = KEYS[1]
local dkey = KEYS[2]
local perMin = tonumber(ARGV[1])
local perDay = tonumber(ARGV[2])
local minTtl = tonumber(ARGV[3])
local dayTtl = tonumber(ARGV[4])

local m = tonumber(redis.call('GET', mkey) or '0')
if m + 1 > perMin then
  return 0
end
local d = tonumber(redis.call('GET', dkey) or '0')
if d + 1 > perDay then
  return 0
end

redis.call('INCR', mkey)
redis.call('INCR', dkey)
redis.call('EXPIRE', mkey, minTtl)
redis.call('EXPIRE', dkey, dayTtl)
return 1
`;

// Lua script to refund (decrement) counters if a reserved call failed and we need to rollback
const REFUND_LUA = `
local mkey = KEYS[1]
local dkey = KEYS[2]
local m = tonumber(redis.call('GET', mkey) or '0')
local d = tonumber(redis.call('GET', dkey) or '0')
if m > 0 then redis.call('DECR', mkey) end
if d > 0 then redis.call('DECR', dkey) end
return 1
`;

// Helper to compute key names
function minuteKeyFor(idx: number, minuteTs: number) {
  return `llm:key:${idx}:min:${minuteTs}`;
}
function dayKeyFor(idx: number, dayTs: string) {
  return `llm:key:${idx}:day:${dayTs}`;
}

// Reserve one slot for a specific OpenRouter key index. Returns true if reserved.
export async function reserveForKeyIndex(idx: number): Promise<boolean> {
  const now = Date.now();
  const minuteTs = Math.floor(now / 60000); // minute bucket
  const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

  const mkey = minuteKeyFor(idx, minuteTs);
  const dkey = dayKeyFor(idx, day);

  const minuteTtl = 70; // keep a bit longer than 60s
  const dayTtl = 60 * 60 * 24 * 2; // 2 days safety

  try {
    const res = await redis.eval(
      RESERVE_LUA,
      2,
      mkey,
      dkey,
      PER_MINUTE,
      PER_DAY,
      minuteTtl,
      dayTtl
    );
    return res === 1 || res === "1";
  } catch (e) {
    // On errors, be conservative and report false (no reservation)
    console.error("Redis reserve error", e);
    return false;
  }
}

// Refund a previously reserved slot (decrement counters)
export async function refundForKeyIndex(idx: number) {
  const now = Date.now();
  const minuteTs = Math.floor(now / 60000);
  const day = new Date(now).toISOString().slice(0, 10);

  const mkey = minuteKeyFor(idx, minuteTs);
  const dkey = dayKeyFor(idx, day);

  try {
    await redis.eval(REFUND_LUA, 2, mkey, dkey);
  } catch (e) {
    console.error("Redis refund error", e);
  }
}

// Simple queue helpers
const QUEUE_KEY = "llm:queue:v1";

export async function enqueuePayload(payload: object) {
  const item = JSON.stringify({ payload, createdAt: Date.now() });
  await redis.rpush(QUEUE_KEY, item);
}

export async function dequeueOne(): Promise<{
  payload: object;
  createdAt: number;
} | null> {
  const raw = await redis.lpop(QUEUE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.warn("Failed to parse queued item", raw, e);
    return null;
  }
}

export async function queueLength(): Promise<number> {
  return await redis.llen(QUEUE_KEY);
}

const exported = {
  redis,
  reserveForKeyIndex,
  refundForKeyIndex,
  enqueuePayload,
  dequeueOne,
  queueLength,
};

export default exported;
