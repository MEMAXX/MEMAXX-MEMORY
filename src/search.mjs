/**
 * Hybrid search engine for MEMAXX Memory Local.
 * Combines: semantic (sqlite-vec) + full-text (FTS5) + tag matching + time-decay.
 */

import { getDb, generateId } from "./db.mjs";
import { generateEmbedding, cosineSimilarity } from "./embeddings.mjs";

// Search weights (aligned with cloud version)
const WEIGHTS = {
  hybrid: { semantic: 0.45, fts: 0.15, tags: 0.10, freshness: 0.10, graph: 0.20 },
  fulltext: { semantic: 0, fts: 0.60, tags: 0, freshness: 0.40, graph: 0 },
  keyword: { semantic: 0, fts: 0.40, tags: 0.40, freshness: 0.20, graph: 0 },
};

/**
 * Hybrid search across memories.
 * @param {object} params
 * @param {string} params.query
 * @param {string} params.projectHash
 * @param {string} [params.searchMode='hybrid']
 * @param {string} [params.memoryType]
 * @param {string} [params.filePath]
 * @param {number} [params.limit=10]
 * @param {boolean} [params.recentOnly=false]
 * @param {object} embeddingConfig
 * @returns {Promise<{ results: object[], count: number }>}
 */
export async function searchMemories(params, embeddingConfig) {
  const {
    query,
    projectHash,
    searchMode = "hybrid",
    memoryType,
    filePath,
    limit = 10,
    recentOnly = false,
  } = params;

  const db = getDb();
  const weights = WEIGHTS[searchMode] || WEIGHTS.hybrid;

  // 1. Get candidate memories
  let sql = `
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, retrieval_count, is_archived, created_at, updated_at
    FROM memories
    WHERE project_hash = ? AND is_archived = 0
  `;
  const sqlParams = [projectHash];

  if (memoryType) {
    sql += " AND type = ?";
    sqlParams.push(memoryType);
  }

  if (filePath) {
    sql += " AND related_files LIKE ?";
    sqlParams.push(`%${filePath}%`);
  }

  if (recentOnly) {
    sql += " AND created_at >= datetime('now', '-30 days')";
  }

  sql += " ORDER BY created_at DESC LIMIT 200"; // candidate pool

  const candidates = db.prepare(sql).all(...sqlParams);
  if (candidates.length === 0) return { results: [], count: 0 };

  // 2. Score each candidate
  const queryEmbedding = weights.semantic > 0
    ? await generateEmbedding(query, embeddingConfig)
    : null;

  // Pre-fetch FTS matches
  const ftsMatches = new Set();
  const ftsScores = new Map();
  if (weights.fts > 0 && query.trim()) {
    try {
      // FTS5 query — escape special chars
      const ftsQuery = query.replace(/['"(){}[\]^~*:]/g, " ").trim();
      if (ftsQuery) {
        const ftsResults = db.prepare(`
          SELECT rowid, rank FROM memories_fts
          WHERE memories_fts MATCH ?
          ORDER BY rank
          LIMIT 100
        `).all(ftsQuery);

        // Map rowid → memory id
        const rowids = ftsResults.map(r => r.rowid);
        if (rowids.length > 0) {
          const placeholders = rowids.map(() => "?").join(",");
          const rows = db.prepare(
            `SELECT id, rowid FROM memories WHERE rowid IN (${placeholders})`
          ).all(...rowids);

          const rowidToId = new Map(rows.map(r => [r.rowid, r.id]));
          const maxRank = Math.max(...ftsResults.map(r => Math.abs(r.rank)), 1);

          for (const r of ftsResults) {
            const id = rowidToId.get(r.rowid);
            if (id) {
              ftsMatches.add(id);
              ftsScores.set(id, Math.abs(r.rank) / maxRank);
            }
          }
        }
      }
    } catch { /* FTS query syntax error — skip */ }
  }

  // Pre-fetch semantic similarities from vec table
  const vecScores = new Map();
  if (queryEmbedding && weights.semantic > 0) {
    try {
      const vecResults = db.prepare(`
        SELECT id, distance FROM memories_vec
        WHERE embedding MATCH ?
        AND k = ?
      `).all(queryEmbedding.buffer, Math.min(50, candidates.length));

      for (const r of vecResults) {
        // sqlite-vec returns L2 distance; convert to similarity
        // similarity = 1 / (1 + distance)
        vecScores.set(r.id, 1 / (1 + r.distance));
      }
    } catch { /* vec query error — skip */ }
  }

  // Pre-fetch graph entity connections for boost
  const graphScores = new Map();
  if (weights.graph > 0) {
    try {
      // Find entities mentioned in query
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (queryWords.length > 0) {
        const likeClauses = queryWords.map(() => "LOWER(e.name) LIKE ?").join(" OR ");
        const likeParams = queryWords.map(w => `%${w}%`);

        const entityMemories = db.prepare(`
          SELECT DISTINCT em.memory_id, COUNT(*) as match_count
          FROM entity_mentions em
          JOIN entities e ON em.entity_id = e.id
          WHERE (${likeClauses}) AND e.is_valid = 1
          GROUP BY em.memory_id
        `).all(...likeParams);

        const maxMatch = Math.max(...entityMemories.map(r => r.match_count), 1);
        for (const r of entityMemories) {
          graphScores.set(r.memory_id, r.match_count / maxMatch);
        }
      }
    } catch { /* graph query error */ }
  }

  // 3. Compute final scores
  const now = Date.now();
  const scored = candidates.map(mem => {
    const semantic = vecScores.get(mem.id) || 0;
    const fts = ftsScores.get(mem.id) || 0;

    // Tag matching
    let tagScore = 0;
    if (weights.tags > 0) {
      try {
        const memTags = JSON.parse(mem.tags || "[]");
        const queryLower = query.toLowerCase();
        const matched = memTags.filter(t => queryLower.includes(t.toLowerCase()));
        tagScore = memTags.length > 0 ? matched.length / memTags.length : 0;
      } catch { /* */ }
    }

    // Freshness (time-decay)
    const ageMs = now - new Date(mem.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const freshness = Math.exp(-0.015 * ageDays);

    // Graph boost
    const graph = graphScores.get(mem.id) || 0;

    // Weighted final score
    const score =
      weights.semantic * semantic +
      weights.fts * fts +
      weights.tags * tagScore +
      weights.freshness * freshness +
      weights.graph * graph;

    // Effective importance (time-decayed)
    const accessBoost = Math.min(0.2, (mem.retrieval_count || 0) * 0.02);
    const effectiveScore = Math.max(0.05,
      mem.importance_score * Math.exp(-0.015 * ageDays) + accessBoost
    );

    return {
      ...mem,
      tags: safeParseJson(mem.tags, []),
      related_files: safeParseJson(mem.related_files, []),
      semantic_score: semantic,
      fts_score: fts,
      tag_score: tagScore,
      freshness_score: freshness,
      graph_score: graph,
      final_score: score,
      effective_score: effectiveScore,
    };
  });

  // 4. Sort by final score and return top N
  scored.sort((a, b) => b.final_score - a.final_score);
  const results = scored.slice(0, limit);

  // 5. Log access for predictive memory
  const logAccess = db.prepare(
    "INSERT INTO access_log (memory_id, tool_name) VALUES (?, 'memory_search')"
  );
  const updateRetrieval = db.prepare(
    "UPDATE memories SET retrieval_count = retrieval_count + 1 WHERE id = ?"
  );
  for (const r of results) {
    try {
      logAccess.run(r.id);
      updateRetrieval.run(r.id);
    } catch { /* */ }
  }

  return {
    results,
    count: results.length,
    search_mode: searchMode,
  };
}

/**
 * Get predictive memories — recently and frequently accessed memories.
 */
export function getPredictiveMemories(projectHash, limit = 5) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT m.*, COUNT(a.id) as access_count
      FROM memories m
      JOIN access_log a ON m.id = a.memory_id
      WHERE m.project_hash = ? AND m.is_archived = 0
        AND a.created_at >= datetime('now', '-7 days')
      GROUP BY m.id
      ORDER BY access_count DESC, m.importance_score DESC
      LIMIT ?
    `).all(projectHash, limit).map(r => ({
      ...r,
      tags: safeParseJson(r.tags, []),
      related_files: safeParseJson(r.related_files, []),
    }));
  } catch {
    return [];
  }
}

/**
 * Get recent activity for session recap.
 */
export function getRecentActivity(projectHash, daysBack = 7, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM memories
    WHERE project_hash = ? AND is_archived = 0
      AND created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT ?
  `).all(projectHash, daysBack, limit).map(r => ({
    ...r,
    tags: safeParseJson(r.tags, []),
    related_files: safeParseJson(r.related_files, []),
  }));
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
