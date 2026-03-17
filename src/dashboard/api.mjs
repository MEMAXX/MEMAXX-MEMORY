/**
 * REST API handlers for the MEMAXX Memory dashboard.
 * Each handler receives (params, query, body, projectHash) and returns a plain object.
 * Uses direct SQLite queries via getDb() — does NOT call MCP tool handlers.
 */

import { getDb, generateId, contentHash } from "../db.mjs";
import { searchMemories as hybridSearch } from "../search.mjs";
import { readConfig } from "../config.mjs";
import { copyFileSync, statSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────────────

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ── Stats ────────────────────────────────────────────────────────────

export function getStats(params, query, body, projectHash) {
  const db = getDb();

  const totalMemories = db.prepare(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = ? AND is_archived = 0"
  ).get(projectHash)?.c || 0;

  const totalEntities = db.prepare(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = ? AND is_valid = 1"
  ).get(projectHash)?.c || 0;

  const totalRelations = db.prepare(
    "SELECT COUNT(*) as c FROM relations WHERE project_hash = ? AND is_valid = 1"
  ).get(projectHash)?.c || 0;

  const totalTasks = db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = ?"
  ).get(projectHash)?.c || 0;

  const openTasks = db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = ? AND status = 'open'"
  ).get(projectHash)?.c || 0;

  const totalPostmortems = db.prepare(
    "SELECT COUNT(*) as c FROM postmortems WHERE project_hash = ?"
  ).get(projectHash)?.c || 0;

  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM memories WHERE project_hash = ? AND is_archived = 0
    GROUP BY type ORDER BY count DESC
  `).all(projectHash);

  const typeBreakdown = {};
  for (const r of typeRows) typeBreakdown[r.type] = r.count;

  const recentMemories = db.prepare(`
    SELECT id, content, type, importance_score, created_at
    FROM memories WHERE project_hash = ? AND is_archived = 0
    ORDER BY created_at DESC LIMIT 5
  `).all(projectHash);

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

export function getMemories(params, query, body, projectHash) {
  const db = getDb();
  const page = clamp(parseInt(query.page) || 1, 1, 10000);
  const limit = clamp(parseInt(query.limit) || 20, 1, 100);
  const offset = (page - 1) * limit;
  const type = query.type || null;
  const q = query.q || null;

  let sql = `
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, retrieval_count, is_archived, created_at, updated_at
    FROM memories
    WHERE project_hash = ? AND is_archived = 0
  `;
  let countSql = `
    SELECT COUNT(*) as c FROM memories
    WHERE project_hash = ? AND is_archived = 0
  `;
  const sqlParams = [projectHash];
  const countParams = [projectHash];

  if (type) {
    sql += " AND type = ?";
    countSql += " AND type = ?";
    sqlParams.push(type);
    countParams.push(type);
  }

  if (q) {
    sql += " AND content LIKE ?";
    countSql += " AND content LIKE ?";
    const likeParam = `%${q}%`;
    sqlParams.push(likeParam);
    countParams.push(likeParam);
  }

  const total = db.prepare(countSql).get(...countParams)?.c || 0;

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  sqlParams.push(limit, offset);

  const memories = db.prepare(sql).all(...sqlParams).map(r => ({
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

export function getMemory(params, query, body, projectHash) {
  const db = getDb();
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  const memory = db.prepare(
    "SELECT * FROM memories WHERE id = ? AND project_hash = ?"
  ).get(id, projectHash);

  if (!memory) return { error: "Memory not found", status: 404 };

  return {
    ...memory,
    tags: safeParseJson(memory.tags, []),
    related_files: safeParseJson(memory.related_files, []),
  };
}

// ── Knowledge Graph ──────────────────────────────────────────────────

export function getGraph(params, query, body, projectHash) {
  const db = getDb();

  // Get the 200 most-connected entities for performance
  const nodes = db.prepare(`
    SELECT e.id, e.name, e.type, e.description, e.confidence, e.created_at,
           COUNT(r.id) as connections
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = 1
    WHERE e.project_hash = ? AND e.is_valid = 1
    GROUP BY e.id
    ORDER BY connections DESC
    LIMIT 200
  `).all(projectHash);

  const nodeIds = new Set(nodes.map(n => n.id));

  // Get relations only between the selected nodes
  let edges = [];
  if (nodeIds.size > 0) {
    const allRelations = db.prepare(`
      SELECT id, source_id, target_id, relation, confidence, valid_from, valid_to, created_at
      FROM relations
      WHERE project_hash = ? AND is_valid = 1
    `).all(projectHash);

    edges = allRelations.filter(r => nodeIds.has(r.source_id) && nodeIds.has(r.target_id));
  }

  return { nodes, edges };
}

export function getGraphExplore(params, query, body, projectHash) {
  const db = getDb();
  const entityName = decodeURIComponent(params.name || "");
  if (!entityName) return { error: "Entity name required", status: 400 };

  // Find root entity
  const root = db.prepare(
    "SELECT * FROM entities WHERE project_hash = ? AND LOWER(name) = LOWER(?) AND is_valid = 1"
  ).get(projectHash, entityName);

  if (!root) return { entity: null, message: `Entity "${entityName}" not found.` };

  // BFS traversal up to depth 3
  const maxDepth = 3;
  const visited = new Set([root.id]);
  const nodes = [{ ...root, depth: 0 }];
  const edges = [];
  let frontier = [root.id];

  for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
    const nextFrontier = [];
    const placeholders = frontier.map(() => "?").join(",");

    const rels = db.prepare(`
      SELECT r.*, e1.name as source_name, e2.name as target_name
      FROM relations r
      JOIN entities e1 ON r.source_id = e1.id
      JOIN entities e2 ON r.target_id = e2.id
      WHERE r.is_valid = 1 AND (r.source_id IN (${placeholders}) OR r.target_id IN (${placeholders}))
    `).all(...frontier, ...frontier);

    for (const rel of rels) {
      edges.push(rel);
      for (const neighborId of [rel.source_id, rel.target_id]) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(neighborId);
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

export function getGraphStats(params, query, body, projectHash) {
  const db = getDb();

  const entityCount = db.prepare(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = ? AND is_valid = 1"
  ).get(projectHash)?.c || 0;

  const relationCount = db.prepare(
    "SELECT COUNT(*) as c FROM relations WHERE project_hash = ? AND is_valid = 1"
  ).get(projectHash)?.c || 0;

  const typeDistribution = db.prepare(`
    SELECT type, COUNT(*) as count FROM entities
    WHERE project_hash = ? AND is_valid = 1
    GROUP BY type ORDER BY count DESC
  `).all(projectHash);

  const topEntities = db.prepare(`
    SELECT e.name, e.type, COUNT(r.id) as connection_count
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = 1
    WHERE e.project_hash = ? AND e.is_valid = 1
    GROUP BY e.id
    ORDER BY connection_count DESC
    LIMIT 10
  `).all(projectHash);

  return {
    entity_count: entityCount,
    relation_count: relationCount,
    type_distribution: typeDistribution,
    top_entities: topEntities,
  };
}

// ── Tasks ────────────────────────────────────────────────────────────

export function getTasks(params, query, body, projectHash) {
  const db = getDb();

  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE project_hash = ?
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      created_at DESC
  `).all(projectHash);

  // Group by status
  const grouped = {};
  for (const t of tasks) {
    const s = t.status || "open";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }

  return { tasks, grouped, total: tasks.length };
}

export function createTask(params, query, body, projectHash) {
  const db = getDb();

  if (!body || !body.title) return { error: "Task title required", status: 400 };

  const id = generateId();
  db.prepare(
    "INSERT INTO tasks (id, project_hash, title, description, priority) VALUES (?, ?, ?, ?, ?)"
  ).run(id, projectHash, body.title, body.description || null, body.priority || "medium");

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return { id, created: true, task };
}

export function updateTask(params, query, body, projectHash) {
  const db = getDb();
  const taskId = params.id;
  if (!taskId) return { error: "Task ID required", status: 400 };

  const existing = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_hash = ?").get(taskId, projectHash);
  if (!existing) return { error: "Task not found", status: 404 };

  if (!body || Object.keys(body).length === 0) return { error: "No fields to update", status: 400 };

  const updates = [];
  const updateParams = [];

  if (body.title !== undefined) { updates.push("title = ?"); updateParams.push(body.title); }
  if (body.description !== undefined) { updates.push("description = ?"); updateParams.push(body.description); }
  if (body.status !== undefined) {
    updates.push("status = ?");
    updateParams.push(body.status);
    if (body.status === "completed") {
      updates.push("completed_at = datetime('now')");
    }
  }
  if (body.priority !== undefined) { updates.push("priority = ?"); updateParams.push(body.priority); }

  if (updates.length === 0) return { error: "No valid fields to update", status: 400 };

  updates.push("updated_at = datetime('now')");
  updateParams.push(taskId, projectHash);

  db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ? AND project_hash = ?`).run(...updateParams);

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return { updated: true, task: updated };
}

export function deleteTask(params, query, body, projectHash) {
  const db = getDb();
  const taskId = params.id;
  if (!taskId) return { error: "Task ID required", status: 400 };

  const existing = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_hash = ?").get(taskId, projectHash);
  if (!existing) return { error: "Task not found", status: 404 };

  db.prepare("DELETE FROM tasks WHERE id = ? AND project_hash = ?").run(taskId, projectHash);
  return { deleted: true, id: taskId };
}

// ── Postmortems ──────────────────────────────────────────────────────

export function getPostmortems(params, query, body, projectHash) {
  const db = getDb();

  const postmortems = db.prepare(`
    SELECT * FROM postmortems WHERE project_hash = ?
    ORDER BY created_at DESC
  `).all(projectHash).map(pm => ({
    ...pm,
    affected_files: safeParseJson(pm.affected_files, []),
  }));

  return { postmortems, total: postmortems.length };
}

// ── Thinking ─────────────────────────────────────────────────────────

export function getThinkingSequences(params, query, body, projectHash) {
  const db = getDb();

  const sequences = db.prepare(`
    SELECT ts.*, COUNT(tt.id) as thought_count
    FROM thinking_sequences ts
    LEFT JOIN thinking_thoughts tt ON ts.id = tt.sequence_id
    WHERE ts.project_hash = ?
    GROUP BY ts.id
    ORDER BY ts.created_at DESC
  `).all(projectHash);

  return { sequences, total: sequences.length };
}

export function getThinkingSequence(params, query, body, projectHash) {
  const db = getDb();
  const sequenceId = params.id;
  if (!sequenceId) return { error: "Sequence ID required", status: 400 };

  const sequence = db.prepare(
    "SELECT * FROM thinking_sequences WHERE id = ? AND project_hash = ?"
  ).get(sequenceId, projectHash);

  if (!sequence) return { error: "Thinking sequence not found", status: 404 };

  const thoughts = db.prepare(
    "SELECT * FROM thinking_thoughts WHERE sequence_id = ? ORDER BY created_at ASC"
  ).all(sequenceId);

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

export function getRules(params, query, body, projectHash) {
  const db = getDb();

  const userRules = db.prepare(
    "SELECT * FROM rules WHERE project_hash = ? AND is_active = 1"
  ).all(projectHash);

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

export async function searchMemoriesHandler(params, query, body, projectHash, embeddingConfig) {
  const q = query.q || "";
  if (!q) return { error: "Query parameter 'q' is required", status: 400 };

  const mode = query.mode || "hybrid";
  const type = query.type || undefined;
  const limit = clamp(parseInt(query.limit) || 10, 1, 50);

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

export function getInsights(params, query, body, projectHash) {
  const db = getDb();

  const totalMemories = db.prepare(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = ? AND is_archived = 0"
  ).get(projectHash)?.c || 0;

  const totalEntities = db.prepare(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = ? AND is_valid = 1"
  ).get(projectHash)?.c || 0;

  const totalTasks = db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = ?"
  ).get(projectHash)?.c || 0;

  const openTasks = db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = ? AND status = 'open'"
  ).get(projectHash)?.c || 0;

  const typeBreakdown = db.prepare(`
    SELECT type, COUNT(*) as count, AVG(importance_score) as avg_importance
    FROM memories WHERE project_hash = ? AND is_archived = 0
    GROUP BY type ORDER BY count DESC
  `).all(projectHash);

  // Recent activity (last 7 days)
  const recentActivity = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as count
    FROM memories
    WHERE project_hash = ? AND is_archived = 0
      AND created_at >= datetime('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY day DESC
  `).all(projectHash);

  // Entity clusters: top entities with their connections
  const entityClusters = db.prepare(`
    SELECT e.name, e.type, COUNT(r.id) as connections
    FROM entities e
    LEFT JOIN relations r ON (e.id = r.source_id OR e.id = r.target_id) AND r.is_valid = 1
    WHERE e.project_hash = ? AND e.is_valid = 1
    GROUP BY e.id
    ORDER BY connections DESC
    LIMIT 20
  `).all(projectHash);

  const recentPostmortems = db.prepare(`
    SELECT id, title, bug_category, severity, created_at
    FROM postmortems WHERE project_hash = ?
    ORDER BY created_at DESC LIMIT 5
  `).all(projectHash);

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

export function createBackup(params, query, body) {
  const config = readConfig();
  if (!config) return { error: "No config found", status: 404 };

  const dbPath = config.db_path;
  if (!dbPath) return { error: "No db_path in config", status: 500 };

  const timestamp = Date.now();
  const backupPath = `${dbPath}.backup-${timestamp}`;

  try {
    copyFileSync(dbPath, backupPath);
    const stats = statSync(backupPath);
    return {
      success: true,
      backup_path: backupPath,
      size: stats.size,
    };
  } catch (err) {
    return { error: `Backup failed: ${err.message}`, status: 500 };
  }
}

// ── Export / Import ──────────────────────────────────────────────────

export function exportMemories(params, query, body, projectHash) {
  const db = getDb();

  const memories = db.prepare(`
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, content_hash, retrieval_count, created_at, updated_at
    FROM memories
    WHERE project_hash = ? AND is_archived = 0
    ORDER BY created_at DESC
  `).all(projectHash).map(m => ({
    ...m,
    tags: safeParseJson(m.tags, []),
    related_files: safeParseJson(m.related_files, []),
  }));

  const entities = db.prepare(`
    SELECT id, name, type, description, confidence, created_at
    FROM entities WHERE project_hash = ? AND is_valid = 1
  `).all(projectHash);

  const relations = db.prepare(`
    SELECT r.id, s.name as source, t.name as target, r.relation, r.confidence, r.valid_from, r.valid_to, r.created_at
    FROM relations r
    JOIN entities s ON r.source_id = s.id
    JOIN entities t ON r.target_id = t.id
    WHERE r.project_hash = ? AND r.is_valid = 1
  `).all(projectHash);

  const tasks = db.prepare(
    "SELECT id, title, description, status, priority, created_at, updated_at, completed_at FROM tasks WHERE project_hash = ?"
  ).all(projectHash);

  const rules = db.prepare(
    "SELECT id, content, priority, created_at FROM rules WHERE project_hash = ? AND is_active = 1"
  ).all(projectHash);

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

export function importMemories(params, query, body, projectHash) {
  const db = getDb();

  if (!body || !Array.isArray(body.memories)) {
    return { error: "body.memories must be an array", status: 400 };
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  const insertStmt = db.prepare(`
    INSERT INTO memories (id, project_hash, content, type, importance_score, tags, related_files, session_name, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const checkStmt = db.prepare(
    "SELECT id FROM memories WHERE project_hash = ? AND content_hash = ?"
  );

  for (const mem of body.memories) {
    try {
      if (!mem.content || typeof mem.content !== "string") {
        errors.push({ content: mem.content?.slice(0, 50), reason: "Missing or invalid content" });
        continue;
      }

      const hash = mem.content_hash || contentHash(mem.content);
      const existing = checkStmt.get(projectHash, hash);
      if (existing) {
        skipped++;
        continue;
      }

      const id = generateId();
      const tags = typeof mem.tags === "string" ? mem.tags : JSON.stringify(mem.tags || []);
      const relatedFiles = typeof mem.related_files === "string" ? mem.related_files : JSON.stringify(mem.related_files || []);

      insertStmt.run(
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
      );
      imported++;
    } catch (err) {
      errors.push({ content: mem.content?.slice(0, 50), reason: err.message });
    }
  }

  return { imported, skipped, errors, total_processed: body.memories.length };
}

// ── Memory Detail ────────────────────────────────────────────────────

export function getMemoryDetail(params, query, body, projectHash) {
  const db = getDb();
  const id = params.id;
  if (!id) return { error: "Memory ID required", status: 400 };

  const memory = db.prepare(
    "SELECT * FROM memories WHERE id = ? AND project_hash = ?"
  ).get(id, projectHash);

  if (!memory) return { error: "Memory not found", status: 404 };

  // Parse JSON fields
  memory.tags = safeParseJson(memory.tags, []);
  memory.related_files = safeParseJson(memory.related_files, []);

  // Get related entities via entity_mentions
  const relatedEntities = db.prepare(`
    SELECT e.id, e.name, e.type, e.description, e.confidence
    FROM entity_mentions em
    JOIN entities e ON em.entity_id = e.id
    WHERE em.memory_id = ? AND e.is_valid = 1
  `).all(id);

  // Get access history
  const accessHistory = db.prepare(`
    SELECT tool_name, created_at
    FROM access_log
    WHERE memory_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(id);

  return {
    ...memory,
    related_entities: relatedEntities,
    access_history: accessHistory,
  };
}

// ── Projects ─────────────────────────────────────────────────────────

export function getProjects() {
  const db = getDb();

  const projects = db.prepare(`
    SELECT
      project_hash,
      COUNT(*) as memory_count,
      MIN(created_at) as first_memory,
      MAX(created_at) as last_memory,
      COUNT(DISTINCT type) as type_count
    FROM memories
    WHERE is_archived = 0
    GROUP BY project_hash
    ORDER BY last_memory DESC
  `).all();

  // Enrich with entity and task counts per project
  const enriched = projects.map(p => {
    const entityCount = db.prepare(
      "SELECT COUNT(*) as c FROM entities WHERE project_hash = ? AND is_valid = 1"
    ).get(p.project_hash)?.c || 0;

    const taskCount = db.prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE project_hash = ?"
    ).get(p.project_hash)?.c || 0;

    return { ...p, entity_count: entityCount, task_count: taskCount };
  });

  return { projects: enriched, total: enriched.length };
}
