/**
 * Embedded HTTP dashboard server for MEMAXX Memory-Local.
 * Uses node:http built-in only (zero dependencies).
 * Binds to 127.0.0.1 only with DNS rebinding protection.
 */

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { renderPage } from "./ui.mjs";
import {
  getStats,
  getMemories,
  getMemory,
  getGraph,
  getGraphExplore,
  getGraphStats,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getPostmortems,
  getThinkingSequences,
  getThinkingSequence,
  getRules,
  getConfig,
  searchMemoriesHandler,
  getInsights,
  getProjects,
  createBackup,
  exportMemories,
  importMemories,
  getMemoryDetail,
} from "./api.mjs";

// ── Allowed Host headers (DNS rebinding protection) ──────────────────

const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function isAllowedHost(hostHeader, port) {
  if (!hostHeader) return false;
  // Strip port if present
  const host = hostHeader.replace(/:\d+$/, "");
  if (ALLOWED_HOSTS.has(host)) return true;
  // Also allow localhost:<port> and 127.0.0.1:<port>
  if (ALLOWED_HOSTS.has(hostHeader)) return true;
  return false;
}

// ── Route Definition ─────────────────────────────────────────────────

/**
 * Each route: [method, pattern, handler]
 * Pattern supports :param syntax for path parameters.
 * Pattern is compiled to a RegExp at startup.
 */
function compileRoute(pattern) {
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function buildRoutes(embeddingConfig, onboarding = false) {
  const defs = [
    // HTML page
    ["GET", "/", (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(renderPage({ onboarding }));
    }],

    // API routes
    ["GET", "/api/stats", wrapSync(getStats)],
    ["GET", "/api/memories", wrapSync(getMemories)],
    ["GET", "/api/memories/:id", wrapSync(getMemory)],
    ["GET", "/api/graph", wrapSync(getGraph)],
    ["GET", "/api/graph/explore/:name", wrapSync(getGraphExplore)],
    ["GET", "/api/graph/stats", wrapSync(getGraphStats)],
    ["GET", "/api/tasks", wrapSync(getTasks)],
    ["POST", "/api/tasks", wrapSync(createTask)],
    ["PATCH", "/api/tasks/:id", wrapSync(updateTask)],
    ["DELETE", "/api/tasks/:id", wrapSync(deleteTask)],
    ["GET", "/api/postmortems", wrapSync(getPostmortems)],
    ["GET", "/api/thinking", wrapSync(getThinkingSequences)],
    ["GET", "/api/thinking/:id", wrapSync(getThinkingSequence)],
    ["GET", "/api/rules", wrapSync(getRules)],
    ["GET", "/api/config", wrapNoProject(getConfig)],
    ["GET", "/api/search", wrapAsync((params, query, body, ph) => searchMemoriesHandler(params, query, body, ph, embeddingConfig))],
    ["GET", "/api/insights", wrapSync(getInsights)],
    ["GET", "/api/projects", wrapNoProject(getProjects)],
    ["POST", "/api/backup", wrapNoProject(createBackup)],
    ["GET", "/api/export", wrapSync(exportMemories)],
    ["POST", "/api/import", wrapSync(importMemories)],
    ["GET", "/api/memories/:id/detail", wrapSync(getMemoryDetail)],
  ];

  return defs.map(([method, pattern, handler]) => {
    const { regex, paramNames } = compileRoute(pattern);
    return { method, pattern, regex, paramNames, handler };
  });
}

// ── Handler Wrappers ─────────────────────────────────────────────────

/** Wrap a synchronous API handler into an HTTP handler */
function wrapSync(fn) {
  return (req, res, params, query, body, projectHash) => {
    try {
      const result = fn(params, query, body, projectHash);
      if (result && result.status && result.error) {
        sendJson(res, result.status, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      log(`Error in ${req.url}: ${err.message}`);
      sendJson(res, 500, { error: "Internal server error", detail: err.message });
    }
  };
}

/** Wrap an async API handler into an HTTP handler */
function wrapAsync(fn) {
  return async (req, res, params, query, body, projectHash) => {
    try {
      const result = await fn(params, query, body, projectHash);
      if (result && result.status && result.error) {
        sendJson(res, result.status, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      log(`Error in ${req.url}: ${err.message}`);
      sendJson(res, 500, { error: "Internal server error", detail: err.message });
    }
  };
}

/** Wrap handlers that don't need projectHash */
function wrapNoProject(fn) {
  return (req, res, params, query, body, _projectHash) => {
    try {
      const result = fn(params, query, body);
      if (result && result.status && result.error) {
        sendJson(res, result.status, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      log(`Error in ${req.url}: ${err.message}`);
      sendJson(res, 500, { error: "Internal server error", detail: err.message });
    }
  };
}

// ── Response Helpers ─────────────────────────────────────────────────

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function send404(res) {
  sendJson(res, 404, { error: "Not found" });
}

function send405(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}

function send403(res) {
  sendJson(res, 403, { error: "Forbidden — request rejected (DNS rebinding protection)" });
}

// ── JSON Body Parser ─────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "DELETE" || req.method === "HEAD") {
      return resolve({});
    }

    const chunks = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1MB

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw || raw.trim().length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON in request body"));
      }
    });

    req.on("error", reject);
  });
}

// ── Query String Parser ──────────────────────────────────────────────

function parseQuery(urlStr) {
  const idx = urlStr.indexOf("?");
  if (idx === -1) return {};
  const qs = urlStr.slice(idx + 1);
  const result = {};
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      result[decodeURIComponent(pair)] = "";
    } else {
      result[decodeURIComponent(pair.slice(0, eqIdx))] = decodeURIComponent(pair.slice(eqIdx + 1));
    }
  }
  return result;
}

function getPathname(urlStr) {
  const idx = urlStr.indexOf("?");
  return idx === -1 ? urlStr : urlStr.slice(0, idx);
}

// ── Router ───────────────────────────────────────────────────────────

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

// ── Project Hash Resolution ──────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

let _cachedProjectHash = null;

function resolveProjectHash(query) {
  // Allow override via ?project= query param
  if (query.project) return query.project;

  // Use cached value
  if (_cachedProjectHash) return _cachedProjectHash;

  const root = process.cwd();

  // Priority 1: Read .memaxx/project.json (same as bin.mjs/tools.mjs)
  try {
    const projectJson = JSON.parse(readFileSync(join(root, ".memaxx", "project.json"), "utf-8"));
    if (projectJson.id) {
      _cachedProjectHash = projectJson.id;
      return _cachedProjectHash;
    }
  } catch { /* no project.json */ }

  // Priority 2: DJB2 hash of cwd (fallback)
  let hash = 5381;
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  _cachedProjectHash = Math.abs(hash).toString(36);
  return _cachedProjectHash;
}

// ── Browser Opener ───────────────────────────────────────────────────

function openBrowser(url) {
  const plat = platform();
  try {
    if (plat === "darwin") {
      exec(`open "${url}"`);
    } else if (plat === "linux") {
      exec(`xdg-open "${url}"`);
    } else if (plat === "win32") {
      exec(`start "" "${url}"`);
    }
  } catch {
    // Non-critical — user can open manually
  }
}

// ── Server ───────────────────────────────────────────────────────────

/** @type {import("node:http").Server | null} */
let _server = null;

/**
 * Start the dashboard HTTP server.
 * @param {{ port?: number, config?: object, quiet?: boolean, onboarding?: boolean }} options
 * @returns {Promise<import("node:http").Server>}
 */
export function startDashboard({ port = 52427, config = null, quiet = false, onboarding = false } = {}) {
  return new Promise((resolve, reject) => {
    // Build embedding config from the config object for search
    // Config uses nested structure: config.embedding.{provider, api_key, ...}
    const embeddingConfig = config?.embedding ? {
      provider: config.embedding.provider,
      api_key: config.embedding.api_key,
      base_url: config.embedding.base_url,
      model: config.embedding.model,
      dimension: config.embedding.dimension || 1536,
    } : null;

    const routes = buildRoutes(embeddingConfig, onboarding);

    const server = createServer(async (req, res) => {
      // DNS rebinding protection
      const host = req.headers.host || "";
      if (!isAllowedHost(host, port)) {
        send403(res);
        return;
      }

      const pathname = getPathname(req.url || "/");
      const query = parseQuery(req.url || "/");
      const method = req.method || "GET";

      // Match route
      const match = matchRoute(routes, method, pathname);

      if (!match) {
        // Check if route exists for a different method
        const anyMethodMatch = routes.some(r => r.regex.test(pathname));
        if (anyMethodMatch) {
          send405(res);
        } else {
          send404(res);
        }
        return;
      }

      // Parse body for POST/PATCH/PUT
      let body = {};
      try {
        body = await parseBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }

      // Resolve project hash
      const projectHash = resolveProjectHash(query);

      // Execute handler
      try {
        await match.handler(req, res, match.params, query, body, projectHash);
      } catch (err) {
        log(`Unhandled error: ${err.message}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      }
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        if (!quiet) log(`Port ${port} in use, trying ${port + 1}...`);
        server.close();
        startDashboard({ port: port + 1, config, quiet }).then(resolve, reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      _server = server;
      const url = `http://127.0.0.1:${port}`;
      if (!quiet) {
        log(`Dashboard running at ${url}`);
        openBrowser(url);
      }
      resolve(server);
    });
  });
}

/**
 * Stop the dashboard server.
 * @returns {Promise<void>}
 */
export function stopDashboard() {
  return new Promise((resolve) => {
    if (_server) {
      _server.close(() => {
        _server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/** Get the current server instance (for external shutdown) */
export function getServer() {
  return _server;
}

// ── Logging ──────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`[memaxx-dashboard] ${msg}\n`);
}
