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

// ── Viewer HTML page (Canvas-based GridRenderer, ported from MEMAXX Cloud) ──

export function renderRemotePage() {
  // Returns a complete standalone HTML page with:
  // - Canvas2D terminal renderer (same as desktop app)
  // - Mobile touch keys (arrows, TAB, ESC, ^C, Backspace, Enter)
  // - Command input bar for mobile
  // - WebSocket connection to /remote/ws
  //
  // Intentionally a single self-contained HTML string — no external deps.
  return VIEWER_HTML;
}

const VIEWER_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>MEMAXX Remote Terminal</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#e5e5e5;font-family:-apple-system,system-ui,sans-serif;height:100dvh;display:flex;flex-direction:column;overflow:hidden;touch-action:none}
#bar{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#111;border-bottom:1px solid #222;font-size:13px;flex-shrink:0}
#bar .logo{font-weight:700;font-size:14px}
.st{display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%}
.on{background:#22c55e}.off{background:#ef4444}
.badge{font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(167,139,250,.15);color:#A78BFA;font-weight:600;text-transform:uppercase}
.sp{flex:1}
.vi{color:#888;font-size:12px}
#wrap{flex:1;overflow:hidden;position:relative;background:#000}
#wrap canvas{display:block}
#ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);color:#888;font-size:15px;flex-direction:column;gap:12px}
.spin{width:24px;height:24px;border:2px solid #333;border-top-color:#A78BFA;border-radius:50%;animation:s .6s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
#keys{display:none;align-items:center;gap:2px;border-top:1px solid #222;background:#111;padding:4px 6px;flex-shrink:0}
#keys button{display:flex;align-items:center;justify-content:center;height:34px;min-width:34px;padding:0 8px;border:none;border-radius:6px;background:#1a1a1a;color:#aaa;font:600 12px/1 monospace;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
#keys button:active{background:#A78BFA;color:#000}
#keys .sep{width:1px;height:22px;background:#333;margin:0 2px;flex-shrink:0}
#keys .ent{margin-left:auto;background:rgba(167,139,250,.15);color:#A78BFA;padding:0 16px}
#keys .ent:active{background:#A78BFA;color:#000}
#ibar{display:none;align-items:center;gap:6px;border-top:1px solid #222;background:#111;padding:6px 8px;flex-shrink:0}
#ibar input{flex:1;border:1px solid #333;border-radius:6px;background:#000;color:#e5e5e5;font:14px monospace;padding:8px 10px;outline:none}
#ibar input:focus{border-color:#A78BFA}
@media(max-width:768px){#keys{display:flex}#ibar{display:flex}}
</style></head><body>
<div id="bar"><span class="logo">MEMAXX</span><div class="st"><span class="dot off" id="dot"></span><span id="st">Connecting...</span></div><span class="badge" id="md">readonly</span><span class="sp"></span><span class="vi" id="vc"></span></div>
<div id="wrap"><canvas id="cv"></canvas><div id="ov"><div class="spin"></div>Connecting to terminal...</div></div>
<div id="keys">
<button data-k="\\x1b[A">&#x2191;</button><button data-k="\\x1b[B">&#x2193;</button><button data-k="\\x1b[D">&#x2190;</button><button data-k="\\x1b[C">&#x2192;</button>
<div class="sep"></div>
<button data-k=" ">SPC</button><button data-k="\\t">TAB</button><button data-k="\\x1b">ESC</button><button data-k="\\x03">^C</button><button data-k="\\x7f">&#x232B;</button>
<button class="ent" data-k="\\r">&#x23CE;</button>
</div>
<div id="ibar"><input id="cmd" type="text" placeholder="$ command..." autocapitalize="off" autocorrect="off" spellcheck="false"></div>
<script>
// ── Canvas Grid Renderer (ported from MEMAXX Desktop GridRenderer.ts) ──
const DPR = window.devicePixelRatio || 1;
const FONT_SIZE = window.innerWidth < 640 ? 10 : 13;
const FONT = '"SF Mono","Cascadia Code","JetBrains Mono","Fira Code",monospace';
const LINE_H = 1.5;
const DEF_FG = [228,228,228], DEF_BG = [0,0,0], CURSOR_CLR = [255,255,255];
const BOLD=1,DIM=2,ITALIC=4,UNDERLINE=8,INVERSE=32,INVISIBLE=64,STRIKE=128,WIDE_SPACER=512;

let cv, ctx, grid=[], cols=0, rows=0, curX=0, curY=0, curVis=true;
let cellW, cellH, baseline;
let dirty = new Set();
const rgbCache = new Map();

function rgb(r,g,b){ const k=(r<<16)|(g<<8)|b; let c=rgbCache.get(k); if(!c){c='rgb('+r+','+g+','+b+')';rgbCache.set(k,c);} return c; }

function measure(){
  const sz = FONT_SIZE*DPR;
  const oc = new OffscreenCanvas(200,200); const ox = oc.getContext('2d');
  ox.font = sz+'px '+FONT;
  const m = ox.measureText('M');
  cellW = Math.ceil(m.width);
  cellH = Math.ceil(sz*LINE_H);
  baseline = Math.ceil(m.actualBoundingBoxAscent + (cellH-sz)/2);
}

function setGrid(cells, c, r){
  grid=cells; cols=c; rows=r; markAll();
}

function updateRows(dirtyRows){
  for(const dr of dirtyRows){
    const y = dr.row !== undefined ? dr.row : dr.y;
    const cells = dr.cells;
    if(y < grid.length) grid[y]=cells;
    else { while(grid.length<=y) grid.push(Array.from({length:cols},()=>({c:' '}))); grid[y]=cells; }
    dirty.add(y);
  }
}

function setCursor(x,y,v){ if(curY>=0&&curY<rows) dirty.add(curY); if(y>=0&&y<rows) dirty.add(y); curX=x; curY=y; curVis=v; }
function markAll(){ dirty.clear(); for(let i=0;i<rows;i++) dirty.add(i); }

function render(){
  if(!ctx) return;
  if(dirty.size===0) return;
  const sz=FONT_SIZE*DPR;
  const tyOff=(cellH-sz)/2;
  ctx.textBaseline='top';

  for(const screenRow of dirty){
    if(screenRow<0||screenRow>=rows) continue;
    const line = screenRow<grid.length ? grid[screenRow] : null;
    const y = screenRow*cellH;
    ctx.fillStyle=rgb(DEF_BG[0],DEF_BG[1],DEF_BG[2]);
    ctx.fillRect(0,y,cv.width,cellH);
    if(!line) continue;

    const batches=[[],[],[],[]];
    for(let col=0;col<line.length&&col<cols;col++){
      const cell=line[col]; const fl=cell.flags||0;
      if(fl&WIDE_SPACER) continue;
      const x=col*cellW;
      let fg=cell.fg||DEF_FG, bg=cell.bg||null;
      if(fl&INVERSE){ const t=fg; fg=bg||DEF_BG; bg=t; }
      const isCur = curVis && screenRow===curY && col===curX;
      if(isCur){ bg=CURSOR_CLR; fg=DEF_BG; }
      if(bg){ ctx.fillStyle=rgb(bg[0],bg[1],bg[2]); ctx.fillRect(x,y,cellW,cellH); }
      const ch=cell.c;
      if(ch&&ch!==' '&&!(fl&INVISIBLE)){
        const dim=fl&DIM?0.6:1;
        const color=rgb(Math.round(fg[0]*dim),Math.round(fg[1]*dim),Math.round(fg[2]*dim));
        const bi=(fl&BOLD?1:0)|(fl&ITALIC?2:0);
        batches[bi].push({x,y:y+tyOff,c:ch,color});
      }
      if(fl&UNDERLINE){ctx.fillStyle=rgb(fg[0],fg[1],fg[2]);ctx.fillRect(x,y+cellH-1,cellW,1);}
      if(fl&STRIKE){ctx.fillStyle=rgb(fg[0],fg[1],fg[2]);ctx.fillRect(x,y+(cellH>>1),cellW,1);}
    }
    const fonts=[sz+'px '+FONT,'bold '+sz+'px '+FONT,'italic '+sz+'px '+FONT,'italic bold '+sz+'px '+FONT];
    for(let i=0;i<4;i++){
      if(!batches[i].length) continue;
      ctx.font=fonts[i];
      for(const cmd of batches[i]){ ctx.fillStyle=cmd.color; ctx.fillText(cmd.c,cmd.x,cmd.y); }
    }
  }
  dirty.clear();
}

// ── WebSocket ──
const wsProto = location.protocol==='https:'?'wss:':'ws:';
const wsUrl = wsProto+'//'+location.host+'/remote/ws?role=viewer';
let ws=null, mode='readonly', reconnTimer=null;

function connect(){
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { if(reconnTimer){clearTimeout(reconnTimer);reconnTimer=null;} };
  ws.onmessage = (e) => { try{handle(JSON.parse(e.data));}catch{} };
  ws.onclose = () => { setStatus(false,'Disconnected'); reconnTimer=setTimeout(connect,3000); };
  ws.onerror = () => {};
}

function send(obj){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(obj)); }
function sendKey(k){ if(mode==='interactive') send({event:'terminal:write',payload:{data:k}}); }

function handle(msg){
  const ev = msg.event;
  if(ev==='session:info'){
    if(msg.active){ initCanvas(); setStatus(true,msg.device||'Connected'); setMode(msg.mode); send({event:'terminal:request_meta'}); }
    else setStatus(false,'No active session');
  } else if(ev==='session:start'){
    initCanvas(); setStatus(true,msg.device||'Connected'); setMode(msg.mode); send({event:'terminal:request_meta'});
  } else if(ev==='session:end'){
    setStatus(false,'Session ended');
  } else if(ev==='mode:change'){
    setMode(msg.mode);
  } else if(ev==='terminal:snapshot'){
    initCanvas();
    const p=msg.payload;
    if(p.cols&&p.rows){ cols=p.cols; rows=p.rows; sizeCanvas(); }
    if(p.cells) setGrid(p.cells,p.cols,p.rows);
    if(p.cursorX!==undefined) setCursor(p.cursorX,p.cursorY,p.cursorVisible!==false);
    document.getElementById('ov').style.display='none';
  } else if(ev==='terminal:update'){
    const p=msg.payload;
    if(p.t==='d' && p.rows) updateRows(p.rows);
    else if(p.t==='c') setCursor(p.x,p.y,p.v);
  } else if(ev==='terminal:meta'){
    if(msg.payload?.panes) document.getElementById('vc').textContent=msg.payload.panes.length+' pane(s)';
    send({event:'terminal:request_snapshot'});
  }
}

function setStatus(on,txt){ document.getElementById('dot').className='dot '+(on?'on':'off'); document.getElementById('st').textContent=txt; }
function setMode(m){ mode=m; document.getElementById('md').textContent=m; }

// ── Canvas init ──
let inited=false;
function initCanvas(){
  if(inited) return; inited=true;
  measure();
  cv=document.getElementById('cv');
  ctx=cv.getContext('2d',{alpha:false});
  if(/Mac|iPhone|iPad/.test(navigator.platform)) ctx.textRendering='geometricPrecision';
  const ro=new ResizeObserver(()=>{ sizeCanvas(); send({event:'terminal:resize',payload:{cols,rows}}); });
  ro.observe(document.getElementById('wrap'));
  sizeCanvas();
  // Start render loop
  (function loop(){ render(); requestAnimationFrame(loop); })();
}

function sizeCanvas(){
  if(!cv||!cellW) return;
  const wrap=document.getElementById('wrap');
  const rect=wrap.getBoundingClientRect();
  const c=Math.floor(rect.width*DPR/cellW);
  const r=Math.floor(rect.height*DPR/cellH);
  if(c>0&&r>0){ cols=c; rows=r; cv.width=c*cellW; cv.height=r*cellH; cv.style.width=cv.width/DPR+'px'; cv.style.height=cv.height/DPR+'px'; markAll(); }
}

// ── Key buttons ──
document.querySelectorAll('#keys button[data-k]').forEach(b=>{
  b.addEventListener('pointerdown',e=>{ e.preventDefault(); sendKey(b.dataset.k.replace(/\\\\x([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\\\t/g,'\\t').replace(/\\\\r/g,'\\r')); });
});

// ── Command input ──
const cmdInput=document.getElementById('cmd');
cmdInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    const v=cmdInput.value;
    if(v&&mode==='interactive'){send({event:'terminal:write',payload:{data:v}});send({event:'terminal:write',payload:{data:'\\r'}});cmdInput.value='';}
  }
});
cmdInput.addEventListener('focus',()=>requestAnimationFrame(()=>window.scrollTo(0,0)));

// ── Desktop keyboard ──
document.getElementById('wrap').tabIndex=0;
document.getElementById('wrap').addEventListener('keydown',e=>{
  if(mode!=='interactive') return;
  if(e.target.tagName==='INPUT') return;
  e.preventDefault();
  let d='';
  if(e.ctrlKey&&!e.altKey&&!e.metaKey){const c=e.key.toUpperCase().charCodeAt(0);if(c>=65&&c<=90)d=String.fromCharCode(c-64);}
  else if(e.key==='Enter')d='\\r';else if(e.key==='Backspace')d='\\x7f';else if(e.key==='Tab')d='\\t';
  else if(e.key==='Escape')d='\\x1b';else if(e.key==='ArrowUp')d='\\x1b[A';else if(e.key==='ArrowDown')d='\\x1b[B';
  else if(e.key==='ArrowRight')d='\\x1b[C';else if(e.key==='ArrowLeft')d='\\x1b[D';
  else if(e.key==='Home')d='\\x1b[H';else if(e.key==='End')d='\\x1b[F';
  else if(e.key==='Delete')d='\\x1b[3~';else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey)d=e.key;
  if(d) send({event:'terminal:write',payload:{data:d}});
});

// ── Touch scroll ──
let touchY=null,touchAcc=0;
document.getElementById('wrap').addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;touchAcc=0;},{passive:true});
document.getElementById('wrap').addEventListener('touchmove',e=>{
  if(touchY===null)return;const dy=e.touches[0].clientY-touchY;touchY=e.touches[0].clientY;
  // No scrollback in viewer for now — just consume the gesture
},{passive:true});
document.getElementById('wrap').addEventListener('touchend',()=>{touchY=null;},{passive:true});

// ── Paste ──
document.getElementById('wrap').addEventListener('paste',e=>{
  if(mode!=='interactive')return;e.preventDefault();
  const t=e.clipboardData.getData('text');
  if(t) send({event:'terminal:write',payload:{data:'\\x1b[200~'+t+'\\x1b[201~'}});
});

connect();
</script></body></html>`;

// (old xterm.js viewer removed — replaced by Canvas GridRenderer above)
function _removed() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
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
              // Cell format from Rust: {c: char, fg: [r,g,b]|null, bg: [r,g,b]|null, flags: u16}
              const ch = cell?.c || ' ';
              const fg = cell?.fg; // [r, g, b] array or null
              const bg = cell?.bg; // [r, g, b] array or null
              const flags = cell?.flags || 0;

              let sgr = '';
              if (flags & 1) sgr += '1;'; // bold
              if (flags & 2) sgr += '3;'; // italic
              if (flags & 4) sgr += '4;'; // underline
              if (fg && Array.isArray(fg)) {
                sgr += '38;2;' + fg[0] + ';' + fg[1] + ';' + fg[2] + ';';
              }
              if (bg && Array.isArray(bg)) {
                sgr += '48;2;' + bg[0] + ';' + bg[1] + ';' + bg[2] + ';';
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
