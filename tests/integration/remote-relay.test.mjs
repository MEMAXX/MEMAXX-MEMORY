/**
 * Remote WebSocket relay — regression test for the "Buffer→String" bug.
 *
 * Producer sends JSON text frames, relay forwards to viewers as text,
 * viewer's JSON.parse() must succeed. If the relay sends binary frames,
 * browsers receive a Blob and silently fail to parse → "Connecting..." forever.
 *
 * REQUIRES: Memory server at localhost:3100, ws npm package
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";

const WS_URL = (process.env.MEMAXX_TEST_URL || "http://localhost:3100")
  .replace(/^http/, "ws") + "/remote/ws";

/**
 * Connect + attach a message buffer BEFORE resolving.
 * Prevents race where session:info arrives before caller attaches a listener.
 * Returns an augmented WebSocket with `_buffer` array of {msg, isBinary}.
 */
function connect(role, mode = "readonly") {
  const q = `?role=${role}` + (role === "producer" ? `&mode=${mode}&device=test-${role}` : "");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + q);
    ws._buffer = [];
    ws._replaced = false;
    ws.on("message", (data, isBinary) => {
      try {
        const msg = JSON.parse(data.toString());
        ws._buffer.push({ msg, isBinary });
      } catch { /* ignore parse errors */ }
    });
    ws.on("close", (code, reason) => {
      const r = (reason && reason.toString()) || "";
      if (code === 1000 && r === "replaced") ws._replaced = true;
    });
    const timer = setTimeout(() => { ws.close(); reject(new Error("connect timeout")); }, 3000);
    ws.once("open", () => { clearTimeout(timer); resolve(ws); });
    ws.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Wait for a message matching the predicate. Checks the buffer first
 * (catches messages that arrived before this call) and then polls every 20ms.
 */
function waitMessage(ws, predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    // Already in buffer?
    const hit = ws._buffer.find(({ msg }) => predicate(msg));
    if (hit) { resolve(hit); return; }

    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error("message timeout")); }
    }, timeout);
    const poll = setInterval(() => {
      const h = ws._buffer.find(({ msg }) => predicate(msg));
      if (h && !done) {
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve(h);
      }
    }, 20);
  });
}

describe("Remote WebSocket relay", () => {
  beforeAll(async () => {
    const res = await fetch((process.env.MEMAXX_TEST_URL || "http://localhost:3100") + "/health");
    if (!res.ok) throw new Error("Memory server not running");
  });

  it("viewer receives session:info on connect (as text frame)", async () => {
    const viewer = await connect("viewer");
    try {
      const { msg, isBinary } = await waitMessage(viewer, (m) => m.event === "session:info");
      expect(msg.event).toBe("session:info");
      expect(msg).toHaveProperty("active");
      expect(msg).toHaveProperty("mode");
      // Binary framing would indicate the Buffer→String relay bug regressed
      expect(isBinary).toBeFalsy();
    } finally {
      viewer.close();
    }
  });

  it("producer → viewer message is relayed as text (not binary)", async () => {
    // Connect producer FIRST so session is active, then viewer can observe
    const producer = await connect("producer", "interactive");
    await new Promise((r) => setTimeout(r, 100));

    // Soft-skip if an external producer (e.g. live desktop app) took over
    const BASE_URL = process.env.MEMAXX_TEST_URL || "http://localhost:3100";
    const s = await (await fetch(BASE_URL + "/api/remote/session")).json();
    if (!s.active || s.device !== "test-producer") {
      producer.close();
      console.warn("[test] skipping: competing producer, device =", s.device);
      return;
    }

    const viewer = await connect("viewer");

    try {
      await waitMessage(viewer, (m) => m.event === "session:info");
      await new Promise((r) => setTimeout(r, 150));

      if (producer._replaced || producer.readyState !== 1) {
        console.warn("[test] skipping: producer was replaced");
        return;
      }

      const metaPromise = waitMessage(
        viewer,
        (m) => m.event === "terminal:meta" && m.payload?.panes?.length === 0,
        3000
      );

      producer.send(JSON.stringify({
        event: "terminal:meta",
        ts: Date.now(),
        payload: { panes: [], workspaces: [], activeWorkspaceId: null },
      }));

      const { msg, isBinary } = await metaPromise;
      expect(msg.event).toBe("terminal:meta");
      expect(Array.isArray(msg.payload.panes)).toBe(true);
      expect(isBinary).toBeFalsy();
    } finally {
      producer.close();
      viewer.close();
    }
  });

  it("GET /api/remote/session reports producer connected", async () => {
    const producer = await connect("producer", "interactive");
    try {
      // Give the server a moment to register
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(
        (process.env.MEMAXX_TEST_URL || "http://localhost:3100") + "/api/remote/session"
      );
      const session = await res.json();
      expect(session.active).toBe(true);
      expect(session.mode).toBe("interactive");
    } finally {
      producer.close();
    }
  });
});
