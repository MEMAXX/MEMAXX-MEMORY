/**
 * contentHash — memory deduplication depends on this being stable and
 * collision-free for different content. Used in the (project_hash, content_hash)
 * UNIQUE index that prevents duplicate memories.
 */

import { describe, it, expect } from "vitest";
import { contentHash } from "../../src/db.mjs";

describe("contentHash", () => {
  it("produces the same hash for identical content", () => {
    const content = "Fixed bug in useEffect cleanup. The subscription leaked.";
    expect(contentHash(content)).toBe(contentHash(content));
  });

  it("produces different hashes for slightly different content", () => {
    const a = contentHash("Hello world");
    const b = contentHash("Hello World");
    expect(a).not.toBe(b);
  });

  it("produces different hashes for empty vs space", () => {
    expect(contentHash("")).not.toBe(contentHash(" "));
  });

  it("is whitespace-sensitive (leading/trailing matters)", () => {
    expect(contentHash("foo")).not.toBe(contentHash(" foo"));
    expect(contentHash("foo")).not.toBe(contentHash("foo "));
  });

  it("returns a non-empty base-36 string", () => {
    const h = contentHash("arbitrary content");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
    expect(h).toMatch(/^[a-z0-9]+$/);
  });

  it("handles unicode / emoji content", () => {
    const content = "Fix: 🐛 emoji in terminal — works now ✅";
    expect(() => contentHash(content)).not.toThrow();
    expect(contentHash(content)).toBe(contentHash(content));
  });
});
