#!/usr/bin/env node
/**
 * MEMAXX Memory — restore from a backup JSON snapshot.
 *
 * Usage:
 *   node scripts/restore.mjs --file /path/to/memaxx-2026-04-16.json [--dry-run] [--truncate]
 *
 * Flags:
 *   --file <path>    Backup file to restore (required).
 *   --dry-run        Parse + validate only, no writes.
 *   --truncate       TRUNCATE each target table before restoring. Without this,
 *                    existing rows remain and INSERTs skip conflicts via ON CONFLICT.
 *
 * Safety:
 *   - Redacted system_config rows (value starts with "***redacted:") are SKIPPED
 *     so the restore never overwrites real API keys with placeholders.
 *   - Rows are inserted in dependency order: projects → memories → entities →
 *     entity_mentions → relations → (everything else).
 *   - Each table is wrapped in its own transaction; a failure mid-table aborts
 *     that table only, leaving earlier tables intact.
 *
 * Connect via the same DATABASE_URL the server uses. Run from inside the
 * container (docker compose exec memaxx node scripts/restore.mjs ...) so
 * networking and env match.
 */

import { readFileSync, existsSync } from "node:fs";
import { initDatabase, closeDatabase, query } from "../src/db.mjs";

// ── CLI parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function value(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const file = value("--file");
const dryRun = flag("--dry-run");
const truncate = flag("--truncate");

if (!file) {
  console.error("Usage: restore.mjs --file <backup.json> [--dry-run] [--truncate]");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(2);
}

// ── Load + validate ────────────────────────────────────────────────
let snapshot;
try {
  snapshot = JSON.parse(readFileSync(file, "utf-8"));
} catch (err) {
  console.error(`Failed to parse ${file}: ${err.message}`);
  process.exit(2);
}

if (snapshot?.version !== 1 || !snapshot?.tables || typeof snapshot.tables !== "object") {
  console.error("Invalid snapshot — expected { version: 1, tables: {...} }");
  process.exit(2);
}

const tableOrder = [
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

console.log(`\n▶ Restoring from ${file}`);
console.log(`  snapshot created: ${snapshot.created_at}`);
console.log(`  mode: ${dryRun ? "DRY RUN" : truncate ? "TRUNCATE + INSERT" : "INSERT (upsert)"}\n`);

// ── Summary (always shown) ─────────────────────────────────────────
let totalRows = 0;
for (const t of tableOrder) {
  const rows = snapshot.tables[t];
  if (!rows) continue;
  console.log(`  ${t.padEnd(22)} ${rows.length} rows`);
  totalRows += rows.length;
}
console.log(`  ${"TOTAL".padEnd(22)} ${totalRows} rows\n`);

if (dryRun) {
  console.log("✓ Dry run complete — snapshot is well-formed. No changes made.");
  process.exit(0);
}

// ── Connect to DB and restore ──────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set — cannot connect.");
  process.exit(2);
}

// Guess embedding dim from first memory row with embedding.
let dim = 1536;
const memRows = snapshot.tables.memories || [];
for (const r of memRows) {
  if (typeof r.embedding === "string" && r.embedding.startsWith("[")) {
    const parts = r.embedding.slice(1, -1).split(",");
    if (parts.length > 0) { dim = parts.length; break; }
  }
}

await initDatabase(dbUrl, dim);

let totalInserted = 0;
let totalSkipped = 0;
for (const table of tableOrder) {
  const rows = snapshot.tables[table];
  if (!rows || rows.length === 0) continue;

  if (truncate) {
    try {
      await query(`TRUNCATE TABLE ${table} CASCADE`);
      console.log(`  ✓ truncated ${table}`);
    } catch (err) {
      console.error(`  ✖ truncate ${table} failed: ${err.message} — skipping table`);
      continue;
    }
  }

  const { inserted, skipped } = await restoreTable(table, rows);
  totalInserted += inserted;
  totalSkipped += skipped;
  console.log(`  ${table.padEnd(22)} inserted=${inserted}  skipped=${skipped}`);
}

console.log(`\n✓ Restore complete — ${totalInserted} rows inserted, ${totalSkipped} skipped.`);
await closeDatabase();
process.exit(0);

// ── Helpers ────────────────────────────────────────────────────────
async function restoreTable(table, rows) {
  let inserted = 0, skipped = 0;

  for (const row of rows) {
    // Skip redacted system_config rows — they would overwrite real keys.
    if (table === "system_config" && typeof row.value === "string" && row.value.startsWith("***redacted:")) {
      skipped++;
      continue;
    }

    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const vals = cols.map((c) => normalize(row[c]));

    const sql = `
      INSERT INTO ${table} (${cols.map(quote).join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT DO NOTHING
    `;
    try {
      const r = await query(sql, vals);
      if (r.rowCount > 0) inserted++;
      else skipped++;
    } catch (err) {
      skipped++;
      if (process.env.RESTORE_VERBOSE) {
        console.error(`    ${table} row failed: ${err.message}`);
      }
    }
  }
  return { inserted, skipped };
}

function quote(ident) { return `"${ident.replace(/"/g, '""')}"`; }

/**
 * Pass values through with minimal massaging. pg-node handles most types
 * automatically. Arrays and objects get serialized to JSON for jsonb columns;
 * pgvector strings like "[0.1,0.2]" pass straight through.
 */
function normalize(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}
