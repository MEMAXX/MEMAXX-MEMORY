/**
 * Daily backup of critical MEMAXX tables.
 *
 * Design decisions:
 *   - Runs inside the Docker container (no docker exec shenanigans)
 *   - Exports to JSON (not SQL) — portable, human-readable, easy to restore
 *   - Skips if today's backup already exists (idempotent on restart)
 *   - Rotation: keeps last 14 days
 *   - Non-fatal: failures log a warning but don't crash the server
 *   - Backup dir: /app/.memaxx-backups (mount this volume in docker-compose
 *     if you want backups to survive container rebuilds)
 *
 * What's backed up:
 *   - memories (the core data — Content, Embeddings, Tags, Files)
 *   - entities + relations (knowledge graph)
 *   - projects (names, git_remote)
 *   - system_config (provider keys — hashed/redacted)
 *   - rules, postmortems, tasks, thinking_sequences, thoughts
 *
 * What's NOT backed up:
 *   - backup_log (meta)
 *   - migrations table
 */

import { readdirSync, mkdirSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { query } from "./db.mjs";
import { childLog } from "./log.mjs";

const blog = childLog("backup");
const BACKUP_DIR = process.env.BACKUP_DIR || "/app/.memaxx-backups";
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS || "14", 10);

// Tables to export. Order matters for restore (dependencies first).
// Only tables that exist in the current schema — missing ones are skipped
// gracefully by exportTable() which catches the "relation does not exist" error.
const TABLES = [
  "projects",
  "memories",
  "entities",
  "entity_mentions",
  "relations",
  "rules",
  "postmortems",
  "tasks",
  "thinking_sequences",
  "thinking_thoughts",
  "patterns",
  "project_docs",
  "project_links",
  "document_uploads",
  "system_config",
];

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Export a table to a plain array of row objects.
 * Embeddings are stringified (pgvector returns them as strings already).
 */
async function exportTable(table) {
  try {
    const { rows } = await query(`SELECT * FROM ${table}`);
    return rows;
  } catch (err) {
    blog.warn({ err, table }, "table export failed (may not exist in this schema)");
    return null;
  }
}

/**
 * Redact sensitive values before writing to disk.
 * API keys in system_config are hashed to prove they existed without exposing them.
 */
function redactRow(table, row) {
  if (table === "system_config" && row?.key?.includes("api_key") && row?.value) {
    return { ...row, value: `***redacted:${row.value.slice(-4)}` };
  }
  return row;
}

/**
 * Run one backup. Returns the path to the written file, or null if skipped/failed.
 */
export async function runBackup({ force = false } = {}) {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    blog.warn({ err }, "cannot create backup dir");
    return null;
  }

  const stamp = todayStamp();
  const file = join(BACKUP_DIR, `memaxx-${stamp}.json`);

  if (!force && existsSync(file)) {
    blog.debug({ file }, "backup already exists for today — skipping");
    return file;
  }

  const started = Date.now();
  const snapshot = { version: 1, created_at: new Date().toISOString(), tables: {} };

  for (const table of TABLES) {
    const rows = await exportTable(table);
    if (rows === null) continue;
    snapshot.tables[table] = rows.map((r) => redactRow(table, r));
  }

  try {
    writeFileSync(file, JSON.stringify(snapshot, null, 2));
    const sizeKb = Math.round(statSync(file).size / 1024);
    const tableCount = Object.keys(snapshot.tables).length;
    const rowCount = Object.values(snapshot.tables).reduce((n, t) => n + t.length, 0);
    blog.info(
      { file, size_kb: sizeKb, tables: tableCount, rows: rowCount, duration_ms: Date.now() - started },
      "backup written"
    );
  } catch (err) {
    blog.error({ err, file }, "backup write failed");
    return null;
  }

  // Rotate: delete files older than KEEP_DAYS
  try {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("memaxx-") && f.endsWith(".json"));
    for (const f of files) {
      const fpath = join(BACKUP_DIR, f);
      try {
        if (statSync(fpath).mtimeMs < cutoff) {
          unlinkSync(fpath);
          blog.info({ file: f }, "rotated old backup");
        }
      } catch { /* file vanished, that's fine */ }
    }
  } catch (err) {
    blog.warn({ err }, "backup rotation failed");
  }

  return file;
}

/**
 * Schedule a daily backup check. Runs once at startup, then every 6 hours.
 * (6h interval catches long-running servers that span day boundaries.)
 */
export function scheduleBackups() {
  // Initial backup at startup — delayed 10s to let DB settle
  setTimeout(() => { runBackup().catch(() => {}); }, 10_000);

  // Re-check every 6 hours
  setInterval(() => { runBackup().catch(() => {}); }, 6 * 60 * 60 * 1000);

  blog.info({ dir: BACKUP_DIR, keep_days: KEEP_DAYS }, "backup scheduler active");
}
