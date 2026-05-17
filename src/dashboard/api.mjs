/**
 * REST API handlers for the MEMAXX Memory dashboard.
 * Each handler receives (params, query, body, projectHash) and returns a plain object.
 * Uses PostgreSQL queries via query() — does NOT call MCP tool handlers.
 */

import { query, generateId, contentHash } from "../db.mjs";
import { searchMemories as hybridSearch } from "../search.mjs";
import { readConfig, DEFAULT_MODELS, PROVIDER_URLS, getEmbeddingDimension } from "../config.mjs";
import { copyFileSync, statSync } from "node:fs";

// ── Config reload hook (set by bin.mjs to reload after save) ────────
let _onConfigSaved = null;
export function setOnConfigSaved(fn) { _onConfigSaved = fn; }

// ── Helpers ──────────────────────────────────────────────────────────

function safeParseJson(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val; // JSONB already parsed
  try { return JSON.parse(val); } catch { return fallback; }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ── Stats ────────────────────────────────────────────────────────────

export async function getStats(params, query_, body, projectHash) {
  const { rows: totalRows } = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = FALSE",
    [projectHash]
  );
  const totalMemories = parseInt(totalRows[0]?.c) || 0;

  const { rows: entityRows } = await query(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
    [projectHash]
  );
  const totalEntities = parseInt(entityRows[0]?.c) || 0;

  const { rows: relationRows } = await query(
    "SELECT COUNT(*) as c FROM relations WHERE project_hash = $1 AND is_valid = TRUE",
    [projectHash]
  );
  const totalRelations = parseInt(relationRows[0]?.c) || 0;

  const { rows: taskRows } = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1",
    [projectHash]
  );
  const totalTasks = parseInt(taskRows[0]?.c) || 0;

  const { rows: openTaskRows } = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1 AND status = 'open'",
    [projectHash]
  );
  const openTasks = parseInt(openTaskRows[0]?.c) || 0;

  const { rows: pmRows } = await query(
    "SELECT COUNT(*) as c FROM postmortems WHERE project_hash = $1",
    [projectHash]
  );
  const totalPostmortems = parseInt(pmRows[0]?.c) || 0;

  const { rows: typeRows } = await query(`
    SELECT type, COUNT(*) as count
    FROM memories WHERE project_hash = $1 AND is_archived = FALSE
    GROUP BY type ORDER BY count DESC
  `, [projectHash]);

  const typeBreakdown = {};
  for (const r of typeRows) typeBreakdown[r.type] = parseInt(r.count);

  const { rows: recentMemories } = await query(`
    SELECT id, content, type, importance_score, created_at
    FROM memories WHERE project_hash = $1 AND is_archived = FALSE
    ORDER BY created_at DESC LIMIT 5
  `, [projectHash]);

  return {
    total_memories: totalMemories,
    total_entities: totalEntities,
    total_relations: totalRelations,
    total_tasks: totalTasks,
    open_tasks: openTasks,
    total_postmortems: totalPostmortems,
    type_breakdown: typeBreakdown,
    recent_memories: recentMemories,
  };
}

// ── Memories ─────────────────────────────────────────────────────────

export async function getMemories(params, query_, body, projectHash) {
  const page = clamp(parseInt(query_.page) || 1, 1, 10000);
  const limit = clamp(parseInt(query_.limit) || 20, 1, 100);
  const offset = (page - 1) * limit;
  const type = query_.type || null;
  const q = query_.q || null;

  let sql = `
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, retrieval_count, is_archived, created_at, updated_at
    FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
  `;
  let countSql = `
    SELECT COUNT(*) as c FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
  `;
  const sqlParams = [projectHash];
  const countParams = [projectHash];
  let paramIdx = 2;

  if (type) {
    sql += ` AND type = $${paramIdx}`;
    countSql += ` AND type = $${paramIdx}`;
    sqlParams.push(type);
    countParams.push(type);
    paramIdx++;
  }

  if (q) {
    sql += ` AND content LIKE $${paramIdx}`;
    countSql += ` AND content LIKE $${paramIdx}`;
    const likeParam = `%${q}%`;
    sqlParams.push(likeParam);
    countParams.push(likeParam);
    paramIdx++;
  }

  const { rows: countRows } = await query(countSql, countParams);
  const total = parseInt(countRows[0]?.c) || 0;

  sql += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  sqlParams.push(limit, offset);

  const { rows } = await query(sql, sqlParams);
  const memories = rows.map(r => ({
    ...r,
    tags: safeParseJson(r.tags, []),
    related_files: safeParseJson(r.related_files, []),
  }));

  return {
    memories,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  };
}

export async function getMemory(params, query_, body, projectHash) {
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  const { rows } = await query(
    "SELECT * FROM memories WHERE id = $1 AND project_hash = $2",
    [id, projectHash]
  );
  const memory = rows[0];

  if (!memory) return { error: "Memory not found", status: 404 };

  return {
    ...memory,
    tags: safeParseJson(memory.tags, []),
    related_files: safeParseJson(memory.related_files, []),
  };
}

// ── Memory CRUD (for desktop app) ────────────────────────────────────

export async function storeMemory(params, query_, body, projectHash) {
  if (!body?.content || body.content.trim().length < 10) {
    return { error: "Content too short (min 10 chars)", status: 400 };
  }

  const id = generateId();
  const hash = contentHash(body.content);

  // Dedup check
  const { rows: existing } = await query(
    "SELECT id FROM memories WHERE project_hash = $1 AND content_hash = $2",
    [projectHash, hash]
  );
  if (existing[0]) return { id: existing[0].id, deduplicated: true };

  const tags = JSON.stringify(body.tags || []);
  const relatedFiles = JSON.stringify(body.related_files || []);
  const score = body.importance_score ?? 0.5;

  await query(
    `INSERT INTO memories (id, content, type, project_hash, importance_score, tags, related_files,
       session_name, content_hash, is_archived, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW(), NOW())`,
    [id, body.content.trim(), body.type || "learning", projectHash, score,
     tags, relatedFiles, body.session_name || null, hash]
  );

  return { id, stored: true, importance_score: score };
}

export async function deleteMemory(params, query_, body, projectHash) {
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  await query(
    "UPDATE memories SET is_archived = TRUE, updated_at = NOW() WHERE id = $1 AND project_hash = $2",
    [id, projectHash]
  );
  return { deleted: true, id };
}

export async function modifyMemory(params, query_, body, projectHash) {
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  const updates = [];
  const values = [];
  let idx = 1;

  const fields = { content: "content", type: "type", importance_score: "importance_score", session_name: "session_name" };
  for (const [key, col] of Object.entries(fields)) {
    if (body[key] !== undefined) {
      updates.push(`${col} = $${idx}`);
      values.push(body[key]);
      idx++;
    }
  }
  if (body.tags !== undefined) { updates.push(`tags = $${idx}`); values.push(JSON.stringify(body.tags)); idx++; }
  if (body.related_files !== undefined) { updates.push(`related_files = $${idx}`); values.push(JSON.stringify(body.related_files)); idx++; }

  if (updates.length === 0) return { error: "No fields to update", status: 400 };

  updates.push("updated_at = NOW()");
  values.push(id, projectHash);

  await query(
    `UPDATE memories SET ${updates.join(", ")} WHERE id = $${idx} AND project_hash = $${idx + 1}`,
    values
  );

  const { rows } = await query("SELECT * FROM memories WHERE id = $1", [id]);
  if (!rows[0]) return { error: "Memory not found", status: 404 };

  return { ...rows[0], tags: safeParseJson(rows[0].tags, []), related_files: safeParseJson(rows[0].related_files, []) };
}

export async function searchMemoriesRest(params, query_, body, projectHash) {
  const q = body?.query || query_?.q || "";
  const limit = Math.min(parseInt(body?.limit || query_?.limit || "20"), 100);
  const type = body?.memory_type || query_?.type || null;

  if (!q) return { results: [], total: 0 };

  let sql = `SELECT id, content, type, importance_score, tags, related_files,
             session_name, created_at, updated_at
             FROM memories WHERE project_hash = $1 AND is_archived = FALSE AND content ILIKE $2`;
  const sqlParams = [projectHash, `%${q}%`];
  let idx = 3;

  if (type) { sql += ` AND type = $${idx}`; sqlParams.push(type); idx++; }

  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  sqlParams.push(limit);

  const { rows } = await query(sql, sqlParams);
  const results = rows.map(r => ({ ...r, tags: safeParseJson(r.tags, []), related_files: safeParseJson(r.related_files, []) }));
  return { results, total: results.length };
}

export async function getMemoryUsage(params, query_, body, projectHash) {
  const { rows } = await query(
    "SELECT COUNT(*) as active FROM memories WHERE project_hash = $1 AND is_archived = FALSE", [projectHash]
  );
  const { rows: archived } = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = TRUE", [projectHash]
  );
  return {
    plan: "selfhost",
    active: parseInt(rows[0]?.active || 0),
    archived: parseInt(archived[0]?.c || 0),
    limits: { max_memories: -1, injection_per_request: -1, retention_days: -1, cross_project: true, mcp_access: true, passive_extraction: true, memory_export: true },
  };
}

// ── Knowledge Graph ──────────────────────────────────────────────────

export async function getGraph(params, query_, body, projectHash) {
  // Get the 200 most-connected entities for performance
  const { rows: nodes } = await query(`
    SELECT e.id, e.name, e.type, e.description, e.confidence, e.created_at,
           COUNT(r.id) as connections
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = TRUE
    WHERE e.project_hash = $1 AND e.is_valid = TRUE
    GROUP BY e.id
    ORDER BY connections DESC
    LIMIT 200
  `, [projectHash]);

  const nodeIds = new Set(nodes.map(n => n.id));

  // Get relations only between the selected nodes
  let edges = [];
  if (nodeIds.size > 0) {
    const { rows: allRelations } = await query(`
      SELECT id, source_id, target_id, relation, confidence, valid_from, valid_to, created_at
      FROM relations
      WHERE project_hash = $1 AND is_valid = TRUE
    `, [projectHash]);

    edges = allRelations.filter(r => nodeIds.has(r.source_id) && nodeIds.has(r.target_id));
  }

  return { nodes, edges };
}

export async function getGraphExplore(params, query_, body, projectHash) {
  const entityName = decodeURIComponent(params.name || "");
  if (!entityName) return { error: "Entity name required", status: 400 };

  // Find root entity
  const { rows: rootRows } = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2) AND is_valid = TRUE",
    [projectHash, entityName]
  );
  const root = rootRows[0];

  if (!root) return { entity: null, message: `Entity "${entityName}" not found.` };

  // BFS traversal up to depth 3
  const maxDepth = 3;
  const visited = new Set([root.id]);
  const nodes = [{ ...root, depth: 0 }];
  const edges = [];
  let frontier = [root.id];

  for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
    const nextFrontier = [];
    const srcPlaceholders = frontier.map((_, i) => `$${i + 1}`).join(",");
    const tgtPlaceholders = frontier.map((_, i) => `$${frontier.length + i + 1}`).join(",");

    const { rows: rels } = await query(`
      SELECT r.*, e1.name as source_name, e2.name as target_name
      FROM relations r
      JOIN entities e1 ON r.source_id = e1.id
      JOIN entities e2 ON r.target_id = e2.id
      WHERE r.is_valid = TRUE AND (r.source_id IN (${srcPlaceholders}) OR r.target_id IN (${tgtPlaceholders}))
    `, [...frontier, ...frontier]);

    for (const rel of rels) {
      edges.push(rel);
      for (const neighborId of [rel.source_id, rel.target_id]) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const { rows: entityRows } = await query("SELECT * FROM entities WHERE id = $1", [neighborId]);
          const entity = entityRows[0];
          if (entity) {
            nodes.push({ ...entity, depth: d + 1 });
            nextFrontier.push(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return { root, nodes, edges, depth: maxDepth };
}

export async function getGraphStats(params, query_, body, projectHash) {
  const { rows: ecRows } = await query(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
    [projectHash]
  );
  const entityCount = parseInt(ecRows[0]?.c) || 0;

  const { rows: rcRows } = await query(
    "SELECT COUNT(*) as c FROM relations WHERE project_hash = $1 AND is_valid = TRUE",
    [projectHash]
  );
  const relationCount = parseInt(rcRows[0]?.c) || 0;

  const { rows: typeDistribution } = await query(`
    SELECT type, COUNT(*) as count FROM entities
    WHERE project_hash = $1 AND is_valid = TRUE
    GROUP BY type ORDER BY count DESC
  `, [projectHash]);

  const { rows: topEntities } = await query(`
    SELECT e.name, e.type, COUNT(r.id) as connection_count
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = TRUE
    WHERE e.project_hash = $1 AND e.is_valid = TRUE
    GROUP BY e.id, e.name, e.type
    ORDER BY connection_count DESC
    LIMIT 10
  `, [projectHash]);

  return {
    entity_count: entityCount,
    relation_count: relationCount,
    type_distribution: typeDistribution,
    top_entities: topEntities,
  };
}

// ── Tasks ────────────────────────────────────────────────────────────

export async function getTasks(params, query_, body, projectHash) {
  const { rows: tasks } = await query(`
    SELECT * FROM tasks WHERE project_hash = $1
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      created_at DESC
  `, [projectHash]);

  // Group by status
  const grouped = {};
  for (const t of tasks) {
    const s = t.status || "open";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }

  return { tasks, grouped, total: tasks.length };
}

export async function createTask(params, query_, body, projectHash) {
  if (!body || !body.title) return { error: "Task title required", status: 400 };

  const id = generateId();
  await query(
    "INSERT INTO tasks (id, project_hash, title, description, priority) VALUES ($1, $2, $3, $4, $5)",
    [id, projectHash, body.title, body.description || null, body.priority || "medium"]
  );

  const { rows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
  return { id, created: true, task: rows[0] };
}

export async function updateTask(params, query_, body, projectHash) {
  const taskId = params.id;
  if (!taskId) return { error: "Task ID required", status: 400 };

  const { rows: existingRows } = await query(
    "SELECT * FROM tasks WHERE id = $1 AND project_hash = $2",
    [taskId, projectHash]
  );
  if (!existingRows[0]) return { error: "Task not found", status: 404 };

  if (!body || Object.keys(body).length === 0) return { error: "No fields to update", status: 400 };

  const updates = [];
  const updateParams = [];
  let paramIdx = 1;

  if (body.title !== undefined) { updates.push(`title = $${paramIdx++}`); updateParams.push(body.title); }
  if (body.description !== undefined) { updates.push(`description = $${paramIdx++}`); updateParams.push(body.description); }
  if (body.status !== undefined) {
    updates.push(`status = $${paramIdx++}`);
    updateParams.push(body.status);
    if (body.status === "completed") {
      updates.push("completed_at = NOW()");
    }
  }
  if (body.priority !== undefined) { updates.push(`priority = $${paramIdx++}`); updateParams.push(body.priority); }

  if (updates.length === 0) return { error: "No valid fields to update", status: 400 };

  updates.push("updated_at = NOW()");
  updateParams.push(taskId, projectHash);

  await query(
    `UPDATE tasks SET ${updates.join(", ")} WHERE id = $${paramIdx++} AND project_hash = $${paramIdx}`,
    updateParams
  );

  const { rows } = await query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  return { updated: true, task: rows[0] };
}

export async function deleteTask(params, query_, body, projectHash) {
  const taskId = params.id;
  if (!taskId) return { error: "Task ID required", status: 400 };

  const { rows: existingRows } = await query(
    "SELECT * FROM tasks WHERE id = $1 AND project_hash = $2",
    [taskId, projectHash]
  );
  if (!existingRows[0]) return { error: "Task not found", status: 404 };

  await query("DELETE FROM tasks WHERE id = $1 AND project_hash = $2", [taskId, projectHash]);
  return { deleted: true, id: taskId };
}

// ── Postmortems ──────────────────────────────────────────────────────

export async function getPostmortems(params, query_, body, projectHash) {
  const { rows } = await query(`
    SELECT * FROM postmortems WHERE project_hash = $1
    ORDER BY created_at DESC
  `, [projectHash]);

  const postmortems = rows.map(pm => ({
    ...pm,
    affected_files: safeParseJson(pm.affected_files, []),
  }));

  return { postmortems, total: postmortems.length };
}

// ── Thinking ─────────────────────────────────────────────────────────

export async function getThinkingSequences(params, query_, body, projectHash) {
  const { rows: sequences } = await query(`
    SELECT ts.*, COUNT(tt.id) as thought_count
    FROM thinking_sequences ts
    LEFT JOIN thinking_thoughts tt ON ts.id = tt.sequence_id
    WHERE ts.project_hash = $1
    GROUP BY ts.id
    ORDER BY ts.created_at DESC
  `, [projectHash]);

  return { sequences, total: sequences.length };
}

export async function getThinkingSequence(params, query_, body, projectHash) {
  const sequenceId = params.id;
  if (!sequenceId) return { error: "Sequence ID required", status: 400 };

  const { rows: seqRows } = await query(
    "SELECT * FROM thinking_sequences WHERE id = $1 AND project_hash = $2",
    [sequenceId, projectHash]
  );
  const sequence = seqRows[0];

  if (!sequence) return { error: "Thinking sequence not found", status: 404 };

  const { rows: thoughts } = await query(
    "SELECT * FROM thinking_thoughts WHERE sequence_id = $1 ORDER BY created_at ASC",
    [sequenceId]
  );

  return { ...sequence, thoughts };
}

// ── Rules ────────────────────────────────────────────────────────────

// Built-in rules (same as tools.mjs)
const BUILT_IN_RULES = [
  { id: "sec-01", category: "security", severity: "critical", rule: "Never commit secrets, API keys, or credentials to git. Use environment variables." },
  { id: "sec-02", category: "security", severity: "critical", rule: "Validate and sanitize all user input at system boundaries." },
  { id: "sec-03", category: "security", severity: "high", rule: "Use parameterized queries — never concatenate user input into SQL." },
  { id: "sec-04", category: "security", severity: "high", rule: "Set httpOnly and Secure flags on authentication cookies." },
  { id: "sec-05", category: "security", severity: "high", rule: "Escape output to prevent XSS — use framework auto-escaping." },
  { id: "sec-06", category: "security", severity: "medium", rule: "Implement rate limiting on authentication and API endpoints." },
  { id: "sec-07", category: "security", severity: "medium", rule: "Use CSRF tokens for state-changing requests from browsers." },
  { id: "sec-08", category: "security", severity: "medium", rule: "Set proper CORS headers — never use Access-Control-Allow-Origin: *." },
  { id: "sec-09", category: "security", severity: "high", rule: "Hash passwords with bcrypt/argon2 — never store plaintext." },
  { id: "sec-10", category: "security", severity: "medium", rule: "Validate file uploads: check type, size, and sanitize filenames." },
  { id: "arch-01", category: "architecture", severity: "high", rule: "Keep components/functions focused — single responsibility principle." },
  { id: "arch-02", category: "architecture", severity: "medium", rule: "Separate business logic from framework/transport layer." },
  { id: "arch-03", category: "architecture", severity: "medium", rule: "Use dependency injection for external services to enable testing." },
  { id: "arch-04", category: "architecture", severity: "low", rule: "Prefer composition over inheritance." },
  { id: "arch-05", category: "architecture", severity: "medium", rule: "Keep database queries in a data access layer — not in route handlers." },
  { id: "arch-06", category: "architecture", severity: "high", rule: "Handle errors explicitly — don't swallow exceptions silently." },
  { id: "arch-07", category: "architecture", severity: "medium", rule: "Use TypeScript strict mode — avoid 'any' type." },
  { id: "arch-08", category: "architecture", severity: "low", rule: "Keep functions under 50 lines — extract if longer." },
  { id: "arch-09", category: "architecture", severity: "medium", rule: "Define clear API contracts with schemas (Zod, JSON Schema)." },
  { id: "arch-10", category: "architecture", severity: "high", rule: "Never modify shared state without synchronization in concurrent code." },
  { id: "perf-01", category: "performance", severity: "high", rule: "Add database indexes for columns used in WHERE, JOIN, and ORDER BY." },
  { id: "perf-02", category: "performance", severity: "medium", rule: "Paginate large result sets — never fetch unbounded data." },
  { id: "perf-03", category: "performance", severity: "medium", rule: "Use caching for expensive computations and frequent reads." },
  { id: "perf-04", category: "performance", severity: "low", rule: "Lazy-load heavy resources (images, modules, data) when possible." },
  { id: "perf-05", category: "performance", severity: "high", rule: "Avoid N+1 queries — use JOINs or batch fetching." },
  { id: "test-01", category: "testing", severity: "medium", rule: "Write tests for business-critical paths and edge cases." },
  { id: "test-02", category: "testing", severity: "low", rule: "Use descriptive test names that explain the expected behavior." },
  { id: "test-03", category: "testing", severity: "medium", rule: "Mock external services in tests — don't make real API calls." },
  { id: "test-04", category: "testing", severity: "low", rule: "Keep tests independent — no shared mutable state between tests." },
  { id: "test-05", category: "testing", severity: "medium", rule: "Test error paths, not just happy paths." },
];

export async function getRules(params, query_, body, projectHash) {
  const { rows: userRules } = await query(
    "SELECT * FROM rules WHERE project_hash = $1 AND is_active = TRUE",
    [projectHash]
  );

  return {
    user_rules: userRules,
    built_in_rules: BUILT_IN_RULES,
    total: userRules.length + BUILT_IN_RULES.length,
  };
}

// ── Config ───────────────────────────────────────────────────────────

export function getConfig() {
  const config = readConfig();
  if (!config) return { error: "No config found", status: 404 };

  // Deep clone and redact API keys
  const redacted = JSON.parse(JSON.stringify(config));

  function redactKeys(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string" && /api_key|apikey|secret|token|password/i.test(key)) {
        const val = obj[key];
        if (val.length > 4) {
          obj[key] = "***" + val.slice(-4);
        } else {
          obj[key] = "***";
        }
      } else if (typeof obj[key] === "object") {
        redactKeys(obj[key]);
      }
    }
  }

  redactKeys(redacted);
  return redacted;
}

// ── Search ───────────────────────────────────────────────────────────

export async function searchMemoriesHandler(params, query_, body, projectHash, embeddingConfig) {
  const q = query_.q || "";
  if (!q) return { error: "Query parameter 'q' is required", status: 400 };

  const mode = query_.mode || "hybrid";
  const type = query_.type || undefined;
  const limit = clamp(parseInt(query_.limit) || 10, 1, 50);

  const results = await hybridSearch({
    query: q.slice(0, 500),
    projectHash,
    searchMode: mode,
    memoryType: type,
    limit,
  }, embeddingConfig);

  return results;
}

// ── Insights ─────────────────────────────────────────────────────────

export async function getInsights(params, query_, body, projectHash) {
  const { rows: tmRows } = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = FALSE",
    [projectHash]
  );
  const totalMemories = parseInt(tmRows[0]?.c) || 0;

  const { rows: teRows } = await query(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
    [projectHash]
  );
  const totalEntities = parseInt(teRows[0]?.c) || 0;

  const { rows: ttRows } = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1",
    [projectHash]
  );
  const totalTasks = parseInt(ttRows[0]?.c) || 0;

  const { rows: otRows } = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1 AND status = 'open'",
    [projectHash]
  );
  const openTasks = parseInt(otRows[0]?.c) || 0;

  const { rows: typeBreakdown } = await query(`
    SELECT type, COUNT(*) as count, AVG(importance_score) as avg_importance
    FROM memories WHERE project_hash = $1 AND is_archived = FALSE
    GROUP BY type ORDER BY count DESC
  `, [projectHash]);

  // Recent activity (last 7 days)
  const { rows: recentActivity } = await query(`
    SELECT DATE(created_at) as day, COUNT(*) as count
    FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
      AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at)
    ORDER BY day DESC
  `, [projectHash]);

  // Entity clusters: top entities with their connections
  const { rows: entityClusters } = await query(`
    SELECT e.name, e.type, COUNT(r.id) as connections
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = TRUE
    WHERE e.project_hash = $1 AND e.is_valid = TRUE
    GROUP BY e.id, e.name, e.type
    ORDER BY connections DESC
    LIMIT 20
  `, [projectHash]);

  const { rows: recentPostmortems } = await query(`
    SELECT id, title, bug_category, severity, created_at
    FROM postmortems WHERE project_hash = $1
    ORDER BY created_at DESC LIMIT 5
  `, [projectHash]);

  return {
    total_memories: totalMemories,
    total_entities: totalEntities,
    total_tasks: totalTasks,
    open_tasks: openTasks,
    type_breakdown: typeBreakdown,
    recent_activity: recentActivity,
    entity_clusters: entityClusters,
    recent_postmortems: recentPostmortems,
  };
}

// ── Backup ───────────────────────────────────────────────────────────

export async function createBackup() {
  // Postgres backup — write a JSON snapshot via the existing daily-backup module.
  try {
    const { runBackup } = await import("../backup.mjs");
    const result = await runBackup({ force: true });
    return { success: true, ...result };
  } catch (err) {
    return { error: `Backup failed: ${err.message}`, status: 500 };
  }
}

// ── Export / Import ──────────────────────────────────────────────────

export async function exportMemories(params, query_, body, projectHash) {
  const { rows: memoryRows } = await query(`
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, content_hash, retrieval_count, created_at, updated_at
    FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
    ORDER BY created_at DESC
  `, [projectHash]);

  const memories = memoryRows.map(m => ({
    ...m,
    tags: safeParseJson(m.tags, []),
    related_files: safeParseJson(m.related_files, []),
  }));

  const { rows: entities } = await query(`
    SELECT id, name, type, description, confidence, created_at
    FROM entities WHERE project_hash = $1 AND is_valid = TRUE
  `, [projectHash]);

  const { rows: relations } = await query(`
    SELECT r.id, s.name as source, t.name as target, r.relation, r.confidence, r.valid_from, r.valid_to, r.created_at
    FROM relations r
    JOIN entities s ON r.source_id = s.id
    JOIN entities t ON r.target_id = t.id
    WHERE r.project_hash = $1 AND r.is_valid = TRUE
  `, [projectHash]);

  const { rows: tasks } = await query(
    "SELECT id, title, description, status, priority, created_at, updated_at, completed_at FROM tasks WHERE project_hash = $1",
    [projectHash]
  );

  const { rows: rules } = await query(
    "SELECT id, content, priority, created_at FROM rules WHERE project_hash = $1 AND is_active = TRUE",
    [projectHash]
  );

  return {
    format: "memaxx-export-v1",
    project_hash: projectHash,
    exported_at: new Date().toISOString(),
    memories,
    entities,
    relations,
    tasks,
    rules,
  };
}

export async function importMemories(params, query_, body, projectHash) {
  if (!body || !Array.isArray(body.memories)) {
    return { error: "body.memories must be an array", status: 400 };
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const mem of body.memories) {
    try {
      if (!mem.content || typeof mem.content !== "string") {
        errors.push({ content: mem.content?.slice(0, 50), reason: "Missing or invalid content" });
        continue;
      }

      const hash = mem.content_hash || contentHash(mem.content);
      const { rows: existingRows } = await query(
        "SELECT id FROM memories WHERE project_hash = $1 AND content_hash = $2",
        [projectHash, hash]
      );
      if (existingRows.length > 0) {
        skipped++;
        continue;
      }

      const id = generateId();
      const tags = (typeof mem.tags === "string" || typeof mem.tags === "object")
        ? JSON.stringify(mem.tags || [])
        : JSON.stringify([]);
      const relatedFiles = (typeof mem.related_files === "string" || typeof mem.related_files === "object")
        ? JSON.stringify(mem.related_files || [])
        : JSON.stringify([]);

      await query(
        `INSERT INTO memories (id, project_hash, content, type, importance_score, tags, related_files, session_name, content_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          projectHash,
          mem.content,
          mem.type || "learning",
          mem.importance_score ?? 0.5,
          tags,
          relatedFiles,
          mem.session_name || null,
          hash,
          mem.created_at || new Date().toISOString(),
          mem.updated_at || new Date().toISOString(),
        ]
      );
      imported++;
    } catch (err) {
      errors.push({ content: mem.content?.slice(0, 50), reason: err.message });
    }
  }

  return { imported, skipped, errors, total_processed: body.memories.length };
}

// ── Memory Detail ────────────────────────────────────────────────────

export async function getMemoryDetail(params, query_, body, projectHash) {
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  const { rows } = await query(
    "SELECT * FROM memories WHERE id = $1 AND project_hash = $2",
    [id, projectHash]
  );
  const memory = rows[0];

  if (!memory) return { error: "Memory not found", status: 404 };

  // Parse JSON fields
  memory.tags = safeParseJson(memory.tags, []);
  memory.related_files = safeParseJson(memory.related_files, []);

  // Get related entities via entity_mentions
  const { rows: relatedEntities } = await query(`
    SELECT e.id, e.name, e.type, e.description, e.confidence
    FROM entity_mentions em
    JOIN entities e ON em.entity_id = e.id
    WHERE em.memory_id = $1 AND e.is_valid = TRUE
  `, [id]);

  // Get access history
  const { rows: accessHistory } = await query(`
    SELECT tool_name, created_at
    FROM access_log
    WHERE memory_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [id]);

  return {
    ...memory,
    related_entities: relatedEntities,
    access_history: accessHistory,
  };
}

// ── Projects ─────────────────────────────────────────────────────────

// ── Provider Config (system_config table) ───────────────────────────

export async function getProviderConfig() {
  const { rows } = await query(
    "SELECT key, value FROM system_config WHERE key LIKE 'embedding_%' OR key LIKE 'llm_%' ORDER BY key"
  );

  const config = {};
  for (const row of rows) {
    // Redact API keys
    if (row.key.includes("api_key") && row.value && row.value.length > 4) {
      config[row.key] = "***" + row.value.slice(-4);
    } else {
      config[row.key] = row.value;
    }
  }

  // Include env var status
  config._env_embedding_provider = process.env.EMBEDDING_PROVIDER || null;
  config._env_has_key = !!process.env.EMBEDDING_API_KEY;
  config._source = rows.length > 0 ? "database" : "environment";

  return config;
}

export async function saveProviderConfig(params, query_, body) {
  if (!body || typeof body !== "object") {
    return { error: "Request body required", status: 400 };
  }

  const allowedKeys = [
    "embedding_provider", "embedding_api_key", "embedding_model", "embedding_base_url",
    "llm_provider", "llm_api_key", "llm_model", "llm_base_url",
  ];

  let saved = 0;
  let deleted = 0;
  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.includes(key)) continue;
    if (typeof value !== "string") continue;

    if (!value.trim()) {
      // Empty value = delete the key
      await query("DELETE FROM system_config WHERE key = $1", [key]);
      deleted++;
    } else {
      await query(
        `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value.trim()]
      );
      saved++;
    }
  }

  // Reload running config from DB
  if ((saved > 0 || deleted > 0) && _onConfigSaved) {
    try { await _onConfigSaved(); } catch { /* ignore */ }
  }

  return { success: true, saved, deleted };
}

export async function testProviderConnection(params, query_, body) {
  if (!body?.provider || !body?.api_key) {
    return { error: "provider and api_key required", status: 400 };
  }

  const { provider, api_key, model, base_url } = body;

  const urls = {
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    mistral: "https://api.mistral.ai/v1",
    voyage: "https://api.voyageai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    ollama: base_url || "http://localhost:11434",
    custom: base_url || "",
  };

  const models = {
    openai: model || "text-embedding-3-small",
    gemini: model || "text-embedding-004",
    mistral: model || "mistral-embed",
    voyage: model || "voyage-3-lite",
    openrouter: model || "openai/text-embedding-3-small",
    ollama: model || "nomic-embed-text",
    custom: model || "text-embedding-3-small",
  };

  const testUrl = base_url || urls[provider];
  if (!testUrl) return { error: "Unknown provider or missing base URL", status: 400 };

  const fetchTimeout = AbortSignal.timeout(15000); // 15s timeout

  try {
    let res;
    if (provider === "ollama") {
      res = await fetch(`${testUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: models[provider], prompt: "test" }),
        signal: fetchTimeout,
      });
    } else {
      res = await fetch(`${testUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${api_key}`,
        },
        body: JSON.stringify({ model: models[provider], input: "test" }),
        signal: fetchTimeout,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const dim = provider === "ollama"
      ? data?.embedding?.length
      : data?.data?.[0]?.embedding?.length;

    return { success: true, dimension: dim, model: models[provider] };
  } catch (err) {
    const hint = err.name === 'TimeoutError' ? ' (request timed out after 15s)'
      : err.cause?.code === 'ENOTFOUND' ? ' (DNS resolution failed — check network connectivity from Docker container)'
      : err.cause?.code === 'ECONNREFUSED' ? ' (connection refused — is the provider URL correct?)'
      : err.cause?.code ? ` (${err.cause.code})` : '';
    return { success: false, error: err.message + hint };
  }
}

/**
 * Load provider config from database, falling back to environment variables.
 * Called by bin.mjs on startup to determine embedding/llm config.
 */
export async function loadProviderConfigFromDb() {
  try {
    const { rows } = await query("SELECT key, value FROM system_config WHERE key LIKE 'embedding_%' OR key LIKE 'llm_%'");
    if (rows.length === 0) return null;

    const map = {};
    for (const r of rows) map[r.key] = r.value;

    const embProvider = map.embedding_provider || null;
    const embModel = map.embedding_model || (embProvider ? DEFAULT_MODELS[embProvider] : null) || 'text-embedding-3-small';
    const embBaseUrl = map.embedding_base_url || (embProvider ? PROVIDER_URLS[embProvider] : null);
    const embDim = embProvider ? getEmbeddingDimension(embProvider, embModel) : 1536;

    const config = {
      embedding: {
        provider: embProvider,
        api_key: map.embedding_api_key || null,
        model: embModel,
        base_url: embBaseUrl,
        dimension: embDim,
      },
    };

    // LLM config — auto-inherit from embedding if not explicitly set
    const llmProvider = map.llm_provider || embProvider || null;
    if (llmProvider) {
      const llmDefaults = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', mistral: 'mistral-small-latest', openrouter: 'anthropic/claude-3.5-haiku', ollama: 'llama3.2' };
      const llmBaseUrl = map.llm_base_url || map.embedding_base_url || PROVIDER_URLS[llmProvider] || PROVIDER_URLS.openai;
      config.llm = {
        provider: llmProvider,
        api_key: map.llm_api_key || map.embedding_api_key || null,
        model: map.llm_model || llmDefaults[llmProvider] || 'gpt-4o-mini',
        base_url: llmBaseUrl,
      };
    }

    return config.embedding.provider ? config : null;
  } catch {
    return null;
  }
}

// ── Projects ─────────────────────────────────────────────────────────

export async function getProjects() {
  const { rows: projects } = await query(`
    SELECT
      m.project_hash,
      COUNT(*) as memory_count,
      MIN(m.created_at) as first_memory,
      MAX(m.created_at) as last_memory,
      COUNT(DISTINCT m.type) as type_count,
      p.name as project_name,
      p.git_remote
    FROM memories m
    LEFT JOIN projects p ON p.project_hash = m.project_hash
    WHERE m.is_archived = FALSE
    GROUP BY m.project_hash, p.name, p.git_remote
    ORDER BY last_memory DESC
  `);

  // Enrich with entity and task counts per project
  const enriched = [];
  for (const p of projects) {
    const { rows: ecRows } = await query(
      "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
      [p.project_hash]
    );
    const entityCount = parseInt(ecRows[0]?.c) || 0;

    const { rows: tcRows } = await query(
      "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1",
      [p.project_hash]
    );
    const taskCount = parseInt(tcRows[0]?.c) || 0;

    enriched.push({ ...p, entity_count: entityCount, task_count: taskCount });
  }

  return { projects: enriched, total: enriched.length };
}

export async function renameProject(params, query_, body) {
  const { project_hash, name } = body || {};
  if (!project_hash || !name || name.trim().length < 1) {
    return { error: "project_hash and name required", status: 400 };
  }
  await query(
    `INSERT INTO projects (project_hash, name)
     VALUES ($1, $2)
     ON CONFLICT (project_hash) DO UPDATE SET name = $2, updated_at = CURRENT_TIMESTAMP`,
    [project_hash, name.trim()]
  );
  return { success: true, project_hash, name: name.trim() };
}

// ── MCP-handler wrapper ──────────────────────────────────────────────
// Many features are already implemented as MCP handlers in tools.mjs.
// We invoke the public dispatcher `handleToolCall(name, args)` which derives
// the project hash from args. Inject our resolved ph via `project_id` so it
// matches whatever the dashboard request thread is scoped to.
//
// `handlerName` accepts either the MCP tool name (e.g. "memory_postmortem")
// or — for back-compat in older code — the internal "handlePostmortem" form.
const HANDLER_TO_TOOL = {
  handleInit: "memory_init", handleStore: "memory_store", handleSearch: "memory_search",
  handleModify: "memory_modify", handleList: "memory_list", handleExpand: "memory_expand",
  handleExport: "memory_export", handleGraphExplore: "memory_graph_explore",
  handleGraphStats: "memory_graph_stats", handleGraphPath: "memory_graph_path",
  handleGraphInvalidate: "memory_graph_invalidate",
  handleGraphInvalidateRelation: "memory_graph_invalidate_relation",
  handleStartThinking: "memory_start_thinking", handleAddThought: "memory_add_thought",
  handleTasks: "memory_tasks", handleSessionRecap: "memory_session_recap",
  handleGetRules: "memory_get_rules", handleInsights: "memory_insights",
  handlePostmortem: "memory_postmortem", handlePostmortemWarnings: "memory_postmortem_warnings",
  handlePatternFeedback: "memory_pattern_feedback",
  handleCodeQualityCheck: "memory_code_quality_check",
  handleAuditHistory: "memory_audit_history", handleSmartContext: "smart_context",
  handleExportForMigration: "memory_export_migration",
  handleGraphTimeline: "memory_graph_timeline", handleGraphAtTime: "memory_graph_at_time",
  handleGraphContradictions: "memory_graph_contradictions",
  handleGraphConsolidate: "memory_graph_consolidate",
  handleUploadDocument: "memory_upload_document", handleProjects: "memory_projects",
  handleProjectLink: "memory_project_link", handleListProjects: "memory_list_projects",
};

async function callMcp(handlerOrTool, args, ph) {
  const tools = await import("../tools.mjs");
  const toolName = HANDLER_TO_TOOL[handlerOrTool] || handlerOrTool;
  const injected = { ...(args || {}) };
  if (ph && !injected.project_id) injected.project_id = ph;
  const result = await tools.handleToolCall(toolName, injected);
  const text = result?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : {};
  if (result?.isError) return { error: parsed.error || "MCP handler error", status: 400 };
  return parsed;
}

// ── Postmortems — Create ─────────────────────────────────────────────

export async function createPostmortem(params, query_, body, projectHash) {
  if (!body?.title || !body?.bug_category || !body?.description || !body?.root_cause || !body?.fix_description) {
    return { error: "title, bug_category, description, root_cause, fix_description required", status: 400 };
  }
  return callMcp("handlePostmortem", body, projectHash);
}

export async function getPostmortemWarnings(params, query_, body, projectHash) {
  if (!Array.isArray(body?.files) || body.files.length === 0) {
    return { error: "files (array) required", status: 400 };
  }
  return callMcp("handlePostmortemWarnings", body, projectHash);
}

// ── Thinking — Create / Add Thought ──────────────────────────────────

export async function createThinkingSequence(params, query_, body, projectHash) {
  if (!body?.goal && !body?.title) return { error: "goal required", status: 400 };
  return callMcp("handleStartThinking", body, projectHash);
}

export async function addThought(params, query_, body, projectHash) {
  const sequence_id = params?.id || body?.sequence_id;
  if (!sequence_id || !body?.thought) return { error: "sequence_id and thought required", status: 400 };
  return callMcp("handleAddThought", { ...body, sequence_id }, projectHash);
}

// ── Rules — Create / Update / Delete ─────────────────────────────────

export async function createRule(params, query_, body, projectHash) {
  if (!body?.content || body.content.trim().length < 3) {
    return { error: "content (min 3 chars) required", status: 400 };
  }
  const id = generateId();
  await query(
    "INSERT INTO rules (id, project_hash, content, priority, is_active) VALUES ($1, $2, $3, $4, TRUE)",
    [id, projectHash, body.content.trim(), body.priority || "should"]
  );
  return { id, success: true };
}

export async function updateRule(params, query_, body, projectHash) {
  const id = params?.id;
  if (!id) return { error: "rule id required", status: 400 };
  const updates = [];
  const vals = [];
  let i = 1;
  if (body.content !== undefined) { updates.push(`content = $${i++}`); vals.push(String(body.content).trim()); }
  if (body.priority !== undefined) { updates.push(`priority = $${i++}`); vals.push(body.priority); }
  if (body.is_active !== undefined) { updates.push(`is_active = $${i++}`); vals.push(!!body.is_active); }
  if (updates.length === 0) return { error: "no fields to update", status: 400 };
  vals.push(id, projectHash);
  const res = await query(
    `UPDATE rules SET ${updates.join(", ")} WHERE id = $${i++} AND project_hash = $${i} RETURNING id`,
    vals
  );
  if (res.rowCount === 0) return { error: "rule not found", status: 404 };
  return { updated: true, id };
}

export async function deleteRule(params, query_, body, projectHash) {
  const id = params?.id;
  if (!id) return { error: "rule id required", status: 400 };
  const res = await query(
    "DELETE FROM rules WHERE id = $1 AND project_hash = $2 RETURNING id",
    [id, projectHash]
  );
  if (res.rowCount === 0) return { error: "rule not found", status: 404 };
  return { deleted: true, id };
}

// ── Projects — Delete / Cleanup test projects / Link ─────────────────

export async function deleteProject(params) {
  const hash = params?.hash;
  if (!hash) return { error: "project hash required", status: 400 };
  // Cascade: memories, entities, relations, entity_mentions, tasks, rules, postmortems,
  // thinking_sequences, system_config rows are all per-project.
  // entity_mentions cascades via entities FK; relations cascade via entities FK.
  await query("DELETE FROM relations WHERE project_hash = $1", [hash]);
  await query("DELETE FROM entity_mentions WHERE memory_id IN (SELECT id FROM memories WHERE project_hash = $1)", [hash]);
  await query("DELETE FROM entities WHERE project_hash = $1", [hash]);
  await query("DELETE FROM thinking_thoughts WHERE sequence_id IN (SELECT id FROM thinking_sequences WHERE project_hash = $1)", [hash]);
  await query("DELETE FROM thinking_sequences WHERE project_hash = $1", [hash]);
  await query("DELETE FROM tasks WHERE project_hash = $1", [hash]);
  await query("DELETE FROM rules WHERE project_hash = $1", [hash]);
  await query("DELETE FROM postmortems WHERE project_hash = $1", [hash]);
  await query("DELETE FROM memory_audit WHERE memory_id IN (SELECT id FROM memories WHERE project_hash = $1)", [hash]).catch(() => {});
  await query("DELETE FROM memories WHERE project_hash = $1", [hash]);
  await query("DELETE FROM projects WHERE project_hash = $1", [hash]);
  return { deleted: true, project_hash: hash };
}

export async function cleanupTestProjects() {
  const { rows } = await query(
    "SELECT DISTINCT project_hash FROM memories WHERE project_hash LIKE 'zzz_test_%'"
  );
  const hashes = rows.map(r => r.project_hash);
  for (const hash of hashes) {
    await deleteProject({ hash });
  }
  return { deleted_count: hashes.length, project_hashes: hashes };
}

export async function linkProjects(params, query_, body, projectHash) {
  if (!body?.target_project_hash || !body?.link_type) {
    return { error: "target_project_hash and link_type required", status: 400 };
  }
  return callMcp("handleProjectLink", body, projectHash);
}

// ── Memory extras — audit, upload, smart context, code-quality ───────

export async function getMemoryAudit(params, query_, body, projectHash) {
  if (!params?.id) return { error: "memory id required", status: 400 };
  return callMcp("handleAuditHistory", { memory_id: params.id }, projectHash);
}

export async function uploadMemoryDocument(params, query_, body, projectHash) {
  if (!body?.file_content) return { error: "file_content required", status: 400 };
  return callMcp("handleUploadDocument", body, projectHash);
}

export async function smartContextHandler(params, query_, body, projectHash) {
  if (!body?.query) return { error: "query required", status: 400 };
  return callMcp("handleSmartContext", body, projectHash);
}

export async function checkCodeQuality(params, query_, body, projectHash) {
  if (!body?.content) return { error: "content required", status: 400 };
  return callMcp("handleCodeQualityCheck", body, projectHash);
}

export async function patternFeedback(params, query_, body, projectHash) {
  if (!body?.pattern_id || !body?.outcome) return { error: "pattern_id and outcome required", status: 400 };
  return callMcp("handlePatternFeedback", body, projectHash);
}

export async function sessionRecap(params, query_, body, projectHash) {
  return callMcp("handleSessionRecap", body || {}, projectHash);
}

// ── Graph extras — timeline, at_time, path, contradictions, consolidate, invalidate ─

export async function getGraphTimeline(params, query_, body, projectHash) {
  const entity_name = params?.name || query_?.entity_name;
  if (!entity_name) return { error: "entity name required", status: 400 };
  const limit = parseInt(query_?.limit) || 50;
  return callMcp("handleGraphTimeline", { entity_name, limit }, projectHash);
}

export async function getGraphAtTime(params, query_, body, projectHash) {
  if (!body?.entity_name || !body?.at_time) return { error: "entity_name and at_time required", status: 400 };
  return callMcp("handleGraphAtTime", body, projectHash);
}

export async function getGraphPath(params, query_, body, projectHash) {
  if (!body?.source_entity || !body?.target_entity) return { error: "source_entity and target_entity required", status: 400 };
  return callMcp("handleGraphPath", body, projectHash);
}

export async function getGraphContradictions(params, query_, body, projectHash) {
  return callMcp("handleGraphContradictions", body || {}, projectHash);
}

export async function consolidateGraph(params, query_, body, projectHash) {
  return callMcp("handleGraphConsolidate", body || {}, projectHash);
}

export async function invalidateEntity(params, query_, body, projectHash) {
  if (!body?.entity_name || !body?.reason) return { error: "entity_name and reason required", status: 400 };
  return callMcp("handleGraphInvalidate", body, projectHash);
}

export async function invalidateRelation(params, query_, body, projectHash) {
  if (!body?.relation_id || !body?.reason) return { error: "relation_id and reason required", status: 400 };
  return callMcp("handleGraphInvalidateRelation", body, projectHash);
}

// ── Project docs (memory_projects MCP) ───────────────────────────────

export async function projectDocs(params, query_, body, projectHash) {
  const action = body?.action || query_?.action || "list_all";
  return callMcp("handleProjects", { ...body, action }, projectHash);
}

// ── System config (rate limit, auth token, etc.) ─────────────────────

export async function getSystemConfig() {
  const { rows } = await query(
    "SELECT key, value FROM system_config WHERE key LIKE 'rate_limit_%' OR key = 'auth_token' OR key = 'trust_proxy' ORDER BY key"
  );
  const config = {};
  for (const row of rows) {
    if (row.key === "auth_token" && row.value && row.value.length > 4) {
      config[row.key] = "***" + row.value.slice(-4);
    } else {
      config[row.key] = row.value;
    }
  }
  config._env_rate_limit_rpm = process.env.RATE_LIMIT_RPM || null;
  config._env_rate_limit_burst = process.env.RATE_LIMIT_BURST || null;
  config._env_rate_limit_disabled = process.env.RATE_LIMIT_DISABLED || null;
  config._env_has_auth_token = !!process.env.AUTH_TOKEN;
  config._env_trust_proxy = process.env.TRUST_PROXY || null;
  return config;
}

export async function saveSystemConfig(params, query_, body) {
  if (!body || typeof body !== "object") return { error: "body required", status: 400 };
  const allowed = ["rate_limit_rpm", "rate_limit_burst", "rate_limit_disabled", "auth_token", "trust_proxy"];
  let saved = 0, deleted = 0;
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue;
    const sv = String(v ?? "").trim();
    if (!sv) {
      await query("DELETE FROM system_config WHERE key = $1", [k]);
      deleted++;
    } else {
      await query(
        `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [k, sv]
      );
      saved++;
    }
  }
  return { success: true, saved, deleted };
}

// ── Backups — list, restore, delete (PostgreSQL JSON snapshots) ──────

export async function listBackups() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = process.env.BACKUP_DIR || "/app/.memaxx-backups";
  try {
    if (!fs.existsSync(dir)) return { backups: [], count: 0, backup_dir: dir };
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        return { filename: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { backups: files, count: files.length, backup_dir: dir };
  } catch (err) {
    return { error: `listBackups failed: ${err.message}`, status: 500 };
  }
}

const RESTORE_TABLE_ORDER = [
  "projects", "memories", "entities", "entity_mentions", "relations",
  "rules", "postmortems", "tasks", "thinking_sequences", "thinking_thoughts",
  "patterns", "project_docs", "project_links", "document_uploads", "system_config",
];

function _restoreNormalize(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}
function _quoteIdent(s) { return `"${String(s).replace(/"/g, '""')}"`; }

export async function restoreBackup(params, query_, body) {
  const filename = body?.filename;
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return { error: "valid filename required (no path traversal)", status: 400 };
  }
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dir = process.env.BACKUP_DIR || "/app/.memaxx-backups";
  const full = path.join(dir, filename);
  if (!fs.existsSync(full)) return { error: "backup file not found", status: 404 };

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (err) {
    return { error: `Invalid JSON: ${err.message}`, status: 400 };
  }
  if (snapshot?.version !== 1 || !snapshot?.tables) {
    return { error: "Invalid snapshot — expected { version: 1, tables: {...} }", status: 400 };
  }

  const truncate = !!body?.truncate;
  const perTable = {};
  let totalInserted = 0, totalSkipped = 0;

  for (const table of RESTORE_TABLE_ORDER) {
    const rows = snapshot.tables[table];
    if (!rows || rows.length === 0) continue;

    if (truncate) {
      try { await query(`TRUNCATE TABLE ${table} CASCADE`); }
      catch (err) { perTable[table] = { inserted: 0, skipped: rows.length, error: err.message }; continue; }
    }

    let inserted = 0, skipped = 0;
    for (const row of rows) {
      if (table === "system_config" && typeof row.value === "string" && row.value.startsWith("***redacted:")) {
        skipped++; continue;
      }
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const vals = cols.map((c) => _restoreNormalize(row[c]));
      try {
        const r = await query(
          `INSERT INTO ${table} (${cols.map(_quoteIdent).join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
          vals
        );
        if (r.rowCount > 0) inserted++; else skipped++;
      } catch { skipped++; }
    }
    perTable[table] = { inserted, skipped };
    totalInserted += inserted;
    totalSkipped += skipped;
  }

  return { success: true, total_inserted: totalInserted, total_skipped: totalSkipped, per_table: perTable, truncate };
}

export async function deleteBackup(params) {
  const filename = params?.filename;
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return { error: "valid filename required", status: 400 };
  }
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dir = process.env.BACKUP_DIR || "/app/.memaxx-backups";
  const full = path.join(dir, filename);
  if (!fs.existsSync(full)) return { error: "backup file not found", status: 404 };
  fs.unlinkSync(full);
  return { deleted: true, filename };
}

// ── Server restart (graceful shutdown — Docker restart policy brings it back) ─

export async function restartServer() {
  setTimeout(() => process.exit(0), 200);
  return { success: true, message: "Server is restarting. Will be back in a few seconds." };
}

// ── Full health (proxies what bin.mjs /health returns, via SQL) ──────

export async function getFullHealth() {
  const startupTime = global.__memaxx_startup || Date.now();
  const uptime_seconds = Math.floor((Date.now() - startupTime) / 1000);

  let dbStats = {};
  try {
    const t0 = Date.now();
    const { rows } = await query("SELECT COUNT(*) as c FROM memories");
    dbStats.latency_ms = Date.now() - t0;
    dbStats.memories = parseInt(rows[0]?.c) || 0;
    const { rows: er } = await query("SELECT COUNT(*) as c FROM entities WHERE is_valid = TRUE");
    dbStats.entities = parseInt(er[0]?.c) || 0;
    const { rows: pr } = await query("SELECT COUNT(*) as c FROM (SELECT DISTINCT project_hash FROM memories) x");
    dbStats.projects = parseInt(pr[0]?.c) || 0;
    const { rows: peb } = await query("SELECT COUNT(*) as c FROM memories WHERE embedding_pending = TRUE");
    dbStats.pending_embeddings = parseInt(peb[0]?.c) || 0;
    const { rows: pen } = await query("SELECT COUNT(*) as c FROM memories WHERE entities_pending = TRUE");
    dbStats.pending_entities = parseInt(pen[0]?.c) || 0;
    dbStats.connected = true;
  } catch (err) {
    dbStats = { connected: false, error: err.message };
  }

  const mem = process.memoryUsage();
  return {
    status: "ok",
    version: "3.0.0",
    uptime_seconds,
    node_version: process.version,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    database: dbStats,
  };
}
