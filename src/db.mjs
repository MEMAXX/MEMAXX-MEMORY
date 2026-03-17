/**
 * SQLite database setup and migrations for MEMAXX Memory Local.
 * Uses better-sqlite3 + sqlite-vec for vector search.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _db = null;

/**
 * Open (or create) the SQLite database with sqlite-vec loaded.
 * @param {string} dbPath
 * @param {number} embeddingDim
 * @returns {import("better-sqlite3").Database}
 */
export function openDatabase(dbPath, embeddingDim) {
  if (_db) return _db;

  // Ensure directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Performance settings
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB
  db.pragma("foreign_keys = ON");

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Run migrations
  migrate(db, embeddingDim);

  _db = db;
  return db;
}

export function getDb() {
  if (!_db) throw new Error("Database not initialized. Call openDatabase() first.");
  return _db;
}

export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Migrations ───────────────────────────────────────────────────────

function migrate(db, embeddingDim) {
  // Create migration tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map(r => r.name)
  );

  const migrations = getMigrations(embeddingDim);

  const runMigration = db.transaction((name, sql) => {
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  });

  for (const { name, sql } of migrations) {
    if (!applied.has(name)) {
      log(`Running migration: ${name}`);
      runMigration(name, sql);
    }
  }
}

function getMigrations(dim) {
  return [
    {
      name: "001_memories",
      sql: `
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'learning',
          importance_score REAL DEFAULT 0.5,
          tags TEXT DEFAULT '[]',
          related_files TEXT DEFAULT '[]',
          session_name TEXT,
          content_hash TEXT,
          retrieval_count INTEGER DEFAULT 0,
          is_archived INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_hash);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(project_hash, content_hash);
      `,
    },
    {
      name: "002_memories_fts",
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          tags,
          content='memories',
          content_rowid='rowid'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
          INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
        END;
      `,
    },
    {
      name: "003_memories_vec",
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dim}]
        );
      `,
    },
    {
      name: "004_entities",
      sql: `
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'concept',
          description TEXT,
          confidence REAL DEFAULT 1.0,
          is_valid INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_hash);
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_unique ON entities(project_hash, name, type);
      `,
    },
    {
      name: "005_relations",
      sql: `
        CREATE TABLE IF NOT EXISTS relations (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          source_id TEXT NOT NULL REFERENCES entities(id),
          target_id TEXT NOT NULL REFERENCES entities(id),
          relation TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          is_valid INTEGER DEFAULT 1,
          valid_from TEXT DEFAULT (datetime('now')),
          valid_to TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
        CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
        CREATE INDEX IF NOT EXISTS idx_relations_project ON relations(project_hash);
      `,
    },
    {
      name: "006_entity_mentions",
      sql: `
        CREATE TABLE IF NOT EXISTS entity_mentions (
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (memory_id, entity_id)
        );
      `,
    },
    {
      name: "007_tasks",
      sql: `
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'open',
          priority TEXT DEFAULT 'medium',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_hash);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      `,
    },
    {
      name: "008_postmortems",
      sql: `
        CREATE TABLE IF NOT EXISTS postmortems (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          bug_category TEXT,
          description TEXT,
          root_cause TEXT,
          fix_description TEXT,
          prevention TEXT,
          affected_files TEXT DEFAULT '[]',
          warning_pattern TEXT,
          severity TEXT DEFAULT 'medium',
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_postmortems_project ON postmortems(project_hash);
        CREATE INDEX IF NOT EXISTS idx_postmortems_files ON postmortems(affected_files);
      `,
    },
    {
      name: "009_patterns",
      sql: `
        CREATE TABLE IF NOT EXISTS patterns (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          pattern TEXT NOT NULL,
          description TEXT,
          category TEXT DEFAULT 'general',
          confidence REAL DEFAULT 0.5,
          status TEXT DEFAULT 'candidate',
          applied_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_patterns_project ON patterns(project_hash);
        CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
      `,
    },
    {
      name: "010_thinking",
      sql: `
        CREATE TABLE IF NOT EXISTS thinking_sequences (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS thinking_thoughts (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL REFERENCES thinking_sequences(id) ON DELETE CASCADE,
          type TEXT DEFAULT 'observation',
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_thinking_project ON thinking_sequences(project_hash);
        CREATE INDEX IF NOT EXISTS idx_thoughts_sequence ON thinking_thoughts(sequence_id);
      `,
    },
    {
      name: "011_access_log",
      sql: `
        CREATE TABLE IF NOT EXISTS access_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          tool_name TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_access_log_memory ON access_log(memory_id);
      `,
    },
    {
      name: "012_rules",
      sql: `
        CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          content TEXT NOT NULL,
          priority TEXT DEFAULT 'should',
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rules_project ON rules(project_hash);
      `,
    },
    {
      name: "013_entities_vec",
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dim}]
        );
      `,
    },
    {
      name: "014_document_uploads",
      sql: `
        CREATE TABLE IF NOT EXISTS document_uploads (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_type TEXT DEFAULT 'text',
          file_size INTEGER,
          chunk_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'processing',
          error_message TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_doc_uploads_project ON document_uploads(project_hash);
      `,
    },
    {
      name: "015_project_docs_and_links",
      sql: `
        CREATE TABLE IF NOT EXISTS project_docs (
          id TEXT PRIMARY KEY,
          project_hash TEXT NOT NULL,
          doc_type TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_docs(project_hash);
        CREATE INDEX IF NOT EXISTS idx_project_docs_type ON project_docs(doc_type);

        CREATE TABLE IF NOT EXISTS project_links (
          id TEXT PRIMARY KEY,
          source_project_hash TEXT NOT NULL,
          target_project_hash TEXT NOT NULL,
          link_type TEXT NOT NULL DEFAULT 'related',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(source_project_hash, target_project_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_project_links_source ON project_links(source_project_hash);
        CREATE INDEX IF NOT EXISTS idx_project_links_target ON project_links(target_project_hash);
      `,
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────

export function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < 12; i++) id += chars[bytes[i] % chars.length];
  return id;
}

export function contentHash(text) {
  // Simple DJB2 hash for dedup (not crypto)
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function log(msg) {
  process.stderr.write(`[memaxx-local] ${msg}\n`);
}
