/**
 * djb2Hash — regression tests against the "8 random project hashes" bug
 * from the March 19 session. The same input path MUST always produce the
 * same hash — across restarts, across Docker rebuilds, across machines.
 */

import { describe, it, expect } from "vitest";
import { djb2Hash } from "../../src/tools.mjs";

describe("djb2Hash", () => {
  it("produces the same hash for the same path", () => {
    const a = djb2Hash("/Users/lucius/Documents/builds/memaxx");
    const b = djb2Hash("/Users/lucius/Documents/builds/memaxx");
    expect(a).toBe(b);
  });

  it("produces different hashes for different paths", () => {
    const a = djb2Hash("/a/b/c");
    const b = djb2Hash("/a/b/d");
    expect(a).not.toBe(b);
  });

  it("normalizes trailing slashes", () => {
    expect(djb2Hash("/a/b/")).toBe(djb2Hash("/a/b"));
    expect(djb2Hash("/a/b//")).toBe(djb2Hash("/a/b"));
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    expect(djb2Hash("C:\\Users\\x")).toBe(djb2Hash("C:/Users/x"));
  });

  it("returns a base-36 alphanumeric string", () => {
    const h = djb2Hash("/some/path");
    expect(h).toMatch(/^[a-z0-9]+$/);
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThan(15);
  });

  it("handles empty string without crashing", () => {
    // DJB2 with empty input returns djb2(seed=5381) → "45h" in base36.
    // This is deterministic and stable — we pin it to catch accidental
    // algorithm changes.
    expect(() => djb2Hash("")).not.toThrow();
    expect(djb2Hash("")).toBe("45h");
  });

  it("handles very long paths", () => {
    const long = "/a".repeat(500);
    expect(() => djb2Hash(long)).not.toThrow();
    expect(djb2Hash(long)).toBe(djb2Hash(long));
  });

  it("regression: /Users/lucius/Documents/builds/memaxx stays 'hiiszg'", () => {
    // Pinned value — if the DJB2 algorithm is ever changed accidentally,
    // this fails loudly. Cross-machine project identity depends on this.
    expect(djb2Hash("/Users/lucius/Documents/builds/memaxx")).toBe("hiiszg");
  });
});
