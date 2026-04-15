/**
 * getProjectHash — priority resolution:
 *   1. explicit project_id from MCP caller (takes precedence over everything)
 *   2. djb2(git_remote)  — deterministic cross-machine identity
 *   3. djb2(project_root) — fallback for local/uncommitted projects
 *
 * This is the function that decides WHICH project a memory belongs to.
 * Getting it wrong = memories scattered across fake projects (March 19 bug).
 */

import { describe, it, expect } from "vitest";
import { getProjectHash, djb2Hash } from "../../src/tools.mjs";

describe("getProjectHash priority", () => {
  it("explicit project_id wins over everything", () => {
    const result = getProjectHash({
      project_id: "my-custom-id",
      git_remote: "https://github.com/foo/bar.git",
      project_root: "/a/b/c",
    });
    expect(result).toBe("my-custom-id");
  });

  it("falls back to git_remote djb2 when no project_id", () => {
    const url = "https://github.com/MEMAXX/MEMAXX-MEMORY.git";
    expect(getProjectHash({ git_remote: url })).toBe(djb2Hash(url));
  });

  it("git_remote with trailing whitespace is trimmed", () => {
    const url = "https://github.com/foo/bar.git";
    expect(getProjectHash({ git_remote: "  " + url + "\n" })).toBe(djb2Hash(url));
  });

  it("ignores empty/whitespace git_remote", () => {
    const result = getProjectHash({
      git_remote: "   ",
      project_root: "/my/path",
    });
    expect(result).toBe(djb2Hash("/my/path"));
  });

  it("falls back to project_root djb2 when no git_remote", () => {
    const root = "/Users/lucius/Documents/builds/memaxx";
    expect(getProjectHash({ project_root: root })).toBe(djb2Hash(root));
  });

  it("falls back to process.cwd() when no args given", () => {
    const result = getProjectHash({});
    expect(result).toBe(djb2Hash(process.cwd()));
  });

  it("handles null/undefined args", () => {
    expect(() => getProjectHash(null)).not.toThrow();
    expect(() => getProjectHash(undefined)).not.toThrow();
  });

  it("same project_root always returns the same hash (regression)", () => {
    const args = { project_root: "/Users/lucius/Documents/builds/memaxx" };
    const a = getProjectHash(args);
    const b = getProjectHash(args);
    const c = getProjectHash(args);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
