/**
 * Hybrid search engine for MEMAXX Memory.
 * Combines: semantic (pgvector) + full-text (tsvector) + tag matching + time-decay.
 */

import { query } from "./db.mjs";
import { generateEmbedding } from "./embeddings.mjs";

// Search weights (aligned with cloud version)
const WEIGHTS = {
  hybrid: { semantic: 0.45, fts: 0.15, tags: 0.10, freshness: 0.10, graph: 0.20 },
  fulltext: { semantic: 0, fts: 0.60, tags: 0, freshness: 0.40, graph: 0 },
  keyword: { semantic: 0, fts: 0.40, tags: 0.40, freshness: 0.20, graph: 0 },
};

/**
 * Convert a Float32Array (or regular array) to pgvector string format.
 * @param {Float32Array|number[]} floatArray
 * @returns {string} e.g. '[0.1,0.2,0.3]'
 */
export function formatEmbedding(floatArray) {
  return "[" + Array.from(floatArray).join(",") + "]";
}

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
 * @returns {Promise<{ results: object[], count: number, search_mode: string }>}
 */
export async function searchMemories(params, embeddingConfig) {
  const {
    query: searchQuery,
    projectHash,
    searchMode = "hybrid",
    memoryType,
    filePath,
    limit = 10,
    recentOnly = false,
  } = params;

  const weights = WEIGHTS[searchMode] || WEIGHTS.hybrid;

  // 1. Get candidate memories
  let sql = `
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, retrieval_count, is_archived, created_at, updated_at
    FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
  `;
  const sqlParams = [projectHash];
  let paramIndex = 2;

  if (memoryType) {
    sql += ` AND type = $${paramIndex}`;
    sqlParams.push(memoryType);
    paramIndex++;
  }

  if (filePath) {
    sql += ` AND related_files::text LIKE $${paramIndex}`;
    sqlParams.push(`%${filePath}%`);
    paramIndex++;
  }

  if (recentOnly) {
    sql += " AND created_at >= NOW() - INTERVAL '30 days'";
  }

  sql += " ORDER BY created_at DESC LIMIT 200";

  const { rows: candidates } = await query(sql, sqlParams);
  if (candidates.length === 0) return { results: [], count: 0, search_mode: searchMode };

  // 2. Score each candidate
  const queryEmbedding = weights.semantic > 0
    ? await generateEmbedding(searchQuery, embeddingConfig)
    : null;

  // Pre-fetch FTS matches
  const ftsScores = new Map();
  if (weights.fts > 0 && searchQuery.trim()) {
    try {
      const { rows: ftsResults } = await query(`
        SELECT id, ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
        FROM memories
        WHERE project_hash = $2 AND search_vector @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT 100
      `, [searchQuery, projectHash]);

      if (ftsResults.length > 0) {
        const maxRank = Math.max(...ftsResults.map(r => r.rank), 1);
        for (const r of ftsResults) {
          ftsScores.set(r.id, r.rank / maxRank);
        }
      }
    } catch { /* FTS query error — skip */ }
  }

  // Pre-fetch semantic similarities via pgvector
  const vecScores = new Map();
  if (queryEmbedding && weights.semantic > 0) {
    try {
      const embeddingStr = formatEmbedding(queryEmbedding);
      const vecLimit = Math.min(50, candidates.length);
      const { rows: vecResults } = await query(`
        SELECT id, 1 - (embedding <=> $1::vector) as similarity
        FROM memories
        WHERE project_hash = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `, [embeddingStr, projectHash, vecLimit]);

      for (const r of vecResults) {
        vecScores.set(r.id, r.similarity);
      }
    } catch { /* vec query error — skip */ }
  }

  // Pre-fetch graph entity connections for boost
  const graphScores = new Map();
  if (weights.graph > 0) {
    try {
      const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (queryWords.length > 0) {
        const likeClauses = queryWords.map((_, i) => `LOWER(e.name) LIKE $${i + 1}`).join(" OR ");
        const likeParams = queryWords.map(w => `%${w}%`);

        const { rows: entityMemories } = await query(`
          SELECT DISTINCT em.memory_id, COUNT(*) as match_count
          FROM entity_mentions em
          JOIN entities e ON em.entity_id = e.id
          WHERE (${likeClauses}) AND e.is_valid = TRUE
          GROUP BY em.memory_id
        `, likeParams);

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
        const memTags = Array.isArray(mem.tags) ? mem.tags : JSON.parse(mem.tags || "[]");
        const queryLower = searchQuery.toLowerCase();
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
      tags: Array.isArray(mem.tags) ? mem.tags : safeParseJson(mem.tags, []),
      related_files: Array.isArray(mem.related_files) ? mem.related_files : safeParseJson(mem.related_files, []),
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
  for (const r of results) {
    try {
      await query(
        "INSERT INTO access_log (memory_id, tool_name) VALUES ($1, 'memory_search')",
        [r.id]
      );
      await query(
        "UPDATE memories SET retrieval_count = retrieval_count + 1 WHERE id = $1",
        [r.id]
      );
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
 * @param {string} projectHash
 * @param {number} [limit=5]
 * @returns {Promise<object[]>}
 */
export async function getPredictiveMemories(projectHash, limit = 5) {
  try {
    const { rows } = await query(`
      SELECT m.*, COUNT(a.id) as access_count
      FROM memories m
      JOIN access_log a ON m.id = a.memory_id
      WHERE m.project_hash = $1 AND m.is_archived = FALSE
        AND a.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY m.id
      ORDER BY access_count DESC, m.importance_score DESC
      LIMIT $2
    `, [projectHash, limit]);

    return rows.map(r => ({
      ...r,
      tags: Array.isArray(r.tags) ? r.tags : safeParseJson(r.tags, []),
      related_files: Array.isArray(r.related_files) ? r.related_files : safeParseJson(r.related_files, []),
    }));
  } catch {
    return [];
  }
}

/**
 * Get recent activity for session recap.
 * @param {string} projectHash
 * @param {number} [daysBack=7]
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
export async function getRecentActivity(projectHash, daysBack = 7, limit = 20) {
  const { rows } = await query(`
    SELECT * FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
      AND created_at >= NOW() - ($2 || ' days')::INTERVAL
    ORDER BY created_at DESC
    LIMIT $3
  `, [projectHash, daysBack, limit]);

  return rows.map(r => ({
    ...r,
    tags: Array.isArray(r.tags) ? r.tags : safeParseJson(r.tags, []),
    related_files: Array.isArray(r.related_files) ? r.related_files : safeParseJson(r.related_files, []),
  }));
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
