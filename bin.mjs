#!/usr/bin/env node
/**
 * MEMAXX Memory — Self-Hosted AI Memory Server
 *
 * Runs as an HTTP server with MCP Streamable HTTP + Dashboard.
 * Deploy via Docker or run locally.
 *
 * Usage:
 *   docker compose up -d                    # Docker (recommended)
 *   node bin.mjs                            # HTTP server mode (default)
 *   node bin.mjs --stdio                    # Legacy stdio MCP transport
 *   node bin.mjs --setup                    # Interactive setup wizard
 *   node bin.mjs --backup                   # Backup database
 *
 * Environment Variables (for Docker):
 *   EMBEDDING_PROVIDER=openai|openrouter|ollama
 *   EMBEDDING_API_KEY=sk-...
 *   EMBEDDING_MODEL=text-embedding-3-small
 *   LLM_PROVIDER=openai|openrouter|ollama
 *   LLM_API_KEY=sk-...
 *   LLM_MODEL=gpt-4o-mini
 *   DATA_DIR=/data                          # SQLite database directory
 *   PORT=3100                               # Server port
 *   HOST=0.0.0.0                            # Bind address
 *   AUTH_TOKEN=                             # Optional auth token for remote access
 *
 * License: MIT
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join, dirname, parse } from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

import { readConfig, configExists, getConfigDir, getEmbeddingDimension, getDefaultModel, getProviderUrl } from "./src/config.mjs";
import { initDatabase, closeDatabase, query as dbQuery } from "./src/db.mjs";
import { TOOL_DEFINITIONS, handleToolCall, setConfigs, setProjectId, setProjectManifest } from "./src/tools.mjs";
import { attachRemoteTerminal, renderRemotePage, getRemoteSession, setRemoteMode } from "./src/remote.mjs";
import { childLog } from "./src/log.mjs";
import { scheduleBackups } from "./src/backup.mjs";

const rootLog = childLog("memaxx");

// ── Configuration ───────────────────────────────────────────────────

const SERVER_NAME = "memaxx-memory";
const SERVER_VERSION = "3.0.0";
const MCP_PROTOCOL_VERSION = "2025-03-26";

// ── CLI Flags ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || "";
const flags = new Set(args);

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

// ── Environment-Based Config (for Docker) ───────────────────────────

function buildConfigFromEnv() {
  const provider = process.env.EMBEDDING_PROVIDER;
  if (!provider) return null;

  const model = process.env.EMBEDDING_MODEL || getDefaultModel(provider);
  const dimension = getEmbeddingDimension(provider, model);

  const config = {
    version: 2,
    embedding: {
      provider,
      api_key: process.env.EMBEDDING_API_KEY || null,
      base_url: process.env.EMBEDDING_BASE_URL || getProviderUrl(provider),
      model,
      dimension,
    },
    database_url: process.env.DATABASE_URL || "postgresql://memaxx:memaxx@localhost:5432/memaxx",
    created_at: new Date().toISOString(),
  };

  // LLM config for entity extraction (knowledge graph)
  // Defaults to same provider as embedding if not explicitly set
  const llmProvider = process.env.LLM_PROVIDER || provider;
  const llmDefaults = {
    openai: "gpt-4o-mini",
    gemini: "gemini-2.0-flash",
    mistral: "mistral-small-latest",
    openrouter: "anthropic/claude-3.5-haiku",
    ollama: "llama3.2",
  };
  config.llm = {
    provider: llmProvider,
    api_key: process.env.LLM_API_KEY || process.env.EMBEDDING_API_KEY || null,
    base_url: process.env.LLM_BASE_URL || getProviderUrl(llmProvider),
    model: process.env.LLM_MODEL || llmDefaults[llmProvider] || "gpt-4o-mini",
  };

  return config;
}

// ── Setup Command ───────────────────────────────────────────────────

if (command === "setup" || flags.has("--setup") || flags.has("--reconfigure")) {
  const { runOnboarding } = await import("./src/onboarding.mjs");
  const result = await runOnboarding();
  if (result?.config) {
    log("Setup complete! Start the server with: node bin.mjs");
  }
  process.exit(0);
}

// ── Backup Command ──────────────────────────────────────────────────

if (command === "backup" || flags.has("--backup")) {
  log("Backup: Use pg_dump for PostgreSQL backups.");
  log("  docker compose exec postgres pg_dump -U memaxx memaxx > backup.sql");
  process.exit(0);
}

// ── Version / Help ──────────────────────────────────────────────────

if (flags.has("--version") || flags.has("-v")) {
  console.log(SERVER_VERSION);
  process.exit(0);
}

if (command === "help" || flags.has("--help") || flags.has("-h")) {
  console.log(`
MEMAXX Memory v${SERVER_VERSION}
Self-hosted persistent memory for AI coding tools.

Modes:
  node bin.mjs                 Start HTTP server (MCP + Dashboard)
  node bin.mjs --stdio         Start stdio MCP transport (legacy)
  node bin.mjs --setup         Interactive setup wizard
  node bin.mjs --backup        Backup database

Options:
  --port <number>      Server port (default: 3100, env: PORT)
  --host <address>     Bind address (default: 0.0.0.0, env: HOST)
  --stdio              Use stdio transport instead of HTTP
  --auth-token <tok>   Auth token for remote access (env: AUTH_TOKEN)
  --version            Show version

Environment Variables (for Docker):
  EMBEDDING_PROVIDER   openai, openrouter, or ollama
  EMBEDDING_API_KEY    API key for embedding provider
  EMBEDDING_MODEL      Embedding model name
  LLM_PROVIDER         LLM provider for entity extraction
  LLM_API_KEY          API key for LLM provider
  LLM_MODEL            LLM model name
  DATA_DIR             Database directory (default: ~/.memaxx)
  PORT                 Server port (default: 3100)
  HOST                 Bind address (default: 0.0.0.0)
  AUTH_TOKEN           Optional auth token for remote access

Docker:
  docker compose up -d

MCP Config (HTTP — recommended):
  {
    "mcpServers": {
      "memaxx-memory": {
        "url": "http://localhost:3100/mcp"
      }
    }
  }

MCP Config (stdio — legacy):
  {
    "mcpServers": {
      "memaxx-memory": {
        "command": "node",
        "args": ["bin.mjs", "--stdio"]
      }
    }
  }
`);
  process.exit(0);
}

// ── Load Configuration ──────────────────────────────────────────────

let config = buildConfigFromEnv() || readConfig();

if (!config && process.env.DATABASE_URL) {
  // Docker mode without embedding provider — server still starts for dashboard onboarding
  config = {
    version: 2,
    database_url: process.env.DATABASE_URL,
  };
  log("No embedding provider configured. Dashboard onboarding will guide setup.");
} else if (!config) {
  if (process.stdin.isTTY && !flags.has("--stdio")) {
    console.log(`
  ┌─────────────────────────────────────────────┐
  │   MEMAXX Memory v${SERVER_VERSION}                    │
  │   Self-hosted AI memory                     │
  └─────────────────────────────────────────────┘

  No configuration found.

  Option 1 (Docker):
    Set environment variables and run: docker compose up -d

  Option 2 (Local):
    Run: node bin.mjs --setup
`);
    process.exit(0);
  } else {
    log("No configuration found. Set EMBEDDING_PROVIDER env var or run --setup");
  }
}

// ── Database Initialization ─────────────────────────────────────────

let dbReady = false;
const dbUrl = config?.database_url || process.env.DATABASE_URL;

if (dbUrl) {
  try {
    const dim = config?.embedding?.dimension || 1536;
    await initDatabase(dbUrl, dim);
    dbReady = true;
    log(`Database connected: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
    // Start daily backup scheduler once DB is healthy
    scheduleBackups();

    // If no embedding config from env, try loading from database
    if (config?.embedding?.provider) {
      setConfigs(config.embedding, config.llm);
      log(`Embedding provider: ${config.embedding.provider} (from env)`);
    } else {
      try {
        const { loadProviderConfigFromDb } = await import("./src/dashboard/api.mjs");
        const dbConfig = await loadProviderConfigFromDb();
        if (dbConfig?.embedding?.provider) {
          setConfigs(dbConfig.embedding, dbConfig.llm);
          log(`Embedding provider: ${dbConfig.embedding.provider} (from database)`);
        } else {
          log("No embedding provider configured. Configure via dashboard at /");
        }
      } catch { /* dashboard module may not be available */ }
    }
  } catch (err) {
    rootLog.error({ err, component: "db" }, "failed to connect to database");
  }
} else if (config) {
  log("No DATABASE_URL configured.");
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

/** DJB2 hash — deterministic, same algorithm as desktop app and tools.mjs */
function djb2Hash(str) {
  const normalized = str.replace(/\\/g, "/").replace(/\/+$/, "");
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function resolveProject(projectRoot) {
  const folderName = projectRoot.replace(/\\/g, "/").split("/").pop() || projectRoot;
  const gitRemote = detectGitRemote(projectRoot);
  const id = gitRemote ? djb2Hash(gitRemote) : djb2Hash(projectRoot);

  return {
    id,
    name: folderName,
    git_remote: gitRemote,
    created_at: new Date().toISOString(),
    last_used: new Date().toISOString(),
  };
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

// Startup context — only resolve project in non-Docker (local) mode
// In Docker, project identity comes from MCP client's project_root parameter
const isDatabaseMode = !!process.env.DATABASE_URL;
if (!isDatabaseMode) {
  const startupCtx = resolveRequestContext(null);
  const startupManifest = buildProjectManifest(startupCtx.root);
  setProjectManifest(startupManifest);
  log(`Project: ${startupCtx.project.name} | id: ${startupCtx.project.id} | root: ${startupCtx.root}`);
} else {
  log(`Docker mode — project identity determined by MCP clients`);
}

// ── MCP Protocol Handling (shared by both transports) ───────────────

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
          error: "MEMAXX Memory is not configured yet.",
          setup: "Set EMBEDDING_PROVIDER environment variable or run: node bin.mjs --setup",
        }),
      }],
      isError: true,
    });
  }

  const toolName = req.params?.name;
  const toolArgs = req.params?.arguments || {};

  if (!isDatabaseMode) {
    // Local mode: resolve project from .memaxx/project.json
    const ctx = resolveRequestContext(toolArgs.project_root);
    toolArgs.project_root = ctx.root;
    toolArgs.project_id = toolArgs.project_id || ctx.project.id;
  }
  // Docker mode: tools.mjs getProjectHash() handles project_root via DJB2 hash

  try {
    const result = await handleToolCall(toolName, toolArgs);
    return jsonRpcResult(req.id, result);
  } catch (err) {
    rootLog.error({ err, component: "mcp", tool: toolName }, "tool call failed");
    return jsonRpcResult(req.id, {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    });
  }
}

function isNotification(method) {
  return method.startsWith("notifications/") || method === "cancelled";
}

async function handleMcpRequest(req) {
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

// Export for dashboard server to use
export { handleMcpRequest, SERVER_NAME, SERVER_VERSION, MCP_PROTOCOL_VERSION, TOOL_DEFINITIONS, config, dbReady };

// ── Mode Selection ──────────────────────────────────────────────────

if (flags.has("--stdio")) {
  // ── Stdio Transport (legacy) ────────────────────────────────────
  startStdioTransport();
} else {
  // ── HTTP Server (default) ───────────────────────────────────────
  startHttpServer();
}

// ── Stdio Transport ─────────────────────────────────────────────────

function startStdioTransport() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  let pendingRequests = 0;
  let stdinClosed = false;

  async function maybeExit() {
    if (stdinClosed && pendingRequests === 0) {
      await closeDatabase();
      process.exit(0);
    }
  }

  function sendResponse(response) {
    if (!response) return;
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    pendingRequests++;
    try {
      const req = JSON.parse(trimmed);

      if (Array.isArray(req)) {
        const responses = await Promise.all(req.map(handleMcpRequest));
        const nonNull = responses.filter(Boolean);
        if (nonNull.length > 0) sendResponse(nonNull);
      } else {
        const response = await handleMcpRequest(req);
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

  log(`Started v${SERVER_VERSION} — stdio mode | db: ${config?.database_url ? "connected" : "not configured"}`);
}

// ── HTTP Server ─────────────────────────────────────────────────────

async function startHttpServer() {
  const { createServer } = await import("node:http");

  const port = parseInt(getFlag("--port") || process.env.PORT || "3100");
  const host = getFlag("--host") || process.env.HOST || "0.0.0.0";
  const authToken = getFlag("--auth-token") || process.env.AUTH_TOKEN || null;

  // Import dashboard components
  let renderPage, dashboardRoutes;
  try {
    const dashUi = await import("./src/dashboard/ui.mjs");
    const dashServer = await import("./src/dashboard/server.mjs");
    renderPage = dashUi.renderPage;
    // We'll integrate dashboard routes directly
  } catch (err) {
    log(`Dashboard module not available: ${err.message}`);
  }

  // Import dashboard API handlers
  let dashApi;
  try {
    dashApi = await import("./src/dashboard/api.mjs");

    // Register config reload hook — when provider config is saved via dashboard,
    // reload from DB and update the running server's embedding/LLM config
    dashApi.setOnConfigSaved(async () => {
      try {
        const dbConfig = await dashApi.loadProviderConfigFromDb();
        if (dbConfig?.embedding?.provider) {
          setConfigs(dbConfig.embedding, dbConfig.llm);
          log(`Config reloaded: embedding=${dbConfig.embedding.provider}, llm=${dbConfig.llm?.provider || 'none'}`);
        }
      } catch (err) {
        rootLog.error({ err, component: "provider" }, "config reload failed");
      }
    });
  } catch (err) {
    rootLog.error({ err, component: "dashboard" }, "dashboard API not available");
  }

  // ── Auth Middleware ──────────────────────────────────────────────

  function checkAuth(req) {
    if (!authToken) return true; // No auth configured
    const header = req.headers.authorization || "";
    if (header === `Bearer ${authToken}`) return true;
    // Also check query param for dashboard
    const url = req.url || "";
    const tokenParam = url.match(/[?&]token=([^&]+)/);
    if (tokenParam && tokenParam[1] === authToken) return true;
    return false;
  }

  // ── Route Helpers ───────────────────────────────────────────────

  function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-cache",
    });
    res.end(body);
  }

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      if (req.method === "GET" || req.method === "DELETE" || req.method === "HEAD") {
        return resolve({});
      }
      const chunks = [];
      let size = 0;
      const MAX_BODY = 4 * 1024 * 1024; // 4MB

      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(); reject(new Error("Request body too large")); return; }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw || raw.trim().length === 0) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); }
      });
      req.on("error", reject);
    });
  }

  function parseQuery(urlStr) {
    const idx = urlStr.indexOf("?");
    if (idx === -1) return {};
    const qs = urlStr.slice(idx + 1);
    const result = {};
    for (const pair of qs.split("&")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) result[decodeURIComponent(pair)] = "";
      else result[decodeURIComponent(pair.slice(0, eqIdx))] = decodeURIComponent(pair.slice(eqIdx + 1));
    }
    return result;
  }

  function getPathname(urlStr) {
    const idx = urlStr.indexOf("?");
    return idx === -1 ? urlStr : urlStr.slice(0, idx);
  }

  // ── Project Hash for Dashboard ──────────────────────────────────

  let _cachedProjectHash = null;

  function resolveProjectHash(query) {
    if (query.project) return query.project;
    if (_cachedProjectHash) return _cachedProjectHash;

    const root = process.cwd();
    const remote = detectGitRemote(root);
    _cachedProjectHash = remote ? djb2Hash(remote) : djb2Hash(root);
    return _cachedProjectHash;
  }

  // ── Dashboard Route Compiler ────────────────────────────────────

  function compileRoute(pattern) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    return { regex: new RegExp(`^${regexStr}$`), paramNames };
  }

  function buildDashboardRoutes() {
    if (!dashApi) return [];

    const embeddingConfig = config?.embedding || null;

    const wrapSync = (fn) => (req, res, params, query, body, ph) => {
      try {
        const result = fn(params, query, body, ph);
        if (result?.status && result?.error) sendJson(res, result.status, { error: result.error });
        else sendJson(res, 200, result);
      } catch (err) { sendJson(res, 500, { error: err.message }); }
    };

    const wrapAsync = (fn) => async (req, res, params, query, body, ph) => {
      try {
        const result = await fn(params, query, body, ph);
        if (result?.status && result?.error) sendJson(res, result.status, { error: result.error });
        else sendJson(res, 200, result);
      } catch (err) { sendJson(res, 500, { error: err.message }); }
    };

    const wrapNoProject = (fn) => (req, res, params, query, body) => {
      try {
        const result = fn(params, query, body);
        if (result?.status && result?.error) sendJson(res, result.status, { error: result.error });
        else sendJson(res, 200, result);
      } catch (err) { sendJson(res, 500, { error: err.message }); }
    };

    const wrapAsyncNoProject = (fn) => async (req, res, params, query, body) => {
      try {
        const result = await fn(params, query, body);
        if (result?.status && result?.error) sendJson(res, result.status, { error: result.error });
        else sendJson(res, 200, result);
      } catch (err) { sendJson(res, 500, { error: err.message }); }
    };

    const defs = [
      ["GET", "/api/stats", wrapAsync(dashApi.getStats)],
      ["GET", "/api/memories", wrapAsync(dashApi.getMemories)],
      ["POST", "/api/memories", wrapAsync(dashApi.storeMemory)],
      ["DELETE", "/api/memories/:id", wrapAsync(dashApi.deleteMemory)],
      ["PATCH", "/api/memories/:id", wrapAsync(dashApi.modifyMemory)],
      ["POST", "/api/memories/search", wrapAsync(dashApi.searchMemoriesRest)],
      ["GET", "/api/memories/usage", wrapAsync(dashApi.getMemoryUsage)],
      ["GET", "/api/memories/:id", wrapAsync(dashApi.getMemory)],
      ["GET", "/api/memories/:id/detail", wrapAsync(dashApi.getMemoryDetail)],
      ["GET", "/api/graph", wrapAsync(dashApi.getGraph)],
      ["GET", "/api/graph/explore/:name", wrapAsync(dashApi.getGraphExplore)],
      ["GET", "/api/graph/stats", wrapAsync(dashApi.getGraphStats)],
      ["GET", "/api/tasks", wrapAsync(dashApi.getTasks)],
      ["POST", "/api/tasks", wrapAsync(dashApi.createTask)],
      ["PATCH", "/api/tasks/:id", wrapAsync(dashApi.updateTask)],
      ["DELETE", "/api/tasks/:id", wrapAsync(dashApi.deleteTask)],
      ["GET", "/api/postmortems", wrapAsync(dashApi.getPostmortems)],
      ["GET", "/api/thinking", wrapAsync(dashApi.getThinkingSequences)],
      ["GET", "/api/thinking/:id", wrapAsync(dashApi.getThinkingSequence)],
      ["GET", "/api/rules", wrapAsync(dashApi.getRules)],
      ["GET", "/api/config", wrapNoProject(dashApi.getConfig)],
      ["GET", "/api/search", wrapAsync((p, q, b, ph) => dashApi.searchMemoriesHandler(p, q, b, ph, embeddingConfig))],
      ["GET", "/api/insights", wrapAsync(dashApi.getInsights)],
      ["GET", "/api/projects", wrapAsyncNoProject(dashApi.getProjects)],
      ["POST", "/api/projects/rename", wrapAsyncNoProject(dashApi.renameProject)],
      ["POST", "/api/backup", wrapNoProject(dashApi.createBackup)],
      ["GET", "/api/export", wrapAsync(dashApi.exportMemories)],
      ["POST", "/api/import", wrapAsync(dashApi.importMemories)],
      // Provider config (setup wizard)
      ["GET", "/api/provider", wrapAsyncNoProject(dashApi.getProviderConfig)],
      ["POST", "/api/provider", wrapAsyncNoProject(dashApi.saveProviderConfig)],
      ["POST", "/api/provider/test", wrapAsyncNoProject(dashApi.testProviderConnection)],
    ];

    return defs.map(([method, pattern, handler]) => {
      const { regex, paramNames } = compileRoute(pattern);
      return { method, regex, paramNames, handler };
    });
  }

  const dashRoutes = buildDashboardRoutes();

  function matchRoute(routes, method, pathname) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const match = route.regex.exec(pathname);
      if (match) {
        const params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  // ── MCP Session Management ──────────────────────────────────────

  let sessionId = null;

  // ── HTTP Server ─────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    // CORS headers for remote MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (!checkAuth(req)) {
      sendJson(res, 401, { error: "Unauthorized. Provide AUTH_TOKEN via Authorization: Bearer <token>" });
      return;
    }

    const pathname = getPathname(req.url || "/");
    const query = parseQuery(req.url || "/");
    const method = req.method || "GET";

    // ── MCP Streamable HTTP Endpoint ────────────────────────────
    if (pathname === "/mcp") {
      // GET opens an SSE stream for server-initiated notifications (Streamable HTTP spec)
      if (method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Mcp-Session-Id": sessionId || "",
        });
        // Keep connection alive with periodic pings
        const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(keepAlive); } }, 15000);
        req.on("close", () => clearInterval(keepAlive));
        return;
      }

      if (method === "DELETE") {
        sessionId = null;
        res.writeHead(204);
        res.end();
        return;
      }

      if (method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      // Validate session (after initialize)
      const clientSessionId = req.headers["mcp-session-id"];
      if (sessionId && clientSessionId && clientSessionId !== sessionId) {
        sendJson(res, 409, { error: "Session ID mismatch" });
        return;
      }

      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }

      // Handle batch or single request
      if (Array.isArray(body)) {
        const responses = await Promise.all(body.map(handleMcpRequest));
        const nonNull = responses.filter(Boolean);

        // Set session ID on initialize
        for (const r of nonNull) {
          if (r.result?.serverInfo) {
            sessionId = randomBytes(16).toString("hex");
            res.setHeader("Mcp-Session-Id", sessionId);
            break;
          }
        }

        sendJson(res, 200, nonNull.length === 1 ? nonNull[0] : nonNull);
      } else {
        const response = await handleMcpRequest(body);

        // Set session ID on initialize response
        if (response?.result?.serverInfo) {
          sessionId = randomBytes(16).toString("hex");
          res.setHeader("Mcp-Session-Id", sessionId);
        }

        if (response) sendJson(res, 200, response);
        else { res.writeHead(204); res.end(); }
      }
      return;
    }

    // ── Health Check ────────────────────────────────────────────
    if (pathname === "/health") {
      const mem = process.memoryUsage();
      // Quick DB health + cheap counts (best effort — don't fail the health check)
      let dbStats = null;
      if (dbReady) {
        try {
          const start = Date.now();
          const { rows } = await dbQuery(`
            SELECT
              (SELECT COUNT(*) FROM memories WHERE is_archived = FALSE) AS memories,
              (SELECT COUNT(*) FROM entities WHERE is_valid = TRUE) AS entities,
              (SELECT COUNT(*) FROM projects) AS projects
          `);
          dbStats = {
            connected: true,
            latency_ms: Date.now() - start,
            memories: parseInt(rows[0]?.memories || 0),
            entities: parseInt(rows[0]?.entities || 0),
            projects: parseInt(rows[0]?.projects || 0),
          };
        } catch (err) {
          dbStats = { connected: false, error: err.message };
        }
      }
      let remoteStats = null;
      try { remoteStats = getRemoteSession(); } catch {}

      sendJson(res, 200, {
        status: "ok",
        version: SERVER_VERSION,
        uptime_seconds: Math.round(process.uptime()),
        memory: {
          rss_mb: Math.round(mem.rss / 1024 / 1024),
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        },
        database: dbStats || { connected: false, reason: "not configured" },
        remote: remoteStats,
        node_version: process.version,
      });
      return;
    }

    // ── System Prompt Endpoint ────────────────────────────────
    if (pathname === "/api/system-prompt" && method === "GET") {
      try {
        const promptPath = join(dirname(new URL(import.meta.url).pathname), "SYSTEM_PROMPT.md");
        const promptContent = readFileSync(promptPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(promptContent);
      } catch (err) {
        sendJson(res, 500, { error: "SYSTEM_PROMPT.md not found" });
      }
      return;
    }

    // ── Dashboard UI ────────────────────────────────────────────
    if (pathname === "/" && method === "GET") {
      if (renderPage) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(renderPage({ onboarding: false }));
      } else {
        sendJson(res, 200, {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          mcp_endpoint: "/mcp",
          dashboard: "not available",
          health: "/health",
        });
      }
      return;
    }

    // ── Dashboard API Routes ────────────────────────────────────
    const match = matchRoute(dashRoutes, method, pathname);
    if (match) {
      const projectHash = resolveProjectHash(query);
      let body = {};
      try { body = await parseBody(req); } catch (err) { sendJson(res, 400, { error: err.message }); return; }
      try {
        await match.handler(req, res, match.params, query, body, projectHash);
      } catch (err) {
        if (!res.headersSent) sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── Remote Terminal Viewer ──────────────────────────────────
    if (pathname === "/remote" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, must-revalidate", "Pragma": "no-cache" });
      res.end(renderRemotePage());
      return;
    }

    if (pathname === "/api/remote/session" && method === "GET") {
      sendJson(res, 200, getRemoteSession());
      return;
    }

    if (pathname === "/api/remote/mode" && method === "POST") {
      let body = {};
      try { body = await parseBody(req); } catch {}
      const result = setRemoteMode(null, null, body);
      sendJson(res, result.status || 200, result);
      return;
    }

    // ── 404 ─────────────────────────────────────────────────────
    sendJson(res, 404, { error: "Not found", endpoints: { mcp: "/mcp", health: "/health", dashboard: "/", remote: "/remote" } });
  });

  // Attach WebSocket handler for remote terminal
  attachRemoteTerminal(server);

  server.listen(port, host, () => {
    log(`Started v${SERVER_VERSION} — HTTP server`);
    log(`MCP endpoint:  http://${host}:${port}/mcp`);
    log(`Dashboard:     http://${host}:${port}/`);
    log(`Remote:        http://${host}:${port}/remote`);
    log(`Health check:  http://${host}:${port}/health`);
    if (authToken) log(`Auth:          enabled (Bearer token)`);
    log(`Database:      ${dbReady ? "PostgreSQL connected" : "not configured"}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${port} in use. Set a different port with --port or PORT env var.`);
      process.exit(1);
    }
    throw err;
  });
}

// ── Logging ─────────────────────────────────────────────────────────

function log(msg) {
  // Backwards-compat wrapper: existing call sites pass plain strings.
  // Route them through pino so we still get structured timestamps/levels.
  const lower = typeof msg === "string" ? msg.toLowerCase() : "";
  if (lower.startsWith("failed") || lower.includes(" error")) {
    rootLog.error(msg);
  } else if (lower.includes("warn")) {
    rootLog.warn(msg);
  } else {
    rootLog.info(msg);
  }
}

// ── Graceful Shutdown ───────────────────────────────────────────────

process.on("SIGINT", async () => { await closeDatabase(); process.exit(0); });
process.on("SIGTERM", async () => { await closeDatabase(); process.exit(0); });

// ── Uncaught Error Sentinel ─────────────────────────────────────────
// Route uncaught exceptions + unhandled rejections into pino AND — best-effort —
// persist them as a debug memory so `memory_postmortem_warnings` surfaces them
// in the next Claude Code session. The system memory uses project_hash "system".

async function persistErrorMemory(err, kind) {
  try {
    const { generateId, contentHash } = await import("./src/db.mjs");
    const content = `[${kind}] ${err?.message || String(err)}\n${err?.stack || ""}`.slice(0, 8000);
    const id = generateId();
    const hash = contentHash(content);
    await dbQuery(
      `INSERT INTO memories (id, content, type, project_hash, importance_score, tags, related_files, content_hash, is_archived, created_at, updated_at)
       VALUES ($1, $2, 'debug', 'system', 1.0, $3, '[]', $4, FALSE, NOW(), NOW())
       ON CONFLICT (project_hash, content_hash) DO NOTHING`,
      [id, content, JSON.stringify([kind, "crash", "auto-captured"]), hash]
    );
  } catch { /* best effort — DB may be down or migration old */ }
}

process.on("uncaughtException", async (err) => {
  rootLog.fatal({ err }, "uncaught exception");
  await persistErrorMemory(err, "uncaughtException");
  // Flush logs and exit so Docker restarts us cleanly.
  setTimeout(() => process.exit(1), 200);
});

process.on("unhandledRejection", async (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  rootLog.error({ err }, "unhandled promise rejection");
  await persistErrorMemory(err, "unhandledRejection");
  // Don't exit on unhandled rejection — log and continue
});
