/**
 * Phase 4 — Graceful Degradation retry worker.
 *
 * When embedding or entity-extraction providers are offline, memory_store
 * leaves rows with embedding_pending=TRUE or entities_pending=TRUE. This
 * worker wakes every 5 minutes and retries a small batch. On success, the
 * row's pending flag is cleared and the memory becomes fully searchable.
 *
 * Design notes:
 *  - Batch size 20 keeps a single provider outage from hammering APIs on recovery.
 *  - Partial index idx_memories_*_pending makes the SELECT nearly free even at scale.
 *  - Failures are silent — a still-offline provider will simply be retried next tick.
 */

import { query, generateId } from "./db.mjs";
import { generateEmbedding } from "./embeddings.mjs";
import { extractEntities } from "./llm.mjs";
import { formatEmbedding } from "./search.mjs";
import { getConfigs } from "./tools.mjs";
import { childLog } from "./log.mjs";

const log = childLog("retry");

const MIN_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes — healthy cadence
const MAX_INTERVAL_MS = 60 * 60 * 1000; // 1 hour cap — long-outage cadence
const BATCH_SIZE = 20;

let _timer = null;
let _currentIntervalMs = MIN_INTERVAL_MS;
let _consecutiveEmptyOrFailedTicks = 0;

export function startRetryWorker() {
  if (_timer) return;
  // First run after 30s so startup migrations finish first.
  setTimeout(() => { tick().catch((err) => log.error({ err }, "retry tick failed")); }, 30_000);
  log.info({ minIntervalMs: MIN_INTERVAL_MS, maxIntervalMs: MAX_INTERVAL_MS, batchSize: BATCH_SIZE }, "retry worker scheduled");
}

export function stopRetryWorker() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _currentIntervalMs = MIN_INTERVAL_MS;
  _consecutiveEmptyOrFailedTicks = 0;
}

/** One scheduled tick: run the work, adjust cadence, schedule the next. */
async function tick() {
  let stats = { embeddings: 0, entities: 0 };
  try {
    stats = await runOnce();
  } catch (err) {
    log.error({ err }, "retry tick failed");
  }

  // Adaptive cadence: if we drained anything, reset to min interval.
  // If we found nothing to do (or all attempts failed), back off up to MAX.
  if (stats.embeddings > 0 || stats.entities > 0) {
    if (_currentIntervalMs !== MIN_INTERVAL_MS) {
      log.info({ previousMs: _currentIntervalMs }, "retry worker cadence reset to min");
    }
    _currentIntervalMs = MIN_INTERVAL_MS;
    _consecutiveEmptyOrFailedTicks = 0;
  } else {
    _consecutiveEmptyOrFailedTicks++;
    // Double the interval each empty tick, cap at MAX.
    _currentIntervalMs = Math.min(MAX_INTERVAL_MS, _currentIntervalMs * 2);
  }

  _timer = setTimeout(() => { tick().catch((err) => log.error({ err }, "retry tick failed")); }, _currentIntervalMs);
}

/** Exported for tests — runs a single retry pass. */
export async function runOnce() {
  const { embeddingConfig, llmConfig } = getConfigs();
  const stats = { embeddings: 0, entities: 0 };

  // ── Embedding retry ───────────────────────────────────────────────
  if (embeddingConfig) {
    const pending = await query(
      `SELECT id, content FROM memories
       WHERE embedding_pending = TRUE
       ORDER BY created_at ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    for (const row of pending.rows) {
      try {
        const emb = await generateEmbedding(row.content, embeddingConfig);
        if (emb) {
          const vec = formatEmbedding(emb);
          await query(
            "UPDATE memories SET embedding = $1::vector, embedding_pending = FALSE WHERE id = $2",
            [vec, row.id]
          );
          stats.embeddings++;
        }
      } catch {
        // Provider still offline — skip this row, pick it up next tick.
      }
    }
  }

  // ── Entity-extraction retry ───────────────────────────────────────
  if (llmConfig) {
    const pending = await query(
      `SELECT id, project_hash, content, type FROM memories
       WHERE entities_pending = TRUE
       ORDER BY created_at ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    for (const row of pending.rows) {
      try {
        const { entities, relations } = await extractEntities(row.content, row.type, llmConfig);
        await persistEntities(row.id, row.project_hash, entities, relations, embeddingConfig);
        await query("UPDATE memories SET entities_pending = FALSE WHERE id = $1", [row.id]);
        stats.entities++;
      } catch {
        // LLM still offline — retry next tick.
      }
    }
  }

  if (stats.embeddings || stats.entities) {
    log.info(stats, "retry tick cleared pending rows");
  }
  return stats;
}

/**
 * Mirror of processMemoryAsync's entity-write loop. Kept deliberately
 * separate from tools.mjs to avoid a circular import (tools → retry → tools).
 */
async function persistEntities(memoryId, ph, entities, relations, embeddingConfig) {
  for (const ent of entities || []) {
    try {
      await query(`
        INSERT INTO entities (id, project_hash, name, type) VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_hash, name, type) DO UPDATE SET updated_at = NOW()
      `, [generateId(), ph, ent.name, ent.type]);

      const actualRes = await query(
        "SELECT id FROM entities WHERE project_hash = $1 AND name = $2 AND type = $3",
        [ph, ent.name, ent.type]
      );
      const actualEntity = actualRes.rows[0];
      if (!actualEntity) continue;

      try {
        await query(
          "INSERT INTO entity_mentions (memory_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [memoryId, actualEntity.id]
        );
      } catch { /* */ }

      if (embeddingConfig) {
        try {
          const entEmbedding = await generateEmbedding(ent.name, embeddingConfig);
          if (entEmbedding) {
            const entVec = formatEmbedding(entEmbedding);
            await query("UPDATE entities SET embedding = $1::vector WHERE id = $2", [entVec, actualEntity.id]);
          }
        } catch { /* entity embedding offline — non-fatal */ }
      }
    } catch { /* entity insert error */ }
  }

  for (const rel of relations || []) {
    try {
      const sourceRes = await query("SELECT id FROM entities WHERE project_hash = $1 AND name = $2", [ph, rel.source]);
      const targetRes = await query("SELECT id FROM entities WHERE project_hash = $1 AND name = $2", [ph, rel.target]);
      const source = sourceRes.rows[0];
      const target = targetRes.rows[0];
      if (source && target) {
        await query(`
          INSERT INTO relations (id, project_hash, source_id, target_id, relation)
          VALUES ($1, $2, $3, $4, $5)
        `, [generateId(), ph, source.id, target.id, rel.relation]);
      }
    } catch { /* */ }
  }
}
