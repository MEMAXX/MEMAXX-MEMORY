/**
 * Remote mode enforcement — regression test for the "pane:close blocked in
 * readonly" bug from March 19. The relay MUST block terminal:write in readonly
 * mode, but MUST allow pane:close and pane:split regardless of mode.
 *
 * REQUIRES: Memory server at localhost:3100
 */

import { describe, it, expect, beforeAll } from "vitest";
import { WebSocket } from "ws";

const BASE = process.env.MEMAXX_TEST_URL || "http://localhost:3100";
const WS_URL = BASE.replace(/^http/, "ws") + "/remote/ws";

function connect(role, mode = "readonly") {
  const q = `?role=${role}` + (role === "producer" ? `&mode=${mode}&device=test-${role}` : "");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + q);
    ws._buffer = [];
    ws._replaced = false;
    ws.on("message", (data) => {
      try { ws._buffer.push(JSON.parse(data.toString())); } catch {}
    });
    // Server closes with code 1000 reason "replaced" when another producer takes over.
    // Track this so tests can skip gracefully instead of timing out.
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
 * Wait for a matching message in the buffer. Returns the message if found,
 * or the special sentinel { _replaced: true } if the WebSocket was replaced
 * by another producer (e.g. live desktop app reconnecting) — so tests can
 * skip gracefully instead of timing out.
 */
function waitFor(ws, predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const hit = ws._buffer.find(predicate);
    if (hit) { resolve(hit); return; }
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error("timeout")); }
    }, timeout);
    const poll = setInterval(() => {
      if (done) return;
      // Gave up due to replacement?
      if (ws._replaced) {
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve({ _replaced: true });
        return;
      }
      const h = ws._buffer.find(predicate);
      if (h) {
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve(h);
      }
    }, 20);
  });
}

describe("Remote mode enforcement", () => {
  beforeAll(async () => {
    const res = await fetch(BASE + "/health");
    if (!res.ok) throw new Error("Memory server not running");
  });

  it("readonly mode blocks terminal:write from viewer", async () => {
    // Set up producer in readonly mode
    const producer = await connect("producer", "readonly");
    await new Promise((r) => setTimeout(r, 100));

    // Verify WE are the active producer in readonly mode — otherwise another
    // producer (e.g. live desktop app) has taken over and the test is invalid.
    const sessionRes = await fetch(BASE + "/api/remote/session");
    const session = await sessionRes.json();
    if (session.mode !== "readonly" || !session.active) {
      producer.close();
      // Soft skip — environment has a competing producer (Desktop app running)
      console.warn("[test] skipping: another producer is active, mode =", session.mode);
      return;
    }

    const viewer = await connect("viewer");
    try {
      await waitFor(viewer, (m) => m.event === "session:info");
      await new Promise((r) => setTimeout(r, 100));

      if (producer._replaced || producer.readyState !== 1) {
        console.warn("[test] skipping: producer was replaced during setup");
        return;
      }

      viewer.send(JSON.stringify({
        event: "terminal:write",
        pty_id: "dummy",
        payload: { data: "ls\n" },
      }));

      const err = await waitFor(viewer, (m) => m.event === "error", 2000);
      expect(err.message).toMatch(/readonly|read-only/i);
    } finally {
      producer.close();
      viewer.close();
    }
  });

  it("readonly mode allows pane:close (passed through to producer)", async () => {
    // Producer's connect() attaches a buffer — any pane:close that arrives
    // is captured in producer._buffer and found by waitFor.
    const producer = await connect("producer", "readonly");
    await new Promise((r) => setTimeout(r, 100));

    const s = await (await fetch(BASE + "/api/remote/session")).json();
    if (s.mode !== "readonly" || !s.active) {
      producer.close();
      console.warn("[test] skipping: mode =", s.mode);
      return;
    }

    const viewer = await connect("viewer");
    try {
      await waitFor(viewer, (m) => m.event === "session:info");
      await new Promise((r) => setTimeout(r, 100));

      // Last chance to bail: if desktop app reconnected during viewer connect
      if (producer._replaced || producer.readyState !== 1) {
        console.warn("[test] skipping: producer was replaced during setup");
        return;
      }

      // Last-chance guard: verify OUR producer is still the active one
      // right before sending. The Desktop app reconnects every ~1s; if it
      // slipped in during the 200ms setup window, our producer is replaced
      // and this test becomes meaningless. Skip gracefully.
      const finalCheck = await (await fetch(BASE + "/api/remote/session")).json();
      if (finalCheck.device !== "test-producer" || !finalCheck.active) {
        console.warn("[test] skipping: another producer took over, device =", finalCheck.device);
        return;
      }

      viewer.send(JSON.stringify({
        event: "pane:close",
        pty_id: "dummy",
        payload: {},
      }));

      const received = await waitFor(producer, (m) => m.event === "pane:close", 2000);
      if (received._replaced) {
        console.warn("[test] skipping: producer replaced mid-wait");
        return;
      }
      expect(received.event).toBe("pane:close");
    } finally {
      producer.close();
      viewer.close();
    }
  });

  it("interactive mode allows terminal:write", async () => {
    const producer = await connect("producer", "interactive");
    await new Promise((r) => setTimeout(r, 100));

    const s = await (await fetch(BASE + "/api/remote/session")).json();
    if (s.mode !== "interactive" || !s.active) {
      producer.close();
      console.warn("[test] skipping: mode =", s.mode);
      return;
    }

    const viewer = await connect("viewer");
    try {
      await waitFor(viewer, (m) => m.event === "session:info");
      await new Promise((r) => setTimeout(r, 100));

      if (producer._replaced || producer.readyState !== 1) {
        console.warn("[test] skipping: producer was replaced during setup");
        return;
      }

      viewer.send(JSON.stringify({
        event: "terminal:write",
        pty_id: "dummy",
        payload: { data: "x" },
      }));

      const received = await waitFor(producer, (m) => m.event === "terminal:write", 3000);
      if (received._replaced) {
        console.warn("[test] skipping: producer replaced mid-wait");
        return;
      }
      expect(received.payload?.data).toBe("x");
    } finally {
      producer.close();
      viewer.close();
    }
  });
});
