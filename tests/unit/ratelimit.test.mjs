/**
 * Token-bucket rate limiter unit tests.
 *
 * Covers: exempt ranges, bucket exhaustion, 429 retry-after, IPv6-mapped IPv4.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { consume, clientIp, isExempt, _resetBuckets, _config } from "../../src/ratelimit.mjs";

describe("ratelimit.isExempt", () => {
  it("exempts localhost variants", () => {
    expect(isExempt("127.0.0.1")).toBe(true);
    expect(isExempt("::1")).toBe(true);
    expect(isExempt("localhost")).toBe(true);
  });

  it("exempts Tailscale CGNAT 100.64.0.0/10", () => {
    expect(isExempt("100.64.0.1")).toBe(true);
    expect(isExempt("100.100.50.77")).toBe(true);
    expect(isExempt("100.127.255.254")).toBe(true);
  });

  it("does NOT exempt 100.x outside CGNAT range", () => {
    expect(isExempt("100.63.0.1")).toBe(false); // one below 100.64
    expect(isExempt("100.128.0.1")).toBe(false); // one above 100.127
  });

  it("does NOT exempt public IPs", () => {
    expect(isExempt("8.8.8.8")).toBe(false);
    expect(isExempt("192.0.2.1")).toBe(false);
  });

  it("exempts missing/empty addresses (defensive default)", () => {
    expect(isExempt("")).toBe(true);
    expect(isExempt(undefined)).toBe(true);
  });
});

describe("ratelimit.clientIp", () => {
  it("strips IPv6-mapped IPv4 prefix", () => {
    const req = { socket: { remoteAddress: "::ffff:192.0.2.1" }, headers: {} };
    expect(clientIp(req)).toBe("192.0.2.1");
  });

  it("returns raw address for non-mapped IPs", () => {
    const req = { socket: { remoteAddress: "10.0.0.5" }, headers: {} };
    expect(clientIp(req)).toBe("10.0.0.5");
  });

  it("ignores X-Forwarded-For when TRUST_PROXY is unset", () => {
    const req = { socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "1.2.3.4" } };
    expect(clientIp(req)).toBe("10.0.0.1");
  });
});

describe("ratelimit.consume", () => {
  beforeEach(() => { _resetBuckets(); });

  it("allows traffic from exempt IPs without consuming tokens", () => {
    for (let i = 0; i < 1000; i++) {
      expect(consume("127.0.0.1").allowed).toBe(true);
    }
  });

  it("allows a burst up to BURST size for a non-exempt IP", () => {
    const results = [];
    for (let i = 0; i < _config.BURST; i++) {
      results.push(consume("8.8.8.8").allowed);
    }
    expect(results.every(Boolean)).toBe(true);
  });

  it("blocks the request after burst is exhausted and returns retry_after", () => {
    // Exhaust the burst
    for (let i = 0; i < _config.BURST; i++) consume("8.8.4.4");
    const blocked = consume("8.8.4.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(Number.isInteger(blocked.retryAfter)).toBe(true);
  });

  it("separates buckets per IP", () => {
    for (let i = 0; i < _config.BURST; i++) consume("1.1.1.1");
    // 1.1.1.1 is exhausted, but 2.2.2.2 is fresh
    expect(consume("1.1.1.1").allowed).toBe(false);
    expect(consume("2.2.2.2").allowed).toBe(true);
  });
});
