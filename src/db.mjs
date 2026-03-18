/**
 * PostgreSQL database setup and migrations for MEMAXX Memory.
 * Uses pg (Pool) + pgvector for vector search.
 */

import pg from "pg";

const { Pool } = pg;

let _pool = null;

/**
 * Initialize the PostgreSQL connection pool and run all migrations.
 * @param {string} databaseUrl - PostgreSQL connection string (e.g., postgresql://memaxx:memaxx@postgres:5432/memaxx)
 * @param {number} [embeddingDim=1536] - Dimension of embedding vectors
 * @returns {Promise<pg.Pool>}
 */
export async function initDatabase(databaseUrl, embeddingDim = 1536) {
  if (_pool) return _pool;

  if (!databaseUrl) {
    databaseUrl = process.env.DATABASE_URL;
  }
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Pass it to initDatabase() or set the DATABASE_URL environment variable."
    );
  }

  _pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
  });

  // Verify connectivity
  const client = await _pool.connect();
  try {
    // Enable pgvector extension
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    client.release();
  }

  // Run migrations
  await migrate(embeddingDim);

  return _pool;
}

/**
 * Get the active connection pool.
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!_pool) throw new Error("Database not initialized. Call initDatabase() first.");
  return _pool;
}

/**
 * Close the connection pool.
 */
export async function closeDatabase() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Execute a SQL query using the pool.
 * @param {string} sql - SQL statement (use $1, $2, ... for parameters)
 * @param {any[]} [params=[]] - Parameter values
 * @returns {Promise<{rows: any[], rowCount: number}>}
 */
export async function query(sql, params = []) {
  if (!_pool) throw new Error("Database not initialized. Call initDatabase() first.");
  return _pool.query(sql, params);
}

// ── Migrations ───────────────────────────────────────────────────────

async function migrate(embeddingDim) {
  // Create migration tracking table
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const result = await query("SELECT name FROM _migrations");
  const applied = new Set(result.rows.map((r) => r.name));

  const migrations = getMigrations(embeddingDim);

  for (const { name, sql } of migrations) {
    if (!applied.has(name)) {
      log(`Running migration: ${name}`);
      const client = await _pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration "${name}" failed: ${err.message}`);
      } finally {
        client.release();
      }
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
          importance_score DOUBLE PRECISION DEFAULT 0.5,
          tags JSONB DEFAULT '[]'::jsonb,
          related_files JSONB DEFAULT '[]'::jsonb,
          session_name TEXT,
          content_hash TEXT,
          retrieval_count INTEGER DEFAULT 0,
          is_archived BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS search_vector tsvector;

        CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories USING GIN(search_vector);

        CREATE OR REPLACE FUNCTION memories_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english',
            COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.tags::text, '')
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_memories_search_vector ON memories;
        CREATE TRIGGER trg_memories_search_vector
          BEFORE INSERT OR UPDATE ON memories
          FOR EACH ROW
          EXECUTE FUNCTION memories_search_vector_update();
      `,
    },
    {
      name: "003_memories_vec",
      sql: `
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(${dim});

        CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
          ON memories USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64);
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
          confidence DOUBLE PRECISION DEFAULT 1.0,
          is_valid BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          confidence DOUBLE PRECISION DEFAULT 1.0,
          is_valid BOOLEAN DEFAULT TRUE,
          valid_from TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          valid_to TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMPTZ
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
          affected_files JSONB DEFAULT '[]'::jsonb,
          warning_pattern TEXT,
          severity TEXT DEFAULT 'medium',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          confidence DOUBLE PRECISION DEFAULT 0.5,
          status TEXT DEFAULT 'candidate',
          applied_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS thinking_thoughts (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL REFERENCES thinking_sequences(id) ON DELETE CASCADE,
          type TEXT DEFAULT 'observation',
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_thinking_project ON thinking_sequences(project_hash);
        CREATE INDEX IF NOT EXISTS idx_thoughts_sequence ON thinking_thoughts(sequence_id);
      `,
    },
    {
      name: "011_access_log",
      sql: `
        CREATE TABLE IF NOT EXISTS access_log (
          id SERIAL PRIMARY KEY,
          memory_id TEXT NOT NULL,
          tool_name TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_rules_project ON rules(project_hash);
      `,
    },
    {
      name: "013_entities_vec",
      sql: `
        ALTER TABLE entities ADD COLUMN IF NOT EXISTS embedding vector(${dim});

        CREATE INDEX IF NOT EXISTS idx_entities_embedding_hnsw
          ON entities USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64);
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_docs(project_hash);
        CREATE INDEX IF NOT EXISTS idx_project_docs_type ON project_docs(doc_type);

        CREATE TABLE IF NOT EXISTS project_links (
          id TEXT PRIMARY KEY,
          source_project_hash TEXT NOT NULL,
          target_project_hash TEXT NOT NULL,
          link_type TEXT NOT NULL DEFAULT 'related',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(source_project_hash, target_project_hash)
        );

        CREATE INDEX IF NOT EXISTS idx_project_links_source ON project_links(source_project_hash);
        CREATE INDEX IF NOT EXISTS idx_project_links_target ON project_links(target_project_hash);
      `,
    },
    {
      name: "016_system_config",
      sql: `
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `,
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a random 12-character alphanumeric ID using DJB2-style mixing.
 * @returns {string}
 */
export function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < 12; i++) id += chars[bytes[i] % chars.length];
  return id;
}

/**
 * Compute a simple DJB2 content hash for deduplication (not cryptographic).
 * @param {string} text
 * @returns {string}
 */
export function contentHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function log(msg) {
  process.stderr.write(`[memaxx] ${msg}\n`);
}
