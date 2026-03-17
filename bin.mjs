#!/usr/bin/env node
/**
 * MEMAXX Memory Local — Self-Hosted MCP Server
 *
 * Persistent AI memory running 100% on your machine.
 * SQLite + sqlite-vec for storage, your own API key for embeddings.
 *
 * Usage:
 *   npx memaxx-memory-local              # first run: interactive setup
 *   npx memaxx-memory-local              # subsequent: MCP server mode
 *   npx memaxx-memory-local --setup      # re-run setup wizard
 *   npx memaxx-memory-local --backup     # backup database
 *   npx memaxx-memory-local --dashboard  # start dashboard only (opens browser)
 *   npx memaxx-memory-local --no-dashboard  # MCP server without dashboard
 *   npx memaxx-memory-local --port 3333  # custom dashboard port
 *
 * License: Proprietary. See LICENSE file.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join, dirname, parse } from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

import { readConfig, configExists, getDbPath, getConfigDir } from "./src/config.mjs";
import { runOnboarding, ensureConfig } from "./src/onboarding.mjs";
import { openDatabase, closeDatabase } from "./src/db.mjs";
import { TOOL_DEFINITIONS, handleToolCall, setConfigs, setProjectId, setProjectManifest } from "./src/tools.mjs";

// ── Configuration ───────────────────────────────────────────────────

const SERVER_NAME = "memaxx-memory-local";
const SERVER_VERSION = "2.0.0";
const MCP_PROTOCOL_VERSION = "2025-03-26";

// ── CLI Flags ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || "";
const flags = new Set(args);

function getPort() {
  const idx = args.indexOf("--port");
  return idx !== -1 ? parseInt(args[idx + 1]) || 0 : 0;
}

// ── npx memaxx-memory-local setup ────────────────────────────────────
if (command === "setup" || flags.has("--setup") || flags.has("--reconfigure")) {
  const result = await runOnboarding();
  if (result?.config) {
    const cfg = result.config;
    try {
      openDatabase(cfg.db_path || getDbPath(), cfg.embedding?.dimension || 1536);
      const { startDashboard } = await import("./src/dashboard/server.mjs");
      await startDashboard({ port: getPort(), config: cfg, quiet: false, onboarding: true });
      log("Setup complete! Dashboard is running.");
      await new Promise(() => {}); // Keep alive
    } catch (err) {
      log(`Dashboard start failed: ${err.message}`);
      log("Setup complete! Start the MCP server with: npx memaxx-memory-local start");
    }
  }
  process.exit(0);
}

// ── npx memaxx-memory-local dashboard ────────────────────────────────
if (command === "dashboard" || flags.has("--dashboard")) {
  const dashConfig = readConfig();
  if (!dashConfig) {
    console.error("\n  No config found. Run setup first:\n\n    npx memaxx-memory-local setup\n");
    process.exit(1);
  }
  openDatabase(dashConfig.db_path || getDbPath(), dashConfig.embedding?.dimension || 1536);
  const { startDashboard } = await import("./src/dashboard/server.mjs");
  await startDashboard({ port: getPort(), config: dashConfig, quiet: false });
  await new Promise(() => {}); // Keep alive
}

// ── npx memaxx-memory-local backup ───────────────────────────────────
if (command === "backup" || flags.has("--backup")) {
  const config = readConfig();
  if (!config) {
    console.error("\n  No config found. Run setup first:\n\n    npx memaxx-memory-local setup\n");
    process.exit(1);
  }
  const dbPath = config.db_path || getDbPath();
  const backupPath = `${dbPath}.backup-${Date.now()}`;
  try {
    copyFileSync(dbPath, backupPath);
    log(`Backup created: ${backupPath}`);
  } catch (err) {
    log(`Backup failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── npx memaxx-memory-local --version ────────────────────────────────
if (flags.has("--version") || flags.has("-v")) {
  console.log(SERVER_VERSION);
  process.exit(0);
}

// ── npx memaxx-memory-local help / --help ────────────────────────────
if (command === "help" || flags.has("--help") || flags.has("-h")) {
  console.log(`
MEMAXX Memory Local v${SERVER_VERSION}
Self-hosted persistent memory for AI coding tools.

Commands:
  npx memaxx-memory-local setup          Setup wizard + opens dashboard
  npx memaxx-memory-local start          Start MCP server (for IDE config)
  npx memaxx-memory-local dashboard      Open dashboard in browser
  npx memaxx-memory-local backup         Backup database
  npx memaxx-memory-local help           Show this help

Options:
  --port <number>      Custom dashboard port (default: auto-assigned)
  --no-dashboard       Start MCP without background dashboard
  --version            Show version

MCP Config (paste into your IDE):
  {
    "mcpServers": {
      "memaxx-memory": {
        "command": "npx",
        "args": ["-y", "memaxx-memory-local", "start"]
      }
    }
  }
`);
  process.exit(0);
}

// ── npx memaxx-memory-local (no args) — show help if no config ───────
if (!command || command === "start" || flags.has("--no-dashboard")) {
  // This is the MCP server mode — continue below
} else {
  console.error(`\n  Unknown command: ${command}\n\n  Run 'npx memaxx-memory-local help' for usage.\n`);
  process.exit(1);
}

// ── Initialization ──────────────────────────────────────────────────

let config = readConfig();
let isFirstSetup = false;

if (!config) {
  if (command === "start") {
    // Explicit start but no config — tell AI to inform user
    log("No configuration found. User must run: npx memaxx-memory-local setup");
    // Continue — tool calls will return setup instructions
  } else if (process.stdin.isTTY) {
    // No args, TTY terminal — show welcome and redirect to setup
    console.log(`
  ┌─────────────────────────────────────────────┐
  │   MEMAXX Memory Local v${SERVER_VERSION}               │
  │   Self-hosted AI memory                     │
  └─────────────────────────────────────────────┘

  No configuration found. Let's set up your memory!

  Run:  npx memaxx-memory-local setup
`);
    process.exit(0);
  } else {
    // Non-interactive (MCP mode) — tell the AI
    log("No configuration found. User must run: npx memaxx-memory-local setup");
  }
}

let dbReady = false;

if (config) {
  try {
    openDatabase(config.db_path || getDbPath(), config.embedding.dimension);
    setConfigs(config.embedding, config.llm);
    dbReady = true;
    log(`Database opened: ${config.db_path || getDbPath()}`);
  } catch (err) {
    log(`Failed to open database: ${err.message}`);
  }
}

// ── Project Identification ──────────────────────────────────────────

const MAX_TREE_DEPTH = 6;
const HOME_DIR = homedir();

function normalizeSlashes(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isHomeDir(dir) {
  return normalizeSlashes(dir) === normalizeSlashes(HOME_DIR);
}

function detectProjectRoot(startDir) {
  const envPath = process.env.MEMAXX_PROJECT_PATH || process.env.PROJECT_CWD;
  if (envPath) {
    try { statSync(envPath); return envPath; } catch { /* */ }
  }

  let dir = startDir || process.cwd();
  const root = parse(dir).root;
  let depth = 0;

  while (dir !== root && depth < MAX_TREE_DEPTH) {
    if (isHomeDir(dir)) { dir = dirname(dir); depth++; continue; }
    try { statSync(join(dir, ".git")); return dir; } catch { /* */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    depth++;
  }

  return startDir || process.cwd();
}

function detectGitRemote(projectRoot) {
  try {
    return execFileSync("git", ["-C", projectRoot, "remote", "get-url", "origin"], {
      timeout: 3000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).toString().trim() || null;
  } catch { return null; }
}

function resolveProject(projectRoot) {
  const folderName = projectRoot.replace(/\\/g, "/").split("/").pop() || projectRoot;

  // Check .memaxx/project.json
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(join(projectRoot, ".memaxx", "project.json"), "utf-8"));
  } catch { /* */ }

  if (existing?.id) {
    existing.last_used = new Date().toISOString();
    try {
      writeFileSync(join(projectRoot, ".memaxx", "project.json"), JSON.stringify(existing, null, 2) + "\n");
    } catch { /* */ }
    return existing;
  }

  // Create new
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i++) id += chars[bytes[i] % chars.length];

  const project = {
    id,
    name: folderName,
    git_remote: detectGitRemote(projectRoot),
    created_at: new Date().toISOString(),
    last_used: new Date().toISOString(),
  };

  if (!isHomeDir(projectRoot)) {
    try {
      mkdirSync(join(projectRoot, ".memaxx"), { recursive: true });
      writeFileSync(join(projectRoot, ".memaxx", "project.json"), JSON.stringify(project, null, 2) + "\n");
      log(`Created .memaxx/project.json (id: ${id})`);
    } catch { /* */ }
  }

  return project;
}

function resolveRequestContext(argsProjectRoot) {
  const effectiveRoot = normalizeSlashes(
    argsProjectRoot || process.env.MEMAXX_PROJECT_PATH || process.env.PROJECT_CWD || detectProjectRoot()
  );
  const project = resolveProject(effectiveRoot);
  setProjectId(effectiveRoot, project.id);
  return { root: effectiveRoot, project };
}

// ── Project Manifest ────────────────────────────────────────────────

const manifestCache = new Map();
const MANIFEST_TTL_MS = 60_000;

function buildProjectManifest(root) {
  const normalized = normalizeSlashes(root);
  const cached = manifestCache.get(normalized);
  if (cached && (Date.now() - cached.ts) < MANIFEST_TTL_MS) return cached.manifest;

  const manifest = { files: [], package_json: null, has_tests: false };

  try { manifest.files = readdirSync(root).slice(0, 50); } catch { /* */ }

  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    manifest.package_json = {
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependencies: Object.keys(pkg.devDependencies || {}),
      scripts: Object.keys(pkg.scripts || {}),
    };
  } catch { /* */ }

  for (const td of ["tests", "test", "__tests__", "spec", "cypress", "e2e"]) {
    try { statSync(join(root, td)); manifest.has_tests = true; break; } catch { /* */ }
  }

  manifestCache.set(normalized, { manifest, ts: Date.now() });
  return manifest;
}

// Startup
const startupCtx = resolveRequestContext(null);
const startupManifest = buildProjectManifest(startupCtx.root);
setProjectManifest(startupManifest);
log(`Project: ${startupCtx.project.name} | id: ${startupCtx.project.id} | root: ${startupCtx.root}`);

// ── Dashboard Auto-Start ────────────────────────────────────────────

if (dbReady && !args.includes("--no-dashboard")) {
  if (isFirstSetup) {
    // First setup complete — open dashboard with onboarding welcome screen
    import("./src/dashboard/server.mjs").then(({ startDashboard }) => {
      const port = args.includes("--port") ? parseInt(args[args.indexOf("--port") + 1]) : 0;
      startDashboard({ port, config, quiet: false, onboarding: true }).catch((err) => {
        log(`Dashboard start failed: ${err.message}`);
      });
    }).catch(() => {});
  } else {
    // Subsequent runs — start dashboard quietly in background (no browser open)
    import("./src/dashboard/server.mjs").then(({ startDashboard }) => {
      const port = args.includes("--port") ? parseInt(args[args.indexOf("--port") + 1]) : 0;
      startDashboard({ port, config, quiet: true }).catch(() => {});
    }).catch(() => {});
  }
}

// ── MCP Protocol Handling ───────────────────────────────────────────

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleInitialize(req) {
  return jsonRpcResult(req.id, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  });
}

function handleToolsList(req) {
  return jsonRpcResult(req.id, {
    tools: TOOL_DEFINITIONS,
  });
}

async function handleToolsCall(req) {
  if (!dbReady) {
    return jsonRpcResult(req.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "MEMAXX Memory Local is not configured yet.",
          setup: "Run in terminal: npx memaxx-memory-local --setup",
          message: "Tell the user to run the setup command to configure their embedding provider.",
        }),
      }],
      isError: true,
    });
  }

  const toolName = req.params?.name;
  const toolArgs = req.params?.arguments || {};

  // Inject project context
  const ctx = resolveRequestContext(toolArgs.project_root);
  toolArgs.project_root = ctx.root;
  toolArgs.project_id = toolArgs.project_id || ctx.project.id;

  try {
    const result = await handleToolCall(toolName, toolArgs);
    return jsonRpcResult(req.id, result);
  } catch (err) {
    log(`Tool error (${toolName}): ${err.message}`);
    return jsonRpcResult(req.id, {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    });
  }
}

function isNotification(method) {
  return method.startsWith("notifications/") || method === "cancelled";
}

async function handleRequest(req) {
  if (!req || typeof req !== "object") {
    return jsonRpcError(null, -32600, "Invalid request");
  }

  const { method, id } = req;

  if (isNotification(method)) return null;

  switch (method) {
    case "initialize": return handleInitialize(req);
    case "tools/list": return handleToolsList(req);
    case "tools/call": return handleToolsCall(req);
    case "ping": return jsonRpcResult(id, {});
    default: return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Stdio Transport ─────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`[memaxx-local] ${msg}\n`);
}

function sendResponse(response) {
  if (!response) return;
  process.stdout.write(JSON.stringify(response) + "\n");
}

const rl = createInterface({ input: process.stdin, terminal: false });

let pendingRequests = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pendingRequests === 0) {
    closeDatabase();
    process.exit(0);
  }
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  pendingRequests++;
  try {
    const req = JSON.parse(trimmed);

    if (Array.isArray(req)) {
      const responses = await Promise.all(req.map(handleRequest));
      const nonNull = responses.filter(Boolean);
      if (nonNull.length > 0) sendResponse(nonNull);
    } else {
      const response = await handleRequest(req);
      sendResponse(response);
    }
  } catch (err) {
    sendResponse(jsonRpcError(null, -32700, "Parse error"));
  } finally {
    pendingRequests--;
    maybeExit();
  }
});

rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});

process.on("SIGINT", () => { closeDatabase(); process.exit(0); });
process.on("SIGTERM", () => { closeDatabase(); process.exit(0); });

log(`Started v${SERVER_VERSION} — self-hosted mode | db: ${config?.db_path || "not configured"}`);
