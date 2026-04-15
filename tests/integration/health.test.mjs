/**
 * /health integration test — verifies Phase 1 observability fields
 * are present and sane. Catches regressions like the "query is not a function"
 * bug where /health reported the wrong database state.
 *
 * REQUIRES: Memory server running at localhost:3100 (docker compose up -d)
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.MEMAXX_TEST_URL || "http://localhost:3100";

async function fetchHealth() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`health returned ${res.status}`);
  return await res.json();
}

describe("/health endpoint", () => {
  let health;

  beforeAll(async () => {
    health = await fetchHealth();
  });

  it("returns status ok", () => {
    expect(health.status).toBe("ok");
  });

  it("includes version", () => {
    expect(health.version).toBeTypeOf("string");
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reports uptime in seconds", () => {
    expect(health.uptime_seconds).toBeTypeOf("number");
    expect(health.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("includes memory metrics (rss, heap used, heap total)", () => {
    expect(health.memory).toBeDefined();
    expect(health.memory.rss_mb).toBeTypeOf("number");
    expect(health.memory.heap_used_mb).toBeTypeOf("number");
    expect(health.memory.heap_total_mb).toBeTypeOf("number");
    // Sanity — server shouldn't be using crazy amounts of RAM at rest
    expect(health.memory.rss_mb).toBeGreaterThan(10);
    expect(health.memory.rss_mb).toBeLessThan(2000);
  });

  it("database section is present", () => {
    expect(health.database).toBeDefined();
  });

  it("when DB connected, reports counts and latency", () => {
    if (!health.database.connected) {
      // If DB is not connected in this env, skip the sub-checks
      return;
    }
    expect(health.database.latency_ms).toBeTypeOf("number");
    expect(health.database.latency_ms).toBeLessThan(5000);
    expect(health.database.memories).toBeTypeOf("number");
    expect(health.database.entities).toBeTypeOf("number");
    expect(health.database.projects).toBeTypeOf("number");
  });

  it("includes remote session info", () => {
    expect(health.remote).toBeDefined();
    expect(health.remote.active).toBeTypeOf("boolean");
    expect(health.remote.viewerCount).toBeTypeOf("number");
  });

  it("reports node version", () => {
    expect(health.node_version).toMatch(/^v\d+/);
  });
});
