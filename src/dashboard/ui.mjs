/**
 * MEMAXX Memory Local — Dashboard UI
 * Complete SPA served as a single HTML template string.
 * Dark mode only, matching MEMAXX Cloud design tokens.
 * Hash-based routing, vanilla JS, D3.js for knowledge graph.
 */

// ── Page Renderer ────────────────────────────────────────────────────

/**
 * Render the full dashboard HTML page.
 * @param {{ onboarding?: boolean, port?: number }} opts
 * @returns {string} Complete HTML document
 */
const MEMAXX_LOGO_B64 = 'data:image/webp;base64,UklGRqgBAABXRUJQVlA4IJwBAABwCwCdASpAAEAAPm0ok0WkIiGXC26oQAbEtIAHTmsBlP8G9IFMw8WWoB5RnrV/a5PGGb0UArNz7sMfxaH8AVmehSIy13A8DQw5Xav6UNMPyvesApg/gKbyDag3BoQrtVeRupUAAP79NoUDKFXl/yz//HOUT6vmgCxqI8D+2C0nOFSn/TCQA5if+waFerrnWUbLjlmnuMygcvuUz+tTPN0OIoagtRAJ4xil9VpRiM90gU7kFV4QBFMd/jm7A7uB4Ys02REEwAPKjtyI/gXTFqCI3WexSVbBUBxA1A0TR+OR/1SGmuK7os+U4RyfruVcGcJ+ldCqcFK+xwzlEFQK3V0IR7iW/8M/tft8Pjw5LjE35lul9jI9pwFq6X7BOtRWyrX4Kh8VVT4jtyZkGLlZ/ex3+oX1aSveSS/jc9LVwKiiGcOEXmkkhl5lmotB/ox+Bc6Yev2AIDLVFvWFzz+NywM0lcmW8+okum2kzltkOkRQWbUsVdPX6CBeFDi4xkQ3/8UwL/9UqQxbFeZIQYk7Lv1e8WmdYKwpO59sAAAA';

export function renderPage(opts = {}) {
  const nonce = Math.random().toString(36).slice(2, 14);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MEMAXX Memory</title>
  <link rel="icon" href="${MEMAXX_LOGO_B64}">
  <style nonce="${nonce}">${CSS}</style>
</head>
<body>
  <div id="app">
    <nav id="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <img class="logo-icon" src="${MEMAXX_LOGO_B64}" alt="MEMAXX" />
          <span class="logo-text">MEMAXX<span class="logo-sub">Memory</span></span>
        </div>
      </div>
      <div class="nav-section">
        <div class="nav-label">General</div>
        <a class="nav-item" href="#/" data-page="overview">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
          Overview
        </a>
        <a class="nav-item" href="#/memories" data-page="memories">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Memories
        </a>
        <a class="nav-item" href="#/graph" data-page="graph">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 7.5L15.5 16.5M15.5 7.5L8.5 16.5"/></svg>
          Knowledge Graph
        </a>
        <a class="nav-item" href="#/tasks" data-page="tasks">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Tasks
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-label">Intelligence</div>
        <a class="nav-item" href="#/postmortems" data-page="postmortems">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
          Postmortems
        </a>
        <a class="nav-item" href="#/thinking" data-page="thinking">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a8 8 0 00-2.76 15.52A2 2 0 0110 19.5V20a2 2 0 004 0v-.48a2 2 0 00.76-1.98A8 8 0 0012 2z"/></svg>
          Thinking
        </a>
        <a class="nav-item" href="#/rules" data-page="rules">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Rules
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-label">System</div>
        <a class="nav-item" href="#/sync" data-page="sync">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
          Export / Import
        </a>
        <a class="nav-item" href="#/settings" data-page="settings">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          Settings
        </a>
      </div>
      <div class="sidebar-footer">
        <div class="footer-badge">Self-Hosted</div>
      </div>
    </nav>
    <main id="content">
      <button id="mobile-menu" class="mobile-menu" onclick="document.getElementById('sidebar').classList.toggle('open')">&#9776;</button>
      <div id="page-loading" class="page-loading">
        <div class="spinner"></div>
      </div>
    </main>
  </div>
  <div id="onboarding-page" style="display:none">
    <div id="onboarding-content"></div>
  </div>
  <script nonce="${nonce}">${JS(opts)}</script>
</body>
</html>`;
}

// ── CSS ──────────────────────────────────────────────────────────────

const CSS = `
/* MEMAXX Design Tokens (matching Cloud dashboard) */
:root {
  --tp-bg: #0a0a0a;
  --tp-surface: #111111;
  --tp-surface-hover: #1a1a1a;
  --tp-surface-raised: #1a1a1a;
  --tp-border: #222222;
  --tp-border-hover: #333333;
  --tp-text: #e5e5e5;
  --tp-text-secondary: #888888;
  --tp-text-muted: #555555;
  --tp-accent: #ffffff;
  --tp-accent-hover: #d4d4d4;
  --tp-accent-fg: #0a0a0a;
  --tp-success: #22c55e;
  --tp-warning: #eab308;
  --tp-error: #ef4444;
  --tp-info: #3b82f6;
  --tp-purple: #A78BFA;
  --tp-purple-dim: rgba(167, 139, 250, 0.15);
  --tp-gradient: linear-gradient(135deg, #A78BFA, #818CF8);
  --sidebar-w: 240px;
  --radius: 12px;
  --radius-sm: 8px;
  --radius-xs: 6px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--tp-bg);
  color: var(--tp-text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--tp-border-hover); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--tp-text-muted); }

/* Layout */
#app {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
#sidebar {
  width: var(--sidebar-w);
  background: var(--tp-surface);
  border-right: 1px solid var(--tp-border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 50;
  overflow-y: auto;
}

.sidebar-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--tp-border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  object-fit: contain;
}

.logo-text {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: -0.02em;
  color: var(--tp-text);
}

.logo-sub {
  font-weight: 400;
  color: var(--tp-text-secondary);
  margin-left: 4px;
}

.nav-section {
  padding: 12px 8px 4px;
}

.nav-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tp-text-muted);
  padding: 0 8px 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-xs);
  color: var(--tp-text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 450;
  transition: all 100ms;
  cursor: pointer;
}

.nav-item:hover {
  background: var(--tp-surface-hover);
  color: var(--tp-text);
}

.nav-item.active {
  background: var(--tp-surface-hover);
  color: var(--tp-text);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 20px;
  background: var(--tp-gradient);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.sidebar-footer {
  margin-top: auto;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--tp-border);
}

.footer-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tp-purple);
  background: var(--tp-purple-dim);
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  text-align: center;
}

/* Main Content */
#content {
  margin-left: var(--sidebar-w);
  flex: 1;
  padding: 32px 40px;
  max-width: 1200px;
  min-height: 100vh;
}

.page-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--tp-border);
  border-top-color: var(--tp-purple);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Page Header */
.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--tp-text);
  letter-spacing: -0.02em;
}

.page-desc {
  font-size: 13px;
  color: var(--tp-text-secondary);
  margin-top: 4px;
}

/* Cards */
.card {
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius);
  padding: 20px;
  transition: border-color 100ms;
}

.card:hover {
  border-color: var(--tp-border-hover);
}

.card-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--tp-text-secondary);
  margin-bottom: 8px;
}

.card-value {
  font-size: 28px;
  font-weight: 600;
  color: var(--tp-text);
  letter-spacing: -0.03em;
}

.card-sub {
  font-size: 11px;
  color: var(--tp-text-muted);
  margin-top: 4px;
}

/* Stat Grid */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  font-size: 18px;
}

/* Section */
.section {
  margin-bottom: 28px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Badges */
.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  white-space: nowrap;
}

.badge-purple { background: var(--tp-purple-dim); color: var(--tp-purple); }
.badge-green { background: rgba(34,197,94,0.12); color: var(--tp-success); }
.badge-red { background: rgba(239,68,68,0.12); color: var(--tp-error); }
.badge-yellow { background: rgba(234,179,8,0.12); color: var(--tp-warning); }
.badge-blue { background: rgba(59,130,246,0.12); color: var(--tp-info); }
.badge-gray { background: rgba(85,85,85,0.15); color: var(--tp-text-muted); }

/* Type badges with specific colors */
.type-feature { background: rgba(139,92,246,0.12); color: #8B5CF6; }
.type-debug, .type-bug { background: rgba(239,68,68,0.12); color: #EF4444; }
.type-decision { background: rgba(59,130,246,0.12); color: #3B82F6; }
.type-learning { background: rgba(34,197,94,0.12); color: #22C55E; }
.type-pattern { background: rgba(167,139,250,0.12); color: #A78BFA; }
.type-rule { background: rgba(234,179,8,0.12); color: #EAB308; }
.type-progress { background: rgba(6,182,212,0.12); color: #06B6D4; }
.type-code-snippet { background: rgba(236,72,153,0.12); color: #EC4899; }
.type-design { background: rgba(249,115,22,0.12); color: #F97316; }
.type-research { background: rgba(20,184,166,0.12); color: #14B8A6; }
.type-context { background: rgba(107,114,128,0.12); color: #6B7280; }
.type-document-chunk { background: rgba(168,162,158,0.12); color: #A8A29E; }
.type-working-notes { background: rgba(148,163,184,0.12); color: #94A3B8; }
.type-task { background: rgba(251,146,60,0.12); color: #FB923C; }
.type-discussion { background: rgba(192,132,252,0.12); color: #C084FC; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-xs);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 100ms;
  text-decoration: none;
  white-space: nowrap;
}

.btn-primary {
  background: var(--tp-accent);
  color: var(--tp-accent-fg);
  border-color: var(--tp-accent);
}
.btn-primary:hover { background: var(--tp-accent-hover); }

.btn-secondary {
  background: var(--tp-surface-hover);
  color: var(--tp-text);
  border-color: var(--tp-border);
}
.btn-secondary:hover { background: var(--tp-border); }

.btn-ghost {
  background: transparent;
  color: var(--tp-text-secondary);
  border-color: transparent;
}
.btn-ghost:hover { background: var(--tp-surface-hover); color: var(--tp-text); }

.btn-sm { padding: 4px 10px; font-size: 11px; }

/* Inputs */
.input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  background: var(--tp-bg);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-xs);
  color: var(--tp-text);
  outline: none;
  transition: border-color 100ms;
}

.input:focus { border-color: var(--tp-border-hover); }
.input::placeholder { color: var(--tp-text-muted); }

.select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

/* Search Bar */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.search-bar .input { flex: 1; }

/* Memory Card */
.memory-card {
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 100ms;
}

.memory-card:hover { border-color: var(--tp-border-hover); }

.memory-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.memory-card-content {
  font-size: 13px;
  color: var(--tp-text-secondary);
  line-height: 1.6;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.memory-card.expanded .memory-card-content {
  -webkit-line-clamp: unset;
  overflow: visible;
}

.memory-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--tp-text-muted);
}

.memory-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.tag {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--tp-surface-hover);
  border-radius: 3px;
  color: var(--tp-text-secondary);
}

/* Importance bar */
.importance-bar {
  width: 40px;
  height: 4px;
  background: var(--tp-border);
  border-radius: 2px;
  overflow: hidden;
}

.importance-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 200ms;
}

/* Task List */
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  transition: border-color 100ms;
}

.task-item:hover { border-color: var(--tp-border-hover); }

.task-checkbox {
  width: 18px;
  height: 18px;
  border: 2px solid var(--tp-border-hover);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 100ms;
}

.task-checkbox.checked {
  background: var(--tp-success);
  border-color: var(--tp-success);
}

.task-checkbox.checked::after {
  content: '';
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translate(-1px, -1px);
}

.task-title {
  font-size: 13px;
  color: var(--tp-text);
  flex: 1;
}

.task-title.completed {
  text-decoration: line-through;
  color: var(--tp-text-muted);
}

.task-priority {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Postmortem Card */
.postmortem-card {
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 100ms;
}

.postmortem-card:hover { border-color: var(--tp-border-hover); }

.postmortem-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.severity-critical { background: var(--tp-error); }
.severity-high { background: #F97316; }
.severity-medium { background: var(--tp-warning); }
.severity-low { background: var(--tp-success); }

.postmortem-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--tp-border);
}

.postmortem-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--tp-text-muted);
  margin-bottom: 6px;
}

/* Thinking */
.thought-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-border);
}

.thought-type-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

/* Rules */
.rule-item {
  padding: 12px 16px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--tp-text-secondary);
  line-height: 1.5;
}

.rule-item .rule-priority {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  margin-right: 8px;
}

/* Settings */
.settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-border);
  font-size: 13px;
}

.settings-label { color: var(--tp-text-secondary); }
.settings-value { color: var(--tp-text); font-family: ui-monospace, monospace; font-size: 12px; }

/* Graph */
#graph-container {
  width: 100%;
  height: calc(100vh - 120px);
  background: var(--tp-bg);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius);
  overflow: hidden;
  position: relative;
}

#graph-container svg {
  width: 100%;
  height: 100%;
}

.graph-node { cursor: pointer; }
.graph-node circle { transition: r 150ms; }
.graph-node:hover circle { r: 8; }
.graph-label {
  font-size: 10px;
  fill: var(--tp-text-secondary);
  pointer-events: none;
  text-anchor: middle;
}
.graph-edge { stroke: var(--tp-border-hover); stroke-width: 1; }
.graph-edge-label {
  font-size: 8px;
  fill: var(--tp-text-muted);
  text-anchor: middle;
}

.graph-tooltip {
  position: absolute;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: 12px;
  pointer-events: none;
  z-index: 100;
  max-width: 280px;
  display: none;
}

.graph-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  z-index: 10;
}

.graph-controls button {
  width: 32px;
  height: 32px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-xs);
  color: var(--tp-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 100ms;
}

.graph-controls button:hover {
  background: var(--tp-surface-hover);
  color: var(--tp-text);
}

.graph-legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--tp-text-muted);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.pagination button {
  padding: 5px 12px;
  font-size: 12px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-xs);
  color: var(--tp-text-secondary);
  cursor: pointer;
  transition: all 100ms;
}

.pagination button:hover:not(:disabled) {
  background: var(--tp-surface-hover);
  color: var(--tp-text);
}

.pagination button:disabled { opacity: 0.3; cursor: default; }
.pagination .page-info { font-size: 12px; color: var(--tp-text-muted); }

/* Empty State */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--tp-text-muted);
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.4;
}

.empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--tp-text-secondary);
  margin-bottom: 6px;
}

.empty-desc {
  font-size: 13px;
  max-width: 360px;
  margin: 0 auto;
}

/* Onboarding Full Page */
#onboarding-page {
  position: fixed;
  inset: 0;
  background: var(--tp-bg);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

.onboarding-card {
  width: 520px;
  max-width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.onboarding-logo {
  margin-bottom: 32px;
}
.onboarding-logo-icon {
  width: 48px; height: 48px; border-radius: 14px;
  object-fit: contain;
}

.onboarding-modal {
  width: 100%;
  padding: 0;
}

.onboarding-step { display: none; }
.onboarding-step.active { display: block; }

.onboarding-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--tp-text);
  margin-bottom: 8px;
  letter-spacing: -0.02em;
}

.onboarding-desc {
  font-size: 14px;
  color: var(--tp-text-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
}

.onboarding-check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--tp-bg);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
  font-size: 13px;
}

.check-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
}

.check-ok { background: rgba(34,197,94,0.15); color: var(--tp-success); }
.check-pending { background: var(--tp-border); color: var(--tp-text-muted); }

.code-block {
  background: var(--tp-bg);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--tp-text-secondary);
  overflow-x: auto;
  position: relative;
  margin: 12px 0;
  white-space: pre;
}

.code-block .copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  font-size: 10px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: 4px;
  color: var(--tp-text-secondary);
  cursor: pointer;
  transition: all 100ms;
}

.code-block .copy-btn:hover { background: var(--tp-surface-hover); color: var(--tp-text); }

.onboarding-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--tp-border);
}

.step-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tp-border);
  transition: all 200ms;
}

.step-dot.active { background: var(--tp-purple); width: 20px; border-radius: 4px; }

/* Utility */
.flex { display: flex; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-2 { margin-bottom: 8px; }
.text-mono { font-family: ui-monospace, monospace; font-size: 12px; }
.text-xs { font-size: 11px; }
.text-muted { color: var(--tp-text-muted); }
.text-secondary { color: var(--tp-text-secondary); }
.text-right { text-align: right; }
.w-full { width: 100%; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hidden { display: none !important; }

/* Mobile Menu */
.mobile-menu {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 60;
  width: 36px;
  height: 36px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--radius-xs);
  color: var(--tp-text);
  font-size: 18px;
  cursor: pointer;
}
@media (max-width: 768px) {
  .mobile-menu { display: flex; align-items: center; justify-content: center; }
}

/* Graph Side Panel */
.graph-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  background: var(--tp-surface);
  border-left: 1px solid var(--tp-border);
  padding: 16px;
  overflow-y: auto;
  display: none;
  z-index: 20;
}
.graph-panel.open { display: block; }
.graph-panel-close {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--tp-text-muted);
  cursor: pointer;
  font-size: 16px;
}

/* Responsive */
@media (max-width: 768px) {
  #sidebar {
    transform: translateX(-100%);
    transition: transform 200ms;
    z-index: 100;
  }
  #sidebar.open { transform: translateX(0); }
  #content { margin-left: 0; padding: 20px 16px; }
  .stat-grid { grid-template-columns: 1fr 1fr; }
  .search-bar { flex-direction: column; }
  .search-bar .input { width: 100%; }
  .search-bar select { width: 100% !important; }
  .onboarding-modal { width: 95vw; padding: 20px; }
}
`;

// ── JavaScript ───────────────────────────────────────────────────────

function JS(opts) {
  return `
// ── MEMAXX Dashboard App ─────────────────────────────────────────────

const API = '';
let currentPage = '';
let graphInstance = null;

// ── Router ───────────────────────────────────────────────────────────

function navigate() {
  const hash = location.hash || '#/';
  const path = hash.slice(1) || '/';
  const segments = path.split('/').filter(Boolean);
  const page = segments[0] || 'overview';

  if (page === currentPage) return;
  currentPage = page;

  // Close sidebar on mobile
  document.getElementById('sidebar')?.classList.remove('open');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Render page
  const content = document.getElementById('content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  switch (page) {
    case 'overview': renderOverview(content); break;
    case 'memories': renderMemories(content); break;
    case 'graph': renderGraph(content); break;
    case 'tasks': renderTasks(content); break;
    case 'postmortems': renderPostmortems(content); break;
    case 'thinking': renderThinking(content); break;
    case 'rules': renderRules(content); break;
    case 'sync': renderSync(content); break;
    case 'settings': renderSettings(content); break;
    default: renderOverview(content);
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('load', async () => {
  // Check if provider is configured — if not, show onboarding INSTEAD of dashboard
  try {
    const provRes = await fetch('/api/provider');
    if (provRes.ok) {
      const prov = await provRes.json();
      if (!prov.embedding_provider && !prov._env_embedding_provider) {
        document.getElementById('app').style.display = 'none';
        showOnboarding();
        return;
      }
    }
  } catch { /* ignore */ }
  navigate();
});

// ── API Helpers ──────────────────────────────────────────────────────

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(API + path, { method: 'DELETE' });
  return res.json();
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return Math.floor(days / 30) + 'mo ago';
}

function esc(s) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function typeBadge(type) {
  return '<span class="badge type-' + (type || 'learning') + '">' + esc(type || 'learning') + '</span>';
}

function importanceColor(score) {
  if (score >= 0.8) return 'var(--tp-error)';
  if (score >= 0.6) return 'var(--tp-warning)';
  if (score >= 0.4) return 'var(--tp-purple)';
  return 'var(--tp-text-muted)';
}

// ── Overview Page ────────────────────────────────────────────────────

async function renderOverview(el) {
  try {
    const data = await api('/api/stats');
    const s = data;

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Overview</h1>
        <p class="page-desc">Your local memory at a glance</p>
      </div>

      <div class="stat-grid">
        <div class="card">
          <div class="stat-icon" style="background:var(--tp-purple-dim);color:var(--tp-purple)">&#x2B22;</div>
          <div class="card-title">Memories</div>
          <div class="card-value">\${s.total_memories || 0}</div>
        </div>
        <div class="card">
          <div class="stat-icon" style="background:rgba(59,130,246,0.12);color:var(--tp-info)">&#x2B21;</div>
          <div class="card-title">Entities</div>
          <div class="card-value">\${s.total_entities || 0}</div>
        </div>
        <div class="card">
          <div class="stat-icon" style="background:rgba(34,197,94,0.12);color:var(--tp-success)">&#x2713;</div>
          <div class="card-title">Tasks</div>
          <div class="card-value">\${s.total_tasks || 0}</div>
          <div class="card-sub">\${s.open_tasks || 0} open</div>
        </div>
        <div class="card">
          <div class="stat-icon" style="background:rgba(239,68,68,0.12);color:var(--tp-error)">&#x26A0;</div>
          <div class="card-title">Postmortems</div>
          <div class="card-value">\${s.total_postmortems || 0}</div>
        </div>
      </div>

      \${s.type_breakdown ? \`
        <div class="section">
          <div class="section-title">Memory Types</div>
          <div class="card">
            \${Object.entries(s.type_breakdown).sort((a,b) => b[1]-a[1]).map(([type, count]) => \`
              <div class="flex items-center justify-between" style="padding:6px 0;border-bottom:1px solid var(--tp-border)">
                \${typeBadge(type)}
                <span class="text-xs text-muted">\${count}</span>
              </div>
            \`).join('')}
          </div>
        </div>
      \` : ''}

      \${s.recent_memories && s.recent_memories.length ? \`
        <div class="section">
          <div class="section-title">Recent Memories</div>
          \${s.recent_memories.map(m => \`
            <div class="memory-card" onclick="location.hash='#/memories'">
              <div class="memory-card-header">
                \${typeBadge(m.type)}
                <span class="text-xs text-muted">\${timeAgo(m.created_at)}</span>
              </div>
              <div class="memory-card-content">\${esc(m.content)}</div>
            </div>
          \`).join('')}
        </div>
      \` : ''}
    \`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x2B22;</div><div class="empty-title">No data yet</div><div class="empty-desc">Start using MEMAXX Memory with your AI tools to see data here.</div></div>';
  }
}

// ── Memories Page ────────────────────────────────────────────────────

let memoriesState = { page: 1, type: '', q: '' };

async function renderMemories(el) {
  const s = memoriesState;
  const params = new URLSearchParams();
  params.set('page', s.page);
  params.set('limit', '20');
  if (s.type) params.set('type', s.type);
  if (s.q) params.set('q', s.q);

  try {
    const data = await api('/api/memories?' + params);

    const typeOptions = ['', 'feature', 'code-snippet', 'debug', 'design', 'decision', 'rule',
      'learning', 'research', 'discussion', 'progress', 'task', 'working-notes', 'pattern',
      'context', 'bug', 'document-chunk'];

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Memories</h1>
        <p class="page-desc">\${data.total || 0} memories stored</p>
      </div>

      <div class="search-bar">
        <input class="input" id="mem-search" placeholder="Search memories..." value="\${esc(s.q)}"
          onkeydown="if(event.key==='Enter'){memoriesState.q=this.value;memoriesState.page=1;currentPage='';navigate()}">
        <select class="input select" style="width:160px" id="mem-type"
          onchange="memoriesState.type=this.value;memoriesState.page=1;currentPage='';navigate()">
          \${typeOptions.map(t => \`<option value="\${t}" \${t===s.type?'selected':''}>\${t||'All Types'}</option>\`).join('')}
        </select>
        <button class="btn btn-secondary" onclick="memoriesState.q=document.getElementById('mem-search').value;memoriesState.page=1;currentPage='';navigate()">Search</button>
      </div>

      <div id="memories-list">
        \${data.memories && data.memories.length ? data.memories.map(m => memoryCard(m)).join('') : \`
          <div class="empty-state">
            <div class="empty-icon">&#x1F4AD;</div>
            <div class="empty-title">No memories found</div>
            <div class="empty-desc">Try a different search or filter.</div>
          </div>
        \`}
      </div>

      \${data.pages > 1 ? \`
        <div class="pagination">
          <button \${s.page <= 1 ? 'disabled' : ''} onclick="memoriesState.page--;currentPage='';navigate()">Prev</button>
          <span class="page-info">Page \${s.page} of \${data.pages}</span>
          <button \${s.page >= data.pages ? 'disabled' : ''} onclick="memoriesState.page++;currentPage='';navigate()">Next</button>
        </div>
      \` : ''}
    \`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x26A0;</div><div class="empty-title">Error loading memories</div></div>';
  }
}

function memoryCard(m) {
  const tags = (() => { try { return JSON.parse(m.tags || '[]'); } catch { return []; } })();
  const files = (() => { try { return JSON.parse(m.related_files || '[]'); } catch { return []; } })();
  return \`
    <div class="memory-card" onclick="showMemoryDetail('\${m.id}')">
      <div class="memory-card-header">
        \${typeBadge(m.type)}
        <div class="importance-bar"><div class="importance-fill" style="width:\${(m.importance_score||0.5)*100}%;background:\${importanceColor(m.importance_score)}"></div></div>
        <span class="text-xs text-muted" style="margin-left:auto">\${timeAgo(m.created_at)}</span>
      </div>
      <div class="memory-card-content">\${esc(m.content)}</div>
      \${tags.length ? \`<div class="memory-card-tags">\${tags.map(t => \`<span class="tag">\${esc(t)}</span>\`).join('')}</div>\` : ''}
      \${files.length ? \`<div class="memory-card-meta">\${files.map(f => \`<span class="text-mono">\${esc(f.split('/').pop())}</span>\`).join('')}</div>\` : ''}
      <div class="memory-card-meta">
        <span>Score: \${(m.importance_score || 0.5).toFixed(2)}</span>
        <span>Retrieved: \${m.retrieval_count || 0}x</span>
        \${m.session_name ? \`<span>Session: \${esc(m.session_name)}</span>\` : ''}
      </div>
    </div>
  \`;
}

window.showMemoryDetail = async (id) => {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  try {
    const m = await api('/api/memories/' + id);
    const tags = Array.isArray(m.tags) ? m.tags : (typeof m.tags === 'string' ? JSON.parse(m.tags || '[]') : []);
    const files = Array.isArray(m.related_files) ? m.related_files : (typeof m.related_files === 'string' ? JSON.parse(m.related_files || '[]') : []);

    content.innerHTML = \`
      <div class="page-header">
        <button class="btn btn-ghost" onclick="currentPage='';navigate()" style="margin-bottom:12px">&larr; Back to Memories</button>
        <div class="flex items-center gap-2">
          \${typeBadge(m.type)}
          <h1 class="page-title" style="font-size:16px">Memory Detail</h1>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Content</div>
        <div style="font-size:13px;color:var(--tp-text-secondary);line-height:1.7;white-space:pre-wrap">\${esc(m.content)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="card">
          <div class="card-title">Importance</div>
          <div class="card-value">\${(m.importance_score || 0.5).toFixed(2)}</div>
          <div class="importance-bar" style="width:100%;margin-top:8px"><div class="importance-fill" style="width:\${(m.importance_score||0.5)*100}%;background:\${importanceColor(m.importance_score)}"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Retrievals</div>
          <div class="card-value">\${m.retrieval_count || 0}</div>
          <div class="card-sub">times accessed</div>
        </div>
      </div>
      \${tags.length ? \`
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Tags</div>
          <div class="memory-card-tags">\${tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('')}</div>
        </div>
      \` : ''}
      \${files.length ? \`
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Related Files</div>
          \${files.map(f => '<div class="text-mono" style="padding:4px 0;font-size:12px;color:var(--tp-text-secondary)">' + esc(f) + '</div>').join('')}
        </div>
      \` : ''}
      <div class="card">
        <div class="card-title">Metadata</div>
        <div class="settings-row"><span class="settings-label">ID</span><span class="settings-value">\${esc(m.id)}</span></div>
        <div class="settings-row"><span class="settings-label">Type</span><span class="settings-value">\${esc(m.type)}</span></div>
        <div class="settings-row"><span class="settings-label">Session</span><span class="settings-value">\${esc(m.session_name || '-')}</span></div>
        <div class="settings-row"><span class="settings-label">Created</span><span class="settings-value">\${m.created_at || '-'}</span></div>
        <div class="settings-row"><span class="settings-label">Updated</span><span class="settings-value">\${m.updated_at || '-'}</span></div>
        <div class="settings-row"><span class="settings-label">Archived</span><span class="settings-value">\${m.is_archived ? 'Yes' : 'No'}</span></div>
      </div>
    \`;
  } catch (e) {
    content.innerHTML = '<div class="empty-state"><div class="empty-title">Memory not found</div></div>';
  }
};

// ── Knowledge Graph Page ─────────────────────────────────────────────

async function renderGraph(el) {
  el.innerHTML = \`
    <div class="page-header">
      <h1 class="page-title">Knowledge Graph</h1>
      <p class="page-desc">Entity relationships and connections</p>
    </div>
    <div id="graph-container">
      <div class="graph-controls">
        <button onclick="graphZoom(1.3)" title="Zoom In">+</button>
        <button onclick="graphZoom(0.7)" title="Zoom Out">&minus;</button>
        <button onclick="graphReset()" title="Reset">&#x21BA;</button>
      </div>
      <div class="graph-tooltip" id="graph-tooltip"></div>
      <div class="graph-panel" id="graph-panel"></div>
      <div class="graph-legend" id="graph-legend"></div>
      <div class="page-loading" id="graph-loading"><div class="spinner"></div></div>
    </div>
  \`;

  try {
    const data = await api('/api/graph');
    document.getElementById('graph-loading').style.display = 'none';

    if (!data.nodes || !data.nodes.length) {
      document.getElementById('graph-container').innerHTML = \`
        <div class="empty-state">
          <div class="empty-icon">&#x2B21;</div>
          <div class="empty-title">No entities yet</div>
          <div class="empty-desc">Entities are automatically extracted from your memories.</div>
        </div>
      \`;
      return;
    }

    initGraph(data);
  } catch (e) {
    document.getElementById('graph-loading').innerHTML = '<div class="empty-state"><div class="empty-title">Failed to load graph</div></div>';
  }
}

const ENTITY_COLORS = {
  file: '#4a9eff', function: '#22c55e', class: '#a855f7', module: '#f59e0b',
  package: '#ef4444', concept: '#06b6d4', person: '#ec4899', service: '#f97316',
  api: '#3b82f6', database: '#8b5cf6', config: '#eab308', pattern: '#a78bfa', bug: '#ef4444'
};

function initGraph(data) {
  const container = document.getElementById('graph-container');
  const w = container.clientWidth;
  const h = container.clientHeight;

  // Build legend
  const types = [...new Set(data.nodes.map(n => n.type))];
  document.getElementById('graph-legend').innerHTML = types.map(t =>
    \`<div class="legend-item"><div class="legend-dot" style="background:\${ENTITY_COLORS[t]||'#6b7280'}"></div>\${t}</div>\`
  ).join('');

  // Create SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', \`0 0 \${w} \${h}\`);
  container.querySelector('.page-loading')?.remove();
  container.appendChild(svg);

  // Create groups
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(g);

  // Zoom & pan
  let transform = { x: 0, y: 0, k: 1 };
  let isPanning = false, startX = 0, startY = 0;

  function applyTransform() {
    g.setAttribute('transform', \`translate(\${transform.x},\${transform.y}) scale(\${transform.k})\`);
  }

  svg.addEventListener('mousedown', e => {
    if (e.target === svg || e.target === g) {
      isPanning = true; startX = e.clientX - transform.x; startY = e.clientY - transform.y;
    }
  });
  svg.addEventListener('mousemove', e => {
    if (isPanning) { transform.x = e.clientX - startX; transform.y = e.clientY - startY; applyTransform(); }
  });
  svg.addEventListener('mouseup', () => isPanning = false);
  svg.addEventListener('mouseleave', () => isPanning = false);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    transform.k = Math.max(0.1, Math.min(5, transform.k * factor));
    applyTransform();
  }, { passive: false });

  svg.addEventListener('click', () => {
    document.getElementById('graph-panel')?.classList.remove('open');
  });

  window.graphZoom = (factor) => { transform.k = Math.max(0.1, Math.min(5, transform.k * factor)); applyTransform(); };
  window.graphReset = () => { transform = { x: 0, y: 0, k: 1 }; applyTransform(); };

  // Simple force simulation (no D3 dependency)
  const nodes = data.nodes.map((n, i) => ({
    ...n,
    x: w/2 + (Math.random() - 0.5) * w * 0.6,
    y: h/2 + (Math.random() - 0.5) * h * 0.6,
    vx: 0, vy: 0,
    connections: 0
  }));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges = data.edges.filter(e => nodeMap.has(e.source_id) && nodeMap.has(e.target_id)).map(e => ({
    ...e,
    source: nodeMap.get(e.source_id),
    target: nodeMap.get(e.target_id)
  }));

  // Count connections
  edges.forEach(e => { e.source.connections++; e.target.connections++; });

  // Draw edges
  const edgeEls = edges.map(e => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'graph-edge');
    g.appendChild(line);
    const edgeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    edgeLabel.setAttribute('class', 'graph-edge-label');
    edgeLabel.textContent = e.relation || '';
    g.appendChild(edgeLabel);
    return { el: line, label: edgeLabel, data: e };
  });

  // Draw nodes
  const nodeEls = nodes.map(n => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'graph-node');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const r = Math.max(4, Math.min(12, 4 + n.connections * 1.5));
    circle.setAttribute('r', r);
    circle.setAttribute('fill', ENTITY_COLORS[n.type] || '#6b7280');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('class', 'graph-label');
    text.setAttribute('dy', r + 14);
    text.textContent = n.name.length > 20 ? n.name.slice(0, 18) + '..' : n.name;

    group.appendChild(circle);
    group.appendChild(text);
    g.appendChild(group);

    // Tooltip
    const tooltip = document.getElementById('graph-tooltip');
    group.addEventListener('mouseenter', (ev) => {
      tooltip.style.display = 'block';
      tooltip.innerHTML = \`<strong>\${esc(n.name)}</strong><br><span class="text-xs text-secondary">\${n.type} &middot; \${n.connections} connections</span>\`;
      tooltip.style.left = (ev.clientX - container.getBoundingClientRect().left + 12) + 'px';
      tooltip.style.top = (ev.clientY - container.getBoundingClientRect().top - 10) + 'px';
    });
    group.addEventListener('mouseleave', () => tooltip.style.display = 'none');

    // Click → show side panel
    group.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const panel = document.getElementById('graph-panel');
      panel.classList.add('open');
      panel.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
      try {
        const data = await api('/api/graph/explore/' + encodeURIComponent(n.name));
        panel.innerHTML = \`
          <button class="graph-panel-close" onclick="document.getElementById('graph-panel').classList.remove('open')">&times;</button>
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">\${esc(n.name)}</h3>
          <div class="text-xs text-secondary mb-2">\${esc(n.type)} &middot; \${n.connections} connections</div>
          <div class="section-title" style="margin-top:16px">Connected Entities</div>
          \${(data.nodes || []).filter(e => e.id !== n.id).slice(0, 15).map(e => \`
            <div style="padding:6px 0;border-bottom:1px solid var(--tp-border);font-size:12px">
              <span class="badge type-\${e.type || 'concept'}" style="margin-right:6px">\${esc(e.type)}</span>
              \${esc(e.name)}
            </div>
          \`).join('') || '<div class="text-xs text-muted">No connections</div>'}
          <div class="section-title" style="margin-top:16px">Relations</div>
          \${(data.edges || []).slice(0, 15).map(e => \`
            <div style="padding:4px 0;font-size:11px;color:var(--tp-text-secondary)">
              \${esc(e.source_name || '?')} <span style="color:var(--tp-purple)">&rarr;</span> \${esc(e.target_name || '?')}
              <span class="text-muted" style="margin-left:4px">\${esc(e.relation)}</span>
            </div>
          \`).join('') || '<div class="text-xs text-muted">No relations</div>'}
        \`;
      } catch (err) {
        panel.innerHTML = '<div class="text-xs text-muted" style="padding:20px">Failed to load entity details</div>';
      }
    });

    // Drag
    let dragging = false, dx = 0, dy = 0;
    group.addEventListener('mousedown', e => {
      e.stopPropagation();
      dragging = true;
      dx = e.clientX / transform.k - n.x;
      dy = e.clientY / transform.k - n.y;
      n.fx = n.x; n.fy = n.y;
    });
    window.addEventListener('mousemove', e => {
      if (dragging) {
        n.x = n.fx = e.clientX / transform.k - dx;
        n.y = n.fy = e.clientY / transform.k - dy;
      }
    });
    window.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; delete n.fx; delete n.fy; }
    });

    return { el: group, circle, data: n };
  });

  // Force simulation loop
  function simulate() {
    // Repulsion (charge)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = Math.sqrt(dx*dx + dy*dy) || 1;
        let force = -300 / (dist * dist);
        let fx = dx / dist * force;
        let fy = dy / dist * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }

    // Attraction (links)
    edges.forEach(e => {
      let dx = e.target.x - e.source.x;
      let dy = e.target.y - e.source.y;
      let dist = Math.sqrt(dx*dx + dy*dy) || 1;
      let force = (dist - 100) * 0.01;
      let fx = dx / dist * force;
      let fy = dy / dist * force;
      e.source.vx += fx; e.source.vy += fy;
      e.target.vx -= fx; e.target.vy -= fy;
    });

    // Center gravity
    nodes.forEach(n => {
      n.vx += (w/2 - n.x) * 0.001;
      n.vy += (h/2 - n.y) * 0.001;
    });

    // Apply velocity with damping
    nodes.forEach(n => {
      if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; return; }
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
      // Bounds
      n.x = Math.max(20, Math.min(w - 20, n.x));
      n.y = Math.max(20, Math.min(h - 20, n.y));
    });

    // Update DOM
    nodeEls.forEach(({ el, data: n }) => {
      el.setAttribute('transform', \`translate(\${n.x},\${n.y})\`);
    });
    edgeEls.forEach(({ el, label, data: e }) => {
      el.setAttribute('x1', e.source.x); el.setAttribute('y1', e.source.y);
      el.setAttribute('x2', e.target.x); el.setAttribute('y2', e.target.y);
      label.setAttribute('x', (e.source.x + e.target.x) / 2);
      label.setAttribute('y', (e.source.y + e.target.y) / 2);
    });
  }

  // Run simulation
  let iterations = 0;
  function tick() {
    simulate();
    iterations++;
    if (iterations < 300) requestAnimationFrame(tick);
  }
  tick();
}

// ── Tasks Page ───────────────────────────────────────────────────────

async function renderTasks(el) {
  try {
    const data = await api('/api/tasks');
    const tasks = data.tasks || data || [];

    const open = tasks.filter(t => t.status === 'open' || t.status === 'pending');
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const completed = tasks.filter(t => t.status === 'completed' || t.status === 'done');

    el.innerHTML = \`
      <div class="page-header flex items-center justify-between">
        <div>
          <h1 class="page-title">Tasks</h1>
          <p class="page-desc">\${tasks.length} total tasks</p>
        </div>
        <button class="btn btn-primary" onclick="showNewTask()">+ New Task</button>
      </div>

      <div id="new-task-form" class="hidden card mb-2" style="margin-bottom:16px">
        <input class="input mb-2" id="task-title" placeholder="Task title..." style="margin-bottom:8px">
        <textarea class="input" id="task-desc" placeholder="Description (optional)" rows="2" style="margin-bottom:8px;resize:vertical"></textarea>
        <div class="flex gap-2">
          <select class="input select" id="task-priority" style="width:120px">
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button class="btn btn-primary" onclick="createTask()">Create</button>
          <button class="btn btn-ghost" onclick="document.getElementById('new-task-form').classList.add('hidden')">Cancel</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Open <span class="badge badge-blue">\${open.length}</span></div>
        \${open.length ? open.map(t => taskItem(t)).join('') : '<div class="text-xs text-muted" style="padding:8px 0">No open tasks</div>'}
      </div>

      \${inProgress.length ? \`
        <div class="section">
          <div class="section-title">In Progress <span class="badge badge-yellow">\${inProgress.length}</span></div>
          \${inProgress.map(t => taskItem(t)).join('')}
        </div>
      \` : ''}

      <div class="section">
        <div class="section-title">Completed <span class="badge badge-green">\${completed.length}</span></div>
        \${completed.length ? completed.slice(0, 20).map(t => taskItem(t, true)).join('') : '<div class="text-xs text-muted" style="padding:8px 0">No completed tasks</div>'}
      </div>
    \`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x2713;</div><div class="empty-title">Error loading tasks</div></div>';
  }
}

function taskItem(t, done = false) {
  const priorityColors = { critical: 'var(--tp-error)', high: '#F97316', medium: 'var(--tp-warning)', low: 'var(--tp-success)' };
  return \`
    <div class="task-item">
      <div class="task-checkbox \${done ? 'checked' : ''}" onclick="toggleTask('\${t.id}', \${done})"></div>
      <div style="flex:1">
        <div class="task-title \${done ? 'completed' : ''}">\${esc(t.title)}</div>
        \${t.description ? \`<div class="text-xs text-muted mt-2">\${esc(t.description)}</div>\` : ''}
      </div>
      <span class="task-priority" style="color:\${priorityColors[t.priority] || 'var(--tp-text-muted)'}">\${t.priority || ''}</span>
      <span class="text-xs text-muted">\${timeAgo(t.created_at)}</span>
    </div>
  \`;
}

window.showNewTask = () => document.getElementById('new-task-form').classList.remove('hidden');

window.createTask = async () => {
  const title = document.getElementById('task-title').value.trim();
  if (!title) return;
  await apiPost('/api/tasks', {
    title,
    description: document.getElementById('task-desc').value.trim(),
    priority: document.getElementById('task-priority').value
  });
  currentPage = ''; navigate();
};

window.toggleTask = async (id, isDone) => {
  await apiPatch('/api/tasks/' + id, { status: isDone ? 'open' : 'completed' });
  currentPage = ''; navigate();
};

// ── Postmortems Page ─────────────────────────────────────────────────

async function renderPostmortems(el) {
  try {
    const data = await api('/api/postmortems');
    const pms = data.postmortems || data || [];

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Postmortems</h1>
        <p class="page-desc">\${pms.length} bug analyses recorded</p>
      </div>

      \${pms.length ? pms.map(pm => \`
        <div class="postmortem-card" onclick="this.classList.toggle('expanded')">
          <div class="postmortem-header">
            <span class="severity-dot severity-\${pm.severity || 'medium'}"></span>
            <strong style="font-size:13px">\${esc(pm.title)}</strong>
            <span class="badge badge-gray">\${pm.bug_category || 'unknown'}</span>
            <span class="text-xs text-muted" style="margin-left:auto">\${timeAgo(pm.created_at)}</span>
          </div>
          <div class="text-xs text-secondary" style="margin-top:4px">\${esc(pm.description || '')}</div>
          <div class="postmortem-section" style="display:none">
            <div class="postmortem-section-title">Root Cause</div>
            <div class="text-xs text-secondary">\${esc(pm.root_cause || 'Not documented')}</div>
          </div>
          <div class="postmortem-section" style="display:none">
            <div class="postmortem-section-title">Fix</div>
            <div class="text-xs text-secondary">\${esc(pm.fix_description || 'Not documented')}</div>
          </div>
          <div class="postmortem-section" style="display:none">
            <div class="postmortem-section-title">Prevention</div>
            <div class="text-xs text-secondary">\${esc(pm.prevention || 'Not documented')}</div>
          </div>
        </div>
      \`).join('') : \`
        <div class="empty-state">
          <div class="empty-icon">&#x1F41B;</div>
          <div class="empty-title">No postmortems yet</div>
          <div class="empty-desc">When bugs are fixed, their root cause analysis appears here.</div>
        </div>
      \`}
    \`;

    // Toggle expanded sections
    el.querySelectorAll('.postmortem-card').forEach(card => {
      card.addEventListener('click', () => {
        card.querySelectorAll('.postmortem-section').forEach(s => {
          s.style.display = s.style.display === 'none' ? 'block' : 'none';
        });
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading postmortems</div></div>';
  }
}

// ── Thinking Sequences Page ──────────────────────────────────────────

async function renderThinking(el) {
  try {
    const data = await api('/api/thinking');
    const seqs = data.sequences || data || [];

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Thinking Sequences</h1>
        <p class="page-desc">Structured problem-solving chains</p>
      </div>

      \${seqs.length ? seqs.map(seq => \`
        <div class="card" style="margin-bottom:12px;cursor:pointer" onclick="loadThinking('\${seq.id}', this)">
          <div class="flex items-center justify-between">
            <div>
              <strong style="font-size:13px">\${esc(seq.problem || seq.title || 'Thinking Sequence')}</strong>
              <div class="text-xs text-muted mt-2">\${seq.thought_count || 0} thoughts &middot; \${seq.status || 'active'}</div>
            </div>
            <span class="text-xs text-muted">\${timeAgo(seq.created_at)}</span>
          </div>
          <div class="thinking-thoughts" style="display:none"></div>
        </div>
      \`).join('') : \`
        <div class="empty-state">
          <div class="empty-icon">&#x1F4A1;</div>
          <div class="empty-title">No thinking sequences</div>
          <div class="empty-desc">Thinking sequences are created during complex problem-solving.</div>
        </div>
      \`}
    \`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading thinking sequences</div></div>';
  }
}

window.loadThinking = async (id, el) => {
  const container = el.querySelector('.thinking-thoughts');
  if (container.style.display !== 'none') { container.style.display = 'none'; return; }

  try {
    const data = await api('/api/thinking/' + id);
    const thoughts = data.thoughts || [];
    const typeIcons = { observation: '&#x1F441;', hypothesis: '&#x1F914;', analysis: '&#x1F50D;', conclusion: '&#x2714;' };
    const typeColors = { observation: 'var(--tp-info)', hypothesis: 'var(--tp-warning)', analysis: 'var(--tp-purple)', conclusion: 'var(--tp-success)' };

    container.innerHTML = thoughts.map(t => \`
      <div class="thought-item">
        <div class="thought-type-icon" style="background:\${typeColors[t.type] || 'var(--tp-border)'}20;color:\${typeColors[t.type] || 'var(--tp-text-muted)'}">
          \${typeIcons[t.type] || '?'}
        </div>
        <div>
          <div class="text-xs" style="color:\${typeColors[t.type] || 'var(--tp-text-muted)'};font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">\${t.type}</div>
          <div class="text-xs text-secondary">\${esc(t.content)}</div>
        </div>
      </div>
    \`).join('');
    container.style.display = 'block';
  } catch (e) {
    container.innerHTML = '<div class="text-xs text-muted" style="padding:12px">Failed to load thoughts</div>';
    container.style.display = 'block';
  }
};

// ── Rules Page ───────────────────────────────────────────────────────

async function renderRules(el) {
  try {
    const data = await api('/api/rules');
    const userRules = data.user_rules || [];
    const builtinRules = data.builtin_rules || [];

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Rules</h1>
        <p class="page-desc">\${userRules.length} user rules, \${builtinRules.length} built-in rules</p>
      </div>

      \${userRules.length ? \`
        <div class="section">
          <div class="section-title">User Rules</div>
          \${userRules.map(r => \`
            <div class="rule-item">
              <span class="rule-priority badge \${r.priority === 'high' ? 'badge-red' : r.priority === 'medium' ? 'badge-yellow' : 'badge-gray'}">\${r.priority || 'normal'}</span>
              \${esc(r.content)}
            </div>
          \`).join('')}
        </div>
      \` : ''}

      <div class="section">
        <div class="section-title">Built-in Rules <span class="badge badge-purple">\${builtinRules.length}</span></div>
        \${builtinRules.map(r => \`
          <div class="rule-item">
            <span class="rule-priority badge \${r.category === 'security' ? 'badge-red' : r.category === 'architecture' ? 'badge-blue' : r.category === 'performance' ? 'badge-yellow' : 'badge-gray'}">\${r.category || 'general'}</span>
            \${esc(r.content || r.description || r.name || '')}
          </div>
        \`).join('')}
      </div>
    \`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading rules</div></div>';
  }
}

// ── Settings Page ────────────────────────────────────────────────────

async function renderSettings(el) {
  try {
    const [configData, providerData] = await Promise.all([
      api('/api/config').catch(() => ({})),
      api('/api/provider').catch(() => ({})),
    ]);

    const provider = providerData.embedding_provider || providerData._env_embedding_provider || '';
    const source = providerData._source || 'environment';
    const hasKey = !!providerData.embedding_api_key || providerData._env_has_key;

    el.innerHTML = \`
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <p class="page-desc">Configure your embedding provider and manage your memory server</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Embedding Provider</div>
        <div class="text-xs text-muted" style="margin-bottom:16px">
          \${source === 'database' ? 'Configured via dashboard' : hasKey ? 'Configured via environment variables' : 'Not configured — set up below'}
        </div>
        <form id="provider-form" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Provider</label>
              <select id="cfg-provider" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px">
                <option value="openai" \${provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                <option value="gemini" \${provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                <option value="mistral" \${provider === 'mistral' ? 'selected' : ''}>Mistral</option>
                <option value="voyage" \${provider === 'voyage' ? 'selected' : ''}>Voyage AI</option>
                <option value="openrouter" \${provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                <option value="ollama" \${provider === 'ollama' ? 'selected' : ''}>Ollama (local)</option>
                <option value="custom" \${provider === 'custom' ? 'selected' : ''}>Custom (OpenAI-compatible)</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Model</label>
              <input id="cfg-model" type="text" placeholder="text-embedding-3-small" value="\${esc(providerData.embedding_model || '')}" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px;box-sizing:border-box" />
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">API Key</label>
            <input id="cfg-key" type="password" placeholder="\${hasKey ? '••• key configured •••' : 'sk-...'}" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px;box-sizing:border-box" />
          </div>
          <div id="cfg-ollama-url" style="display:\${provider === 'ollama' || provider === 'custom' ? 'block' : 'none'}">
            <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Base URL</label>
            <input id="cfg-base-url" type="text" placeholder="http://localhost:11434" value="\${esc(providerData.embedding_base_url || '')}" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px;box-sizing:border-box" />
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button type="button" id="test-provider-btn" class="btn btn-secondary" style="flex:1">Test Connection</button>
            <button type="submit" class="btn btn-primary" style="flex:1">Save</button>
          </div>
          <div id="provider-status" style="font-size:12px;min-height:20px;text-align:center"></div>
        </form>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">LLM (Entity Extraction)</div>
        <div class="text-xs text-muted" style="margin-bottom:12px">Optional — extracts entities and relations for the knowledge graph</div>
        <form id="llm-form" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">LLM Provider</label>
              <select id="llm-provider" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px">
                <option value="">None</option>
                <option value="openai" \${providerData.llm_provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                <option value="gemini" \${providerData.llm_provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                <option value="mistral" \${providerData.llm_provider === 'mistral' ? 'selected' : ''}>Mistral</option>
                <option value="openrouter" \${providerData.llm_provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                <option value="ollama" \${providerData.llm_provider === 'ollama' ? 'selected' : ''}>Ollama</option>
                <option value="custom" \${providerData.llm_provider === 'custom' ? 'selected' : ''}>Custom</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">LLM Model</label>
              <input id="llm-model" type="text" placeholder="gpt-4o-mini" value="\${esc(providerData.llm_model || '')}" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px;box-sizing:border-box" />
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">LLM API Key</label>
            <input id="llm-key" type="password" placeholder="\${providerData.llm_api_key ? '••• configured •••' : 'Same as embedding or separate'}" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:13px;box-sizing:border-box" />
          </div>
          <button type="submit" class="btn btn-secondary">Save LLM Config</button>
          <div id="llm-status" style="font-size:12px;min-height:20px;text-align:center"></div>
        </form>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Database</div>
        <div class="settings-row">
          <span class="settings-label">Type</span>
          <span class="settings-value">PostgreSQL + pgvector</span>
        </div>
      </div>
    \`;

    // Show/hide Ollama URL
    document.getElementById('cfg-provider').addEventListener('change', (e) => {
      const v = e.target.value; document.getElementById('cfg-ollama-url').style.display = (v === 'ollama' || v === 'custom') ? 'block' : 'none';
    });

    // Test connection
    document.getElementById('test-provider-btn').addEventListener('click', async () => {
      const status = document.getElementById('provider-status');
      status.textContent = 'Testing...';
      status.style.color = 'var(--tp-text-secondary)';
      const prov = document.getElementById('cfg-provider').value;
      const key = document.getElementById('cfg-key').value;
      const model = document.getElementById('cfg-model').value;
      const baseUrl = document.getElementById('cfg-base-url')?.value || '';
      try {
        const res = await api('/api/provider/test', {
          method: 'POST',
          body: JSON.stringify({ provider: prov, api_key: key || 'from-env', model, base_url: baseUrl }),
        });
        if (res.success) {
          status.innerHTML = '&#x2713; Connected! Dimension: ' + res.dimension;
          status.style.color = '#22c55e';
        } else {
          status.textContent = 'Failed: ' + (res.error || 'Unknown error');
          status.style.color = '#ef4444';
        }
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.style.color = '#ef4444';
      }
    });

    // Save embedding config
    document.getElementById('provider-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('provider-status');
      const body = { embedding_provider: document.getElementById('cfg-provider').value };
      const key = document.getElementById('cfg-key').value;
      const model = document.getElementById('cfg-model').value;
      const baseUrl = document.getElementById('cfg-base-url')?.value;
      if (key) body.embedding_api_key = key;
      if (model) body.embedding_model = model;
      if (baseUrl) body.embedding_base_url = baseUrl;
      try {
        const res = await api('/api/provider', { method: 'POST', body: JSON.stringify(body) });
        status.innerHTML = res.success ? '&#x2713; Saved! Restart server to apply.' : 'Error';
        status.style.color = res.success ? '#22c55e' : '#ef4444';
      } catch (e) { status.textContent = e.message; status.style.color = '#ef4444'; }
    });

    // Save LLM config
    document.getElementById('llm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('llm-status');
      const body = {};
      const prov = document.getElementById('llm-provider').value;
      const model = document.getElementById('llm-model').value;
      const key = document.getElementById('llm-key').value;
      if (prov) body.llm_provider = prov;
      if (model) body.llm_model = model;
      if (key) body.llm_api_key = key;
      try {
        const res = await api('/api/provider', { method: 'POST', body: JSON.stringify(body) });
        status.innerHTML = res.success ? '&#x2713; Saved!' : 'Error';
        status.style.color = res.success ? '#22c55e' : '#ef4444';
      } catch (e) { status.textContent = e.message; status.style.color = '#ef4444'; }
    });

  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading settings</div></div>';
  }
}

// ── Backup ───────────────────────────────────────────────────────────

window.createBackup = async () => {
  const btn = document.getElementById('backup-btn');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  try {
    const result = await apiPost('/api/backup', {});
    btn.textContent = 'Done!';
    setTimeout(() => { btn.textContent = 'Create Backup'; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Create Backup'; btn.disabled = false; }, 2000);
  }
};

// ── Export / Import Page ─────────────────────────────────────────────

async function renderSync(el) {
  el.innerHTML = \`
    <div class="page-header">
      <h1 class="page-title">Export / Import</h1>
      <p class="page-desc">Transfer memories between installations or create backups</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">Export</div>
        <div style="font-size:13px;color:var(--tp-text-secondary);margin-bottom:16px;line-height:1.6">
          Download all memories, entities, relations, tasks, and rules as a JSON file.
          Use this for backups or to migrate to another machine.
        </div>
        <button class="btn btn-primary" id="export-btn" onclick="exportData()">Download Export</button>
        <div id="export-status" class="text-xs text-muted mt-2"></div>
      </div>

      <div class="card">
        <div class="card-title">Import</div>
        <div style="font-size:13px;color:var(--tp-text-secondary);margin-bottom:16px;line-height:1.6">
          Import memories from a previously exported JSON file.
          Duplicates are automatically skipped.
        </div>
        <input type="file" id="import-file" accept=".json" style="display:none" onchange="importData(this)">
        <button class="btn btn-secondary" onclick="document.getElementById('import-file').click()">Choose File</button>
        <div id="import-status" class="text-xs text-muted mt-2"></div>
      </div>
    </div>
  \`;
}

window.exportData = async () => {
  const btn = document.getElementById('export-btn');
  const status = document.getElementById('export-status');
  btn.textContent = 'Exporting...';
  btn.disabled = true;
  try {
    const data = await api('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memaxx-export-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    status.textContent = 'Export downloaded successfully';
    status.style.color = 'var(--tp-success)';
  } catch (e) {
    status.textContent = 'Export failed: ' + e.message;
    status.style.color = 'var(--tp-error)';
  }
  btn.textContent = 'Download Export';
  btn.disabled = false;
};

window.importData = async (input) => {
  const status = document.getElementById('import-status');
  const file = input.files[0];
  if (!file) return;

  status.textContent = 'Reading file...';
  status.style.color = 'var(--tp-text-muted)';

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.memories || !Array.isArray(data.memories)) {
      status.textContent = 'Invalid export file: missing memories array';
      status.style.color = 'var(--tp-error)';
      return;
    }

    status.textContent = 'Importing ' + data.memories.length + ' memories...';
    const result = await apiPost('/api/import', { memories: data.memories });
    status.textContent = 'Imported: ' + (result.imported || 0) + ', Skipped: ' + (result.skipped || 0);
    status.style.color = 'var(--tp-success)';
  } catch (e) {
    status.textContent = 'Import failed: ' + e.message;
    status.style.color = 'var(--tp-error)';
  }
  input.value = '';
};

// ── Onboarding ───────────────────────────────────────────────────────

function showOnboarding() {
  const page = document.getElementById('onboarding-page');
  const container = document.getElementById('onboarding-content');
  if (!page || !container) return;
  page.style.display = 'flex';

  let step = 0;
  const steps = [
    // Step 0: Welcome
    {
      title: 'Welcome to MEMAXX Memory',
      content: \`
        <div class="onboarding-desc">
          Persistent AI memory for your coding assistants. Every decision, bug fix, and pattern &mdash;
          remembered across sessions, forever.
        </div>
        <div class="onboarding-check"><div class="check-icon check-ok">&#x2713;</div> PostgreSQL + pgvector ready</div>
        <div class="onboarding-check"><div class="check-icon check-ok">&#x2713;</div> 33 MCP tools available</div>
        <div class="onboarding-check"><div class="check-icon check-ok">&#x2713;</div> 100% self-hosted &mdash; your data stays here</div>
        <div class="onboarding-desc" style="margin-top:16px;font-size:12px;color:var(--tp-text-secondary)">
          Let's configure your embedding provider so MEMAXX can store and search memories semantically.
        </div>
      \`
    },
    // Step 1: Choose Provider
    {
      title: 'Choose Embedding Provider',
      content: \`
        <div class="onboarding-desc">
          MEMAXX needs an embedding provider to convert memories into vectors for semantic search.
          Pick one below:
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin:16px 0">
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('openai')">
            <input type="radio" name="ob-provider" value="openai" checked style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">OpenAI</div>
              <div class="text-xs text-secondary">text-embedding-3-small (1536 dims) &mdash; recommended</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('gemini')">
            <input type="radio" name="ob-provider" value="gemini" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">Google Gemini</div>
              <div class="text-xs text-secondary">text-embedding-004 (768 dims) &mdash; generous free tier</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('mistral')">
            <input type="radio" name="ob-provider" value="mistral" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">Mistral</div>
              <div class="text-xs text-secondary">mistral-embed (1024 dims) &mdash; EU-based</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('voyage')">
            <input type="radio" name="ob-provider" value="voyage" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">Voyage AI</div>
              <div class="text-xs text-secondary">voyage-3-lite (512 dims) &mdash; optimized for code</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('openrouter')">
            <input type="radio" name="ob-provider" value="openrouter" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">OpenRouter</div>
              <div class="text-xs text-secondary">Multiple providers, pay-per-use &mdash; no monthly commitment</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('ollama')">
            <input type="radio" name="ob-provider" value="ollama" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">Ollama (100% local)</div>
              <div class="text-xs text-secondary">nomic-embed-text &mdash; free, no API key needed</div>
            </div>
          </label>
          <label class="onboarding-radio" style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--tp-border);cursor:pointer;transition:border-color 0.2s" onclick="selectProvider('custom')">
            <input type="radio" name="ob-provider" value="custom" style="accent-color:var(--tp-purple)"/>
            <div>
              <div style="font-weight:600;font-size:14px">Custom (OpenAI-compatible)</div>
              <div class="text-xs text-secondary">Any provider with /v1/embeddings endpoint</div>
            </div>
          </label>
        </div>
      \`
    },
    // Step 2: API Key + Test
    {
      title: 'Enter API Key',
      content: \`
        <div class="onboarding-desc" id="ob-key-desc">
          Enter your OpenAI API key. This is stored locally in your PostgreSQL database &mdash; never sent anywhere except the provider.
        </div>
        <div style="margin:16px 0">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">API Key</label>
          <input id="ob-api-key" type="password" placeholder="sk-..." style="width:100%;padding:10px 12px;border-radius:10px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:14px;box-sizing:border-box;outline:none" />
        </div>
        <div id="ob-base-url-wrap" style="display:none;margin:12px 0">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em" id="ob-base-url-label">Base URL</label>
          <input id="ob-base-url" type="text" placeholder="http://host.docker.internal:11434" style="width:100%;padding:10px 12px;border-radius:10px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:14px;box-sizing:border-box;outline:none" />
        </div>
        <div id="ob-model-wrap" style="display:none;margin:12px 0">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--tp-text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">Embedding Model</label>
          <input id="ob-model" type="text" placeholder="text-embedding-3-small" style="width:100%;padding:10px 12px;border-radius:10px;background:var(--tp-bg);border:1px solid var(--tp-border);color:var(--tp-text);font-size:14px;box-sizing:border-box;outline:none" />
        </div>
        <button class="btn btn-secondary" style="width:100%;margin:8px 0" onclick="testOnboardingProvider()">Test Connection</button>
        <div id="ob-test-status" style="font-size:13px;text-align:center;min-height:24px;margin-top:4px"></div>
      \`
    },
    // Step 3: MCP Config
    {
      title: 'Connect Your AI Tool',
      content: \`
        <div class="onboarding-desc">
          Add this to your AI tool's MCP config. Works with Claude Code, Cursor, Windsurf, and any MCP client.
        </div>
        <div style="margin-bottom:8px">
          <div class="flex gap-2 mb-2" style="margin-bottom:12px">
            <button class="btn btn-secondary mcp-tab active" onclick="showMcpConfig('claude', this)">Claude Code</button>
            <button class="btn btn-secondary mcp-tab" onclick="showMcpConfig('cursor', this)">Cursor</button>
            <button class="btn btn-secondary mcp-tab" onclick="showMcpConfig('windsurf', this)">Windsurf</button>
          </div>
          <div id="mcp-config-claude">
            <div class="code-block" style="margin-bottom:8px">claude mcp add memaxx-memory http://localhost:3100/mcp<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
            <div class="text-xs text-secondary" style="margin-bottom:8px;text-align:center">or add manually to your MCP config:</div>
            <div class="code-block">{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
          </div>
          <div id="mcp-config-cursor" class="code-block" style="display:none">{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
          <div id="mcp-config-windsurf" class="code-block" style="display:none">{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
        </div>
      \`
    },
    // Step 4: System Prompt
    {
      title: 'AI System Prompt',
      content: \`
        <div class="onboarding-desc">
          Copy this into your project's <strong>CLAUDE.md</strong> so your AI uses all 33 MCP tools correctly:
          searching before changes, storing after tasks, running postmortems after bugs.
        </div>
        <div class="code-block" style="max-height:220px;overflow-y:auto;font-size:11px;line-height:1.5;white-space:pre-wrap">## MEMAXX Memory &mdash; MANDATORY

### HARD RULES
1. FIRST action: memory_init
2. BEFORE code changes: memory_search
3. AFTER tasks: memory_store
4. BEFORE bug fix: memory_postmortem_warnings
5. AFTER bug fix: memory_postmortem

### Key Tools (33 total)
memory_init, memory_store, memory_search, smart_context,
memory_graph_explore, memory_postmortem, memory_tasks,
memory_start_thinking, memory_upload_document...

Full prompt: SYSTEM_PROMPT.md in the repo<button class="copy-btn" onclick="copySystemPrompt(this)">Copy Full Prompt</button></div>
      \`
    },
    // Step 5: Done
    {
      title: "You're All Set!",
      content: \`
        <div class="onboarding-desc">
          MEMAXX Memory is configured and ready. Your AI will now remember everything.
        </div>
        <div style="text-align:center;margin:20px 0">
          <div style="font-size:48px;margin-bottom:12px">&#x1F680;</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0">
          <div class="card" style="text-align:center;padding:14px">
            <div style="font-size:13px;font-weight:600;color:var(--tp-text)">33 MCP Tools</div>
            <div class="text-xs text-secondary">Search, store, graph, postmortems</div>
          </div>
          <div class="card" style="text-align:center;padding:14px">
            <div style="font-size:13px;font-weight:600;color:var(--tp-text)">Knowledge Graph</div>
            <div class="text-xs text-secondary">Entities + relations, bi-temporal</div>
          </div>
          <div class="card" style="text-align:center;padding:14px">
            <div style="font-size:13px;font-weight:600;color:var(--tp-text)">Smart Context</div>
            <div class="text-xs text-secondary">Auto-detects what you need</div>
          </div>
          <div class="card" style="text-align:center;padding:14px">
            <div style="font-size:13px;font-weight:600;color:var(--tp-text)">Pattern Learning</div>
            <div class="text-xs text-secondary">RL-based confidence scoring</div>
          </div>
        </div>
      \`
    }
  ];

  function render() {
    container.innerHTML = \`
      <div class="onboarding-card">
        <div class="onboarding-logo"><img class="onboarding-logo-icon" src="${MEMAXX_LOGO_B64}" alt="MEMAXX" /></div>
        <div class="onboarding-modal">
          <div class="onboarding-title">\${steps[step].title}</div>
          \${steps[step].content}
          <div class="onboarding-nav">
            <div class="step-dots">
              \${steps.map((_, i) => \`<div class="step-dot \${i === step ? 'active' : ''}"></div>\`).join('')}
            </div>
            <div class="flex gap-2">
              \${step > 0 ? \`<button class="btn btn-ghost" onclick="onboardingPrev()">Back</button>\` : ''}
              \${step < steps.length - 1
                ? \`<button class="btn btn-primary" onclick="onboardingNext()">Next</button>\`
                : \`<button class="btn btn-primary" onclick="closeOnboarding()">Open Dashboard</button>\`}
            </div>
          </div>
        </div>
      </div>
    \`;
  }

  window.onboardingNext = () => { if (step < steps.length - 1) { step++; render(); } };
  window.onboardingPrev = () => { if (step > 0) { step--; render(); } };
  window.closeOnboarding = async () => {
    // Save provider config before closing — embedding + LLM (same provider)
    const provider = window._obProvider;
    const key = document.getElementById('ob-api-key')?.value;
    const baseUrl = document.getElementById('ob-base-url')?.value;
    const customModel = document.getElementById('ob-model')?.value;
    if (provider && (key || provider === 'ollama')) {
      const llmModels = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', mistral: 'mistral-small-latest', voyage: '', openrouter: 'anthropic/claude-3.5-haiku', ollama: 'llama3.2', custom: '' };
      const body = {
        embedding_provider: provider,
        llm_provider: llmModels[provider] ? provider : 'openai',
        llm_model: llmModels[provider] || 'gpt-4o-mini',
      };
      if (customModel) body.embedding_model = customModel;
      if (key) { body.embedding_api_key = key; body.llm_api_key = key; }
      const needsBaseUrl = provider === 'ollama' || provider === 'custom';
      if (baseUrl && needsBaseUrl) { body.embedding_base_url = baseUrl; if (provider === 'ollama') body.llm_base_url = baseUrl; }
      try { await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
    }
    // Hide onboarding, show dashboard
    page.style.display = 'none';
    document.getElementById('app').style.display = '';
    navigate();
  };

  window._obProvider = 'openai';
  window.selectProvider = (p) => {
    window._obProvider = p;
    const baseUrlWrap = document.getElementById('ob-base-url-wrap');
    const baseUrlInput = document.getElementById('ob-base-url');
    const baseUrlLabel = document.getElementById('ob-base-url-label');
    const modelWrap = document.getElementById('ob-model-wrap');
    const modelInput = document.getElementById('ob-model');
    const keyDesc = document.getElementById('ob-key-desc');
    const keyInput = document.getElementById('ob-api-key');

    const needsBaseUrl = p === 'ollama' || p === 'custom';
    const needsModel = p === 'custom';
    if (baseUrlWrap) baseUrlWrap.style.display = needsBaseUrl ? 'block' : 'none';
    if (modelWrap) modelWrap.style.display = needsModel ? 'block' : 'none';

    if (baseUrlInput) {
      if (p === 'ollama') { baseUrlInput.placeholder = 'http://host.docker.internal:11434'; baseUrlInput.value = 'http://host.docker.internal:11434'; }
      else if (p === 'custom') { baseUrlInput.placeholder = 'https://your-provider.com/v1'; baseUrlInput.value = ''; }
    }
    if (baseUrlLabel) baseUrlLabel.textContent = p === 'ollama' ? 'Ollama URL' : 'Base URL';

    const placeholders = { openai: 'sk-...', gemini: 'AIza...', mistral: 'api-key...', voyage: 'pa-...', openrouter: 'sk-or-...', ollama: 'Not needed for Ollama', custom: 'API key (if required)' };
    const descriptions = {
      openai: 'Enter your OpenAI API key. Stored locally in your PostgreSQL database.',
      gemini: 'Enter your Google AI API key. Get one at aistudio.google.com.',
      mistral: 'Enter your Mistral API key. Get one at console.mistral.ai.',
      voyage: 'Enter your Voyage AI API key. Get one at dash.voyageai.com.',
      openrouter: 'Enter your OpenRouter API key. Pay-per-use, no subscription needed.',
      ollama: 'Ollama runs locally — no API key needed. Make sure Ollama is running on your machine.',
      custom: 'Enter the API key for your OpenAI-compatible provider. Set the base URL and model below.',
    };

    if (keyInput) {
      if (p === 'ollama') { keyInput.placeholder = placeholders[p]; keyInput.value = ''; }
      else { keyInput.placeholder = placeholders[p] || 'API key...'; }
    }
    if (keyDesc) keyDesc.textContent = descriptions[p] || 'Enter your API key. Stored locally in your PostgreSQL database.';
  };

  window.testOnboardingProvider = async () => {
    const status = document.getElementById('ob-test-status');
    if (!status) return;
    status.textContent = 'Testing...';
    status.style.color = 'var(--tp-text-secondary)';
    const provider = window._obProvider;
    const key = document.getElementById('ob-api-key')?.value || '';
    const baseUrl = document.getElementById('ob-base-url')?.value || '';
    try {
      const res = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: key || 'none', base_url: baseUrl }),
      });
      const data = await res.json();
      if (data.success) {
        status.innerHTML = '&#x2713; Connected! Embedding dimension: ' + data.dimension;
        status.style.color = '#22c55e';
      } else {
        status.textContent = 'Failed: ' + (data.error || 'Unknown error');
        status.style.color = '#ef4444';
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.style.color = '#ef4444';
    }
  };
  window.showMcpConfig = (tool, btn) => {
    ['claude', 'cursor', 'windsurf'].forEach(t => {
      document.getElementById('mcp-config-' + t).style.display = t === tool ? 'block' : 'none';
    });
    btn.parentElement.querySelectorAll('.mcp-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
  window.copyCode = (btn) => {
    const code = btn.parentElement.textContent.replace('Copy', '').replace('Copied!', '').trim();
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  };
  window.copySystemPrompt = (btn) => {
    fetch('/api/system-prompt').then(r => r.text()).then(text => {
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Full Prompt', 1500);
      });
    }).catch(() => {
      btn.textContent = 'Error';
      setTimeout(() => btn.textContent = 'Copy Full Prompt', 1500);
    });
  };

  render();
}
`;
}
