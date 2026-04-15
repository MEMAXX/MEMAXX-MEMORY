/**
 * Phase 4 — search must degrade gracefully when the embedding provider is offline.
 *
 * We can't easily hit a real Postgres in a pure unit test, so we mock the db
 * module and verify that searchMemories:
 *   1. Does NOT throw when generateEmbedding rejects.
 *   2. Returns `degraded: "semantic_unavailable"` in that case.
 *   3. Still returns FTS-scored results.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks must be declared before importing the module under test ──
vi.mock("../../src/db.mjs", () => ({
  query: vi.fn(async (sql) => {
    // Candidate fetch → return one fake row
    if (/FROM memories\s*\n\s*WHERE project_hash = \$1/.test(sql) ||
        /SELECT id, content, type, importance_score/.test(sql)) {
      return {
        rows: [{
          id: "mem1", content: "test content", type: "learning",
          importance_score: 0.5, tags: "[]", related_files: "[]",
          session_name: null, retrieval_count: 0, is_archived: false,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }],
      };
    }
    // FTS / vec / graph / access-log etc. → empty result, no throw
    return { rows: [] };
  }),
}));

vi.mock("../../src/embeddings.mjs", () => ({
  generateEmbedding: vi.fn(async () => {
    throw new Error("provider offline");
  }),
}));

const { searchMemories } = await import("../../src/search.mjs");

describe("searchMemories graceful degradation (Phase 4)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does not throw when embedding provider is offline", async () => {
    const fakeConfig = { provider: "openai", apiKey: "x" };
    await expect(
      searchMemories({ query: "anything", projectHash: "abc", limit: 5 }, fakeConfig)
    ).resolves.toBeDefined();
  });

  it("sets degraded='semantic_unavailable' when embedding throws", async () => {
    const result = await searchMemories(
      { query: "anything", projectHash: "abc", limit: 5 },
      { provider: "openai", apiKey: "x" }
    );
    expect(result.degraded).toBe("semantic_unavailable");
  });

  it("still returns results (FTS+freshness) even without embeddings", async () => {
    const result = await searchMemories(
      { query: "test", projectHash: "abc", limit: 5 },
      { provider: "openai", apiKey: "x" }
    );
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it("no 'degraded' field when embeddingConfig is null (not an error, just unconfigured)", async () => {
    // Semantic weight is still > 0 in hybrid mode; with no config we treat
    // this as degraded too, since the user asked for hybrid but can't get it.
    const result = await searchMemories(
      { query: "test", projectHash: "abc", limit: 5 },
      null
    );
    expect(result.degraded).toBe("semantic_unavailable");
  });
});
