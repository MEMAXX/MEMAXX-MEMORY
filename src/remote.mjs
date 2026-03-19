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

    ws.on("message", (data) => {
      // Relay producer broadcasts to all viewers
      for (const viewer of session.viewers) {
        if (viewer.readyState === 1) {
          viewer.send(data);
        }
      }
    });

    ws.on("close", () => {
      log("Producer disconnected");
      session.producer = null;
      session.startedAt = null;
      broadcast(session.viewers, { event: "session:end" });
    });

    ws.on("error", (err) => log(`Producer error: ${err.message}`));

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

    ws.on("message", (data) => {
      // Relay viewer commands to producer
      if (!session.producer || session.producer.readyState !== 1) return;

      // Mode enforcement: block writes in readonly mode
      try {
        const msg = JSON.parse(data.toString());
        if (session.mode === "readonly" && isWriteCommand(msg)) {
          send(ws, { event: "error", message: "Terminal is in read-only mode" });
          return;
        }
      } catch {}

      session.producer.send(data);
    });

    ws.on("close", () => {
      session.viewers.delete(ws);
      const remaining = session.viewers.size;
      log(`Viewer disconnected (${remaining} remaining)`);

      if (session.producer && session.producer.readyState === 1) {
        send(session.producer, { event: "viewer:leave", viewerCount: remaining });
      }
    });

    ws.on("error", (err) => log(`Viewer error: ${err.message}`));
  }
}

/**
 * Check if a command requires interactive mode.
 */
function isWriteCommand(msg) {
  const event = msg?.event || msg?.payload?.event;
  return event === "terminal:write" || event === "pane:split" || event === "pane:close";
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

// ── Viewer HTML page ─────────────────────────────────────────────────

export function renderRemotePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>MEMAXX Remote Terminal</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #111; border-bottom: 1px solid #222; font-size: 13px; flex-shrink: 0; }
    #toolbar .logo { font-weight: 700; font-size: 14px; }
    #toolbar .status { display: flex; align-items: center; gap: 6px; }
    #toolbar .dot { width: 8px; height: 8px; border-radius: 50%; }
    #toolbar .dot.on { background: #22c55e; }
    #toolbar .dot.off { background: #ef4444; }
    #toolbar .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(167,139,250,0.15); color: #A78BFA; font-weight: 600; text-transform: uppercase; }
    #toolbar .spacer { flex: 1; }
    #toolbar .viewers { color: #888; font-size: 12px; }
    #terminal-container { flex: 1; padding: 4px; }
    #connecting { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 15px; flex-direction: column; gap: 12px; }
    #connecting .spinner { width: 24px; height: 24px; border: 2px solid #333; border-top-color: #A78BFA; border-radius: 50%; animation: spin 600ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .xterm { height: 100%; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span class="logo">MEMAXX</span>
    <div class="status">
      <span class="dot" id="status-dot"></span>
      <span id="status-text">Connecting...</span>
    </div>
    <span class="badge" id="mode-badge">readonly</span>
    <span class="spacer"></span>
    <span class="viewers" id="viewer-count"></span>
  </div>
  <div id="terminal-container">
    <div id="connecting"><div class="spinner"></div><span>Connecting to terminal...</span></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script>
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + location.host + '/remote/ws?role=viewer';

    let term = null;
    let ws = null;
    let fitAddon = null;
    let reconnectTimer = null;
    let currentMode = 'readonly';

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[remote] Connected');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          handleMessage(msg);
        } catch {}
      };

      ws.onclose = () => {
        setStatus(false, 'Disconnected');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {};
    }

    let snapshotTimer = null;
    let lastDirtyTime = 0;

    function handleMessage(msg) {
      const event = msg.event || msg.payload?.event;

      switch (event) {
        case 'session:info':
          if (msg.active) {
            initTerminal();
            setStatus(true, msg.device || 'Connected');
            setMode(msg.mode);
            document.getElementById('viewer-count').textContent = msg.viewerCount + ' viewer(s)';
            sendCommand({ event: 'terminal:request_snapshot' });
          } else {
            setStatus(false, 'No active session');
          }
          break;

        case 'session:start':
          initTerminal();
          setStatus(true, msg.device || 'Connected');
          setMode(msg.mode);
          sendCommand({ event: 'terminal:request_snapshot' });
          break;

        case 'session:end':
          setStatus(false, 'Session ended');
          break;

        case 'mode:change':
          setMode(msg.mode);
          break;

        case 'terminal:update':
          handleTerminalUpdate(msg);
          break;

        case 'terminal:snapshot':
          handleSnapshot(msg);
          break;

        case 'terminal:meta':
          // Request snapshot for each pane
          if (msg.payload?.panes) {
            for (const pane of msg.payload.panes) {
              sendCommand({ event: 'terminal:request_snapshot', pty_id: pane.pty_id });
            }
          }
          break;

        case 'terminal:pong':
          break;

        case 'error':
          console.warn('[remote]', msg.message);
          break;
      }
    }

    function handleTerminalUpdate(msg) {
      if (!term || !msg.payload) return;
      const p = msg.payload;

      switch (p.t) {
        case 'd': // dirty rows — request fresh snapshot (debounced)
          lastDirtyTime = Date.now();
          if (!snapshotTimer) {
            snapshotTimer = setTimeout(() => {
              snapshotTimer = null;
              // Only request if no new dirty rows for 100ms
              if (Date.now() - lastDirtyTime >= 80) {
                sendCommand({ event: 'terminal:request_snapshot', pty_id: msg.pty_id });
              }
            }, 100);
          }
          break;
        case 'c': // cursor move
          if (term && p.x !== undefined && p.y !== undefined) {
            term.write('\\x1b[' + (p.y + 1) + ';' + (p.x + 1) + 'H');
          }
          break;
        case 'cw': // cwd changed
          document.title = 'MEMAXX Remote — ' + (p.path || '');
          sendCommand({ event: 'terminal:request_snapshot', pty_id: msg.pty_id });
          break;
        case 'tt': // title
          document.title = 'MEMAXX Remote — ' + (p.title || '');
          break;
        case 'as': // alt screen toggle
        case 'ex': // exit
          sendCommand({ event: 'terminal:request_snapshot', pty_id: msg.pty_id });
          break;
      }
    }

    function handleSnapshot(msg) {
      if (!term || !msg.payload) return;
      const s = msg.payload;

      // Resize terminal to match
      if (s.cols && s.rows && (s.cols !== term.cols || s.rows !== term.rows)) {
        term.resize(s.cols, s.rows);
      }

      // Render snapshot: build ANSI string from cell grid
      if (s.cells && s.cells.length > 0) {
        term.write('\\x1b[H'); // cursor home
        let output = '';
        for (let y = 0; y < s.cells.length; y++) {
          const row = s.cells[y];
          if (!row) { output += '\\x1b[K'; } // clear line
          else {
            let line = '';
            for (const cell of row) {
              // Cell format: [char, fg, bg, flags] or {char, fg, bg, flags}
              const ch = cell?.char || cell?.[0] || ' ';
              const fg = cell?.fg ?? cell?.[1];
              const bg = cell?.bg ?? cell?.[2];
              const flags = cell?.flags ?? cell?.[3] ?? 0;

              let sgr = '';
              if (flags & 1) sgr += '1;'; // bold
              if (flags & 2) sgr += '3;'; // italic
              if (flags & 4) sgr += '4;'; // underline
              if (fg !== undefined && fg !== null && fg !== 0xFFFFFF && fg !== -1) {
                const r = (fg >> 16) & 0xFF, g = (fg >> 8) & 0xFF, b = fg & 0xFF;
                sgr += '38;2;' + r + ';' + g + ';' + b + ';';
              }
              if (bg !== undefined && bg !== null && bg !== 0 && bg !== -1) {
                const r = (bg >> 16) & 0xFF, g = (bg >> 8) & 0xFF, b = bg & 0xFF;
                sgr += '48;2;' + r + ';' + g + ';' + b + ';';
              }
              if (sgr) {
                line += '\\x1b[' + sgr.slice(0, -1) + 'm' + ch + '\\x1b[0m';
              } else {
                line += ch;
              }
            }
            output += line + '\\x1b[K'; // write line + clear to end
          }
          if (y < s.cells.length - 1) output += '\\r\\n';
        }
        term.write(output);
      }

      // Restore cursor
      if (s.cursorX !== undefined && s.cursorY !== undefined) {
        term.write('\\x1b[' + (s.cursorY + 1) + ';' + (s.cursorX + 1) + 'H');
        if (s.cursorVisible === false) term.write('\\x1b[?25l');
        else term.write('\\x1b[?25h');
      }
    }

    function initTerminal() {
      if (term) return;
      document.getElementById('connecting')?.remove();

      term = new window.Terminal({
        cursorBlink: true,
        theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#A78BFA' },
        fontSize: 14,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        allowProposedApi: true,
      });

      fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-container'));
      fitAddon.fit();

      // Send input to producer
      term.onData((data) => {
        if (currentMode === 'interactive') {
          sendCommand({ event: 'terminal:write', payload: { data } });
        }
      });

      // Handle resize
      window.addEventListener('resize', () => {
        if (fitAddon) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            sendCommand({ event: 'terminal:resize', payload: { cols: dims.cols, rows: dims.rows } });
          }
        }
      });

      // Request snapshot after init
      setTimeout(() => sendCommand({ event: 'terminal:request_snapshot' }), 200);
    }

    function sendCommand(cmd) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(cmd));
      }
    }

    function setStatus(online, text) {
      const dot = document.getElementById('status-dot');
      const label = document.getElementById('status-text');
      dot.className = 'dot ' + (online ? 'on' : 'off');
      label.textContent = text;
    }

    function setMode(mode) {
      currentMode = mode;
      document.getElementById('mode-badge').textContent = mode;
    }

    connect();
  </script>
</body>
</html>`;
}

function log(msg) {
  process.stderr.write(`[memaxx-remote] ${msg}\n`);
}
