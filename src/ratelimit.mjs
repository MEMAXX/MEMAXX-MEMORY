/**
 * Token-bucket rate limiter — per client IP, in-memory.
 *
 * Scope: MEMAXX is self-hosted and typically reachable only on localhost or
 * via Tailscale CGNAT. The rate limiter exists to protect against runaway
 * clients (an agent stuck in a loop), not hostile attackers — so the design
 * is intentionally simple: no Redis, no distributed coordination.
 *
 * Exempt ranges (never rate-limited):
 *   - 127.0.0.1 / ::1 (localhost)
 *   - 100.64.0.0/10  (Tailscale CGNAT — trusted private mesh)
 *   - Unix sockets / empty addresses
 *
 * Config (env):
 *   RATE_LIMIT_RPM        — requests per minute (default 120)
 *   RATE_LIMIT_BURST      — initial burst (default 30)
 *   RATE_LIMIT_DISABLED   — set to "1" to turn off entirely
 */

const RPM = parseInt(process.env.RATE_LIMIT_RPM || "120", 10);
const BURST = parseInt(process.env.RATE_LIMIT_BURST || "30", 10);
const DISABLED = process.env.RATE_LIMIT_DISABLED === "1";

const REFILL_PER_MS = RPM / 60 / 1000; // tokens added per millisecond
const buckets = new Map();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // drop idle buckets every 10 min
const IDLE_MS = 30 * 60 * 1000;

if (!DISABLED) {
  setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const [ip, bucket] of buckets) {
      if (bucket.lastRefill < cutoff) buckets.delete(ip);
    }
  }, SWEEP_INTERVAL_MS).unref?.();
}

/**
 * Extract the client IP, handling IPv6-mapped IPv4 and x-forwarded-for
 * (only trusted when explicitly enabled via TRUST_PROXY env).
 */
export function clientIp(req) {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  const raw = req.socket?.remoteAddress || "";
  // Strip IPv6-mapped IPv4 prefix: "::ffff:192.0.2.1" → "192.0.2.1"
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

/**
 * True if the given IP is in a trusted range and should never be limited.
 */
export function isExempt(ip) {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  // Tailscale CGNAT: 100.64.0.0/10 = 100.64.x.x through 100.127.x.x
  const m = ip.match(/^100\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 64 && second <= 127) return true;
  }
  return false;
}

/**
 * Consume one token. Returns { allowed, retryAfter }.
 * retryAfter is in seconds (integer) when allowed=false.
 */
export function consume(ip) {
  if (DISABLED || isExempt(ip)) return { allowed: true, retryAfter: 0 };

  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: BURST, lastRefill: now };
    buckets.set(ip, b);
  }

  // Refill based on elapsed time
  const elapsed = now - b.lastRefill;
  b.tokens = Math.min(BURST, b.tokens + elapsed * REFILL_PER_MS);
  b.lastRefill = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfter: 0 };
  }

  // Not enough tokens — compute wait time until 1 token is available
  const needed = 1 - b.tokens;
  const waitMs = Math.ceil(needed / REFILL_PER_MS);
  return { allowed: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
}

/** Test helper — clear all buckets. */
export function _resetBuckets() { buckets.clear(); }

export const _config = { RPM, BURST, DISABLED };
