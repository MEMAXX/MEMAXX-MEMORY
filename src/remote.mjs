/**
 * Remote Terminal — WebSocket relay for selfhosted terminal streaming.
 * Replaces Supabase Realtime with a direct WebSocket server.
 *
 * Architecture:
 *   Desktop App (producer) ←→ WebSocket Server ←→ Phone/Browser (viewers)
 *
 * The Memory Server acts as the relay — no cloud, no third-party services.
 */

import { WebSocketServer } from "ws";
import { childLog } from "./log.mjs";

const rlog = childLog("remote");

/** @type {{ producer: WebSocket|null, viewers: Set<WebSocket>, mode: string, deviceName: string|null, startedAt: string|null }} */
const session = {
  producer: null,
  viewers: new Set(),
  mode: "readonly",
  deviceName: null,
  startedAt: null,
};

/**
 * Attach WebSocket upgrade handler to an existing HTTP server.
 * @param {import('http').Server} server
 */
export function attachRemoteTerminal(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/remote/ws") {
      socket.destroy();
      return;
    }

    // Auth check (optional AUTH_TOKEN)
    const authToken = process.env.AUTH_TOKEN;
    if (authToken) {
      const token = url.searchParams.get("token") || req.headers.authorization?.replace("Bearer ", "");
      if (token !== authToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const role = url.searchParams.get("role") || "viewer";
      handleConnection(ws, role, url.searchParams);
    });
  });

  log("Remote terminal WebSocket ready at /remote/ws");
}

/**
 * Handle a new WebSocket connection.
 * @param {WebSocket} ws
 * @param {string} role - "producer" or "viewer"
 * @param {URLSearchParams} params
 */
function handleConnection(ws, role, params) {
  if (role === "producer") {
    // Only one producer at a time
    if (session.producer) {
      try { session.producer.close(1000, "replaced"); } catch {}
    }
    session.producer = ws;
    session.mode = params.get("mode") || "readonly";
    session.deviceName = params.get("device") || "Desktop";
    session.startedAt = new Date().toISOString();
    log(`Producer connected: ${session.deviceName} (${session.mode} mode)`);

    // Notify all viewers of producer connection
    broadcast(session.viewers, { event: "session:start", mode: session.mode, device: session.deviceName });

    ws.on("message", (data, isBinary) => {
      // Relay producer broadcasts to all viewers as text
      const msg = isBinary ? data : data.toString();
      for (const viewer of session.viewers) {
        if (viewer.readyState === 1) {
          viewer.send(msg);
        }
      }
    });

    ws.on("close", () => {
      // Only clear session state if THIS ws is still the active producer.
      // During producer replacement, the old ws.on("close") fires AFTER
      // session.producer was already reassigned to the new one — we must
      // not wipe the new producer's state.
      if (session.producer === ws) {
        log("Producer disconnected");
        session.producer = null;
        session.startedAt = null;
        session.deviceName = null;
        broadcast(session.viewers, { event: "session:end" });
      }
    });

    ws.on("error", (err) => rlog.error({ err, role: "producer" }, "websocket error"));

  } else {
    // Viewer connection
    session.viewers.add(ws);
    const viewerCount = session.viewers.size;
    log(`Viewer connected (${viewerCount} total)`);

    // Send session info to new viewer
    send(ws, {
      event: "session:info",
      active: !!session.producer,
      mode: session.mode,
      device: session.deviceName,
      viewerCount,
    });

    // Notify producer of new viewer (so it sends snapshots)
    if (session.producer && session.producer.readyState === 1) {
      send(session.producer, { event: "viewer:join", viewerCount });
    }

    ws.on("message", (data, isBinary) => {
      // Relay viewer commands to producer
      if (!session.producer || session.producer.readyState !== 1) return;
      const dataStr = isBinary ? data : data.toString();

      // Mode enforcement: block writes in readonly mode
      try {
        const msg = JSON.parse(dataStr);
        if (session.mode === "readonly" && isWriteCommand(msg)) {
          send(ws, { event: "error", message: "Terminal is in read-only mode" });
          return;
        }
      } catch {}

      session.producer.send(dataStr);
    });

    ws.on("close", () => {
      session.viewers.delete(ws);
      const remaining = session.viewers.size;
      log(`Viewer disconnected (${remaining} remaining)`);

      if (session.producer && session.producer.readyState === 1) {
        send(session.producer, { event: "viewer:leave", viewerCount: remaining });
      }
    });

    ws.on("error", (err) => rlog.error({ err, role: "viewer" }, "websocket error"));
  }
}

/**
 * Check if a command requires interactive mode.
 */
function isWriteCommand(msg) {
  const event = msg?.event || msg?.payload?.event;
  return event === "terminal:write";
}

/**
 * Send JSON to a single WebSocket.
 */
function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

/**
 * Broadcast JSON to a set of WebSockets.
 */
function broadcast(set, data) {
  const msg = JSON.stringify(data);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── REST API for session management ──────────────────────────────────

export function getRemoteSession() {
  return {
    active: !!session.producer,
    mode: session.mode,
    device: session.deviceName,
    viewerCount: session.viewers.size,
    startedAt: session.startedAt,
  };
}

export function setRemoteMode(params, query_, body) {
  const mode = body?.mode;
  if (mode !== "readonly" && mode !== "interactive") {
    return { error: "mode must be 'readonly' or 'interactive'", status: 400 };
  }
  session.mode = mode;
  // Notify producer and viewers
  if (session.producer) send(session.producer, { event: "mode:change", mode });
  broadcast(session.viewers, { event: "mode:change", mode });
  return { success: true, mode };
}

// ── Viewer HTML page (Canvas-based GridRenderer, ported from MEMAXX Cloud) ──

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function renderRemotePage() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(dir, "remote-viewer.html"), "utf-8");
  } catch (err) {
    return "<html><body><h1>Remote viewer not found: " + err.message + "</h1></body></html>";
  }
}

// Viewer HTML is now in remote-viewer.html (read by renderRemotePage above)
// Old inline template removed — template literals corrupt escape sequences.

function log(msg) {
  // Backwards-compat wrapper: routes legacy string logs through structured pino.
  const lower = typeof msg === "string" ? msg.toLowerCase() : "";
  if (lower.includes("error")) rlog.error(msg);
  else if (lower.includes("warn")) rlog.warn(msg);
  else rlog.info(msg);
}
