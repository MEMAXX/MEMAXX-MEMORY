/**
 * REST memories API — smoke test for the CRUD flow used by the desktop app.
 * Creates a test project, writes a memory, lists it, deletes it, verifies gone.
 *
 * Uses a dedicated project hash so it doesn't pollute real project memories.
 *
 * REQUIRES: Memory server running at localhost:3100
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.MEMAXX_TEST_URL || "http://localhost:3100";
const TEST_PROJECT = "zzz_test_" + Math.random().toString(36).slice(2, 8);

async function api(path, init = {}) {
  const url = path.includes("?") ? `${BASE}${path}` : `${BASE}${path}?project=${TEST_PROJECT}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

async function cleanup() {
  // Best effort — list and delete all test memories
  try {
    const { body } = await api("/api/memories");
    if (body?.memories) {
      for (const m of body.memories) {
        await api(`/api/memories/${m.id}`, { method: "DELETE" });
      }
    }
  } catch {}
}

describe("REST /api/memories CRUD", () => {
  beforeAll(async () => {
    // Verify server is up before running tests
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error("Memory server not running on " + BASE);
    await cleanup();
  });

  afterAll(async () => { await cleanup(); });

  it("POST /api/memories creates a new memory", async () => {
    const { status, body } = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "Test memory from smoke test suite — verifying REST CRUD flow works end-to-end.",
        type: "learning",
        tags: ["test", "smoke"],
        importance_score: 0.5,
      }),
    });
    expect(status).toBe(200);
    expect(body).toBeDefined();
    expect(body.id).toBeTypeOf("string");
    expect(body.id.length).toBeGreaterThan(0);
  });

  it("GET /api/memories lists the created memory", async () => {
    const { status, body } = await api("/api/memories");
    expect(status).toBe(200);
    expect(body.memories).toBeInstanceOf(Array);
    expect(body.memories.length).toBeGreaterThan(0);
    const ours = body.memories.find((m) => m.content?.includes("smoke test suite"));
    expect(ours).toBeDefined();
  });

  it("POST same content twice → deduplicates (same id)", async () => {
    const payload = {
      content: "Dedup test — this exact content should only produce one memory even on repeated POST.",
      type: "learning",
    };
    const first = await api("/api/memories", { method: "POST", body: JSON.stringify(payload) });
    const second = await api("/api/memories", { method: "POST", body: JSON.stringify(payload) });
    expect(first.body.id).toBe(second.body.id);
    // Second call should have deduplicated flag
    expect(second.body.deduplicated).toBe(true);
  });

  it("DELETE /api/memories/:id archives the memory", async () => {
    // Create a fresh one
    const created = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "Memory to be deleted in this test — should disappear from list after DELETE.",
        type: "learning",
      }),
    });
    const id = created.body.id;
    expect(id).toBeTypeOf("string");

    // Delete
    const del = await api(`/api/memories/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    // Verify it's gone from list
    const list = await api("/api/memories");
    const stillThere = list.body.memories.find((m) => m.id === id);
    expect(stillThere).toBeUndefined();
  });

  it("POST rejects too-short content", async () => {
    const { body } = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content: "too short", type: "learning" }),
    });
    expect(body.error).toMatch(/too short|min/i);
  });
});
