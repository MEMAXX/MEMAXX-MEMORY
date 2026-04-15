/**
 * MCP Tool definitions and handlers for MEMAXX Memory.
 * Implements all memory tools with PostgreSQL (async pg).
 */

import { query, generateId, contentHash } from "./db.mjs";
import { generateEmbedding, cosineSimilarity } from "./embeddings.mjs";
import { extractEntities } from "./llm.mjs";
import { searchMemories, getPredictiveMemories, getRecentActivity, formatEmbedding } from "./search.mjs";

/** @type {object} */
let _embeddingConfig = null;
let _llmConfig = null;

export function setConfigs(embeddingConfig, llmConfig) {
  _embeddingConfig = embeddingConfig;
  _llmConfig = llmConfig;
}

// ── Tool Definitions ─────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "memory_init",
    description: "Session start — loads rules (user + built-in), recap, tasks, predictive memories, and project profile.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", description: "Absolute path to the project root directory." },
        git_remote: { type: "string", description: "Git remote URL (e.g. from `git remote get-url origin`). Used for cross-machine project identification." },
        days_back: { type: "number", description: "Days to look back for recap (1-30, default 7)." },
        manifest: {
          type: "object",
          description: "Optional project manifest for built-in rule selection.",
          properties: {
            files: { type: "array", items: { type: "string" }, description: "Root-level file names (e.g. [\"package.json\", \"tsconfig.json\"])." },
            package_json: {
              type: "object",
              description: "Parsed package.json summary.",
              properties: {
                dependencies: { type: "object" },
                devDependencies: { type: "object" },
                scripts: { type: "object" },
              },
            },
            has_tests: { type: "boolean", description: "Whether project has test directory." },
          },
        },
        token_budget: { type: "number", description: "Token budget for context compression (default 4000). Reduces token waste by prioritizing high-importance memories." },
      },
    },
  },
  {
    name: "memory_store",
    description: "Store a memory with Quality Gate + Content Hash Dedup + async Embedding + Entity Extraction.",
    inputSchema: {
      type: "object",
      required: ["content", "type"],
      properties: {
        content: { type: "string", description: "The memory content (min 20 chars)." },
        type: { type: "string", enum: ["feature", "code-snippet", "debug", "design", "decision", "rule", "learning", "research", "discussion", "progress", "task", "working-notes", "pattern", "context", "bug", "document-chunk"], description: "Memory type." },
        importance_score: { type: "number", description: "Importance 0.0-1.0 (default 0.5)." },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization (max 50)." },
        related_files: { type: "array", items: { type: "string" }, description: "Related file paths (absolute, max 50)." },
        related_memory_ids: { type: "array", items: { type: "string" }, description: "IDs of related memories." },
        session_name: { type: "string", description: "Session grouping name." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_search",
    description: "Search memories with hybrid/fulltext/keyword modes, time-decay reranking, and graph-boosted scoring.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query (max 500 chars)." },
        search_mode: { type: "string", enum: ["hybrid", "fulltext", "keyword"], description: "Search mode (default hybrid)." },
        memory_type: { type: "string", description: "Filter by memory type." },
        file_path: { type: "string", description: "Filter by related file path." },
        limit: { type: "number", description: "Max results 1-50 (default 10)." },
        recent_only: { type: "boolean", description: "Only last 30 days." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
        token_budget: { type: "number", description: "Token budget for adaptive compression. Truncates low-priority results to fit budget." },
      },
    },
  },
  {
    name: "memory_modify",
    description: "Update, archive, reactivate, or delete memories. All changes recorded in audit trail.",
    inputSchema: {
      type: "object",
      required: ["memory_id", "action"],
      properties: {
        memory_id: { type: "string", description: "Memory ID." },
        id: { type: "string", description: "Memory ID (deprecated — use memory_id)." },
        action: { type: "string", enum: ["update", "archive", "inactivate", "reactivate", "unarchive", "delete"], description: "Action to perform." },
        content: { type: "string", description: "New content (for update)." },
        type: { type: "string", description: "New type (for update)." },
        importance_score: { type: "number", description: "New importance (for update)." },
        tags: { type: "array", items: { type: "string" }, description: "New tags (for update)." },
        related_files: { type: "array", items: { type: "string" }, description: "New related files (for update)." },
        reason: { type: "string", description: "Reason (required for inactivate)." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_list",
    description: "List all memories for the current project, grouped by type.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "memory_expand",
    description: "Get full content of memories by IDs (max 10).",
    inputSchema: {
      type: "object",
      required: ["memory_ids"],
      properties: {
        memory_ids: { type: "array", items: { type: "string" }, description: "Memory IDs (max 10)." },
        ids: { type: "array", items: { type: "string" }, description: "Memory IDs (deprecated — use memory_ids)." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_export",
    description: "Export all memories as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  // Knowledge Graph
  {
    name: "memory_graph_explore",
    description: "Explore the knowledge graph around an entity or topic. Returns entity, neighbors, and linked memories.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Entity name or topic to explore." },
        entity_name: { type: "string", description: "Entity name (deprecated — use query)." },
        depth: { type: "number", description: "Traversal depth 1-5 (default 2)." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_graph_stats",
    description: "Knowledge graph statistics — entity counts by type, top connected entities, relation counts.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_graph_path",
    description: "Find shortest path between two entities using BFS.",
    inputSchema: {
      type: "object",
      required: ["source_entity", "target_entity"],
      properties: {
        source_entity: { type: "string", description: "Source entity name or ID." },
        target_entity: { type: "string", description: "Target entity name or ID." },
        from: { type: "string", description: "Source entity (deprecated — use source_entity)." },
        to: { type: "string", description: "Target entity (deprecated — use target_entity)." },
        max_depth: { type: "number", description: "Maximum BFS depth (default 5, max 5)." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_graph_invalidate",
    description: "Temporally invalidate an entity (mark as outdated). Invalidated entities still appear in explore but with a warning.",
    inputSchema: {
      type: "object",
      required: ["entity_name", "reason"],
      properties: {
        entity_name: { type: "string", description: "Name of the entity to invalidate." },
        reason: { type: "string", description: "Why it is being invalidated." },
        replaced_by: { type: "string", description: "Name of the replacement entity." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_graph_invalidate_relation",
    description: "Temporally close a relation (fact ended). The relation remains in history but is excluded from active graph.",
    inputSchema: {
      type: "object",
      required: ["relation_id"],
      properties: {
        relation_id: { type: "string", description: "Relation UUID to invalidate." },
        reason: { type: "string", description: "Why this relation is no longer valid." },
        project_root: { type: "string" },
      },
    },
  },
  // Thinking
  {
    name: "memory_start_thinking",
    description: "Start a structured thinking sequence for complex problems.",
    inputSchema: {
      type: "object",
      required: ["goal"],
      properties: {
        goal: { type: "string", description: "Problem or goal to reason about." },
        title: { type: "string", description: "Problem title (deprecated — use goal)." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_add_thought",
    description: "Add a thought to a thinking sequence. Use type 'conclusion' to finalize.",
    inputSchema: {
      type: "object",
      required: ["sequence_id", "thought"],
      properties: {
        sequence_id: { type: "string", description: "Sequence ID." },
        thought: { type: "string", description: "Thought content." },
        content: { type: "string", description: "Thought content (deprecated — use thought)." },
        thought_type: { type: "string", enum: ["observation", "hypothesis", "question", "reasoning", "analysis", "conclusion", "branch", "general"], description: "Thought type (default general)." },
        type: { type: "string", description: "Thought type (deprecated — use thought_type)." },
        branch_name: { type: "string", description: "Branch name (for branch type)." },
        project_root: { type: "string" },
      },
    },
  },
  // Tasks
  {
    name: "memory_tasks",
    description: "Manage tasks: create, complete, or list.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["create", "get", "update", "complete", "delete"], description: "Action." },
        task_id: { type: "string", description: "Task ID (for complete/update/delete)." },
        id: { type: "string", description: "Task ID (deprecated — use task_id)." },
        task_description: { type: "string", description: "Description (for create)." },
        title: { type: "string", description: "Task title." },
        description: { type: "string", description: "Task description (deprecated — use task_description)." },
        status: { type: "string", description: "Task status." },
        priority: { type: "string", description: "Task priority." },
        include_completed: { type: "boolean", description: "Include completed tasks (default false)." },
        project_root: { type: "string" },
      },
    },
  },
  // Sessions
  {
    name: "memory_session_recap",
    description: "Get activity summary for recent days.",
    inputSchema: {
      type: "object",
      properties: {
        days_back: { type: "number", description: "Days to look back (1-30, default 7)." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_get_rules",
    description: "Load behavioral rules for this project.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string" } },
    },
  },
  {
    name: "memory_insights",
    description: "Find knowledge clusters and gaps in your memories.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string" } },
    },
  },
  // Intelligence
  {
    name: "memory_postmortem",
    description: "Create a structured bug postmortem with categorization and root cause analysis.",
    inputSchema: {
      type: "object",
      required: ["title", "bug_category", "description", "root_cause", "fix_description"],
      properties: {
        title: { type: "string", description: "Short description of the bug." },
        bug_category: { type: "string", description: "Bug categorization." },
        description: { type: "string", description: "What happened." },
        root_cause: { type: "string", description: "Why it happened." },
        fix_description: { type: "string", description: "How it was fixed." },
        prevention: { type: "string", description: "How to prevent recurrence." },
        affected_files: { type: "array", items: { type: "string" }, description: "Files involved." },
        warning_pattern: { type: "string", description: "Regex to match similar bugs in future." },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Severity." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_postmortem_warnings",
    description: "Get pre-coding warnings for files you are about to edit.",
    inputSchema: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" }, description: "File paths about to be edited." },
        project_root: { type: "string", description: "Absolute path to project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_pattern_feedback",
    description: "Rate a pattern as success or failure (reinforcement learning).",
    inputSchema: {
      type: "object",
      required: ["pattern_id", "outcome"],
      properties: {
        pattern_id: { type: "string" },
        outcome: { type: "string", enum: ["success", "failure"] },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_code_quality_check",
    description: "Run facade/stub detection on code content. Identifies AI-generated placeholder code.",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", description: "Code content to analyze." },
        code: { type: "string", description: "Code content (deprecated — use content)." },
        language: { type: "string", enum: ["python", "javascript", "typescript", "rust", "go"], description: "Programming language." },
        file_path: { type: "string", description: "File path for context." },
        project_root: { type: "string", description: "Project root path for context-aware rule selection." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  {
    name: "memory_audit_history",
    description: "View change history of a memory.",
    inputSchema: {
      type: "object",
      required: ["memory_id"],
      properties: {
        memory_id: { type: "string" },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "smart_context",
    description: "Single entry point for context retrieval. Auto-detects intent (debug, architecture, refactor, history, search) and fetches relevant memories, rules, postmortem warnings, and graph data in one call.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "What you need context for." },
        project_root: { type: "string", description: "Absolute path to the project root directory." },
        project_id: { type: "string", description: "Stable project identifier." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
        files: { type: "array", items: { type: "string" }, description: "Files about to be edited (for postmortem warnings)." },
        token_budget: { type: "number", description: "Max tokens for response (default 4000)." },
      },
    },
  },
  {
    name: "memory_export_migration",
    description: "Export all memories, entities, relations, tasks, and rules for migration to MEMAXX Cloud. Paginated — use offset/limit for large datasets.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max memories per batch (default 1000)." },
        offset: { type: "number", description: "Pagination offset (default 0)." },
        project_root: { type: "string" },
      },
    },
  },
  // Knowledge Graph — Temporal
  {
    name: "memory_graph_timeline",
    description: "View an entity's full relationship history — facts created and ended over time.",
    inputSchema: {
      type: "object",
      required: ["entity_name"],
      properties: {
        entity_name: { type: "string", description: "Entity name to get timeline for." },
        limit: { type: "number", description: "Max events (1-100, default 50)." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_graph_at_time",
    description: "Query the knowledge graph state at a specific point in time.",
    inputSchema: {
      type: "object",
      required: ["entity_name", "at_time"],
      properties: {
        entity_name: { type: "string", description: "Entity name to query." },
        at_time: { type: "string", description: "ISO timestamp to query at." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_graph_contradictions",
    description: "Detect circular dependencies and conflicting relations in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: { type: "string", description: "Optional entity name to scope the search." },
        project_root: { type: "string" },
      },
    },
  },
  {
    name: "memory_graph_consolidate",
    description: "Find and merge duplicate entities in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        similarity_threshold: { type: "number", description: "Similarity threshold (0.8-1.0, default 0.92)." },
        dry_run: { type: "boolean", description: "Preview only, don't merge (default true)." },
        project_root: { type: "string" },
      },
    },
  },
  // Document Upload
  {
    name: "memory_upload_document",
    description: "Upload and process a document (PDF, Markdown, or plain text) into memory chunks. Max 4MB.",
    inputSchema: {
      type: "object",
      required: ["file_content"],
      properties: {
        file_path: { type: "string", description: "Absolute path to the file." },
        file_content: { type: "string", description: "The file content as string." },
        file_name: { type: "string", description: "File name." },
        tags: { type: "array", items: { type: "string" }, description: "Tags for all chunks." },
        project_root: { type: "string", description: "Project root." },
        git_remote: { type: "string", description: "Git remote URL for cross-machine project identification." },
      },
    },
  },
  // Project Docs
  {
    name: "memory_projects",
    description: "Manage project documentation — create, list, update, get project docs.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list_all", "create", "update", "get"], description: "Action to perform." },
        doc_type: { type: "string", description: "Document type (for create)." },
        content: { type: "string", description: "Document content (for create/update)." },
        title: { type: "string", description: "Document title." },
        doc_id: { type: "string", description: "Document ID (for update/get)." },
        project_root: { type: "string" },
      },
    },
  },
  // Project Links
  {
    name: "memory_project_link",
    description: "Link two projects together as related or dependency.",
    inputSchema: {
      type: "object",
      required: ["target_project_hash", "link_type"],
      properties: {
        target_project_hash: { type: "string", description: "Target project hash to link to." },
        link_type: { type: "string", enum: ["dependency", "related"], description: "Type of link." },
        project_root: { type: "string" },
      },
    },
  },
  // List Projects
  {
    name: "memory_list_projects",
    description: "List all projects with memory counts and activity stats.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string" },
      },
    },
  },
];

// ── Tool Handlers ────────────────────────────────────────────────────

/** DJB2 hash — deterministic, same algorithm as desktop app */
export function djb2Hash(str) {
  const normalized = str.replace(/\\/g, "/").replace(/\/+$/, "");
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

let _projectManifest = null;

export function setProjectId(_root, _id) {
  // No-op — kept for API compatibility with bin.mjs
}

export function setProjectManifest(manifest) {
  _projectManifest = manifest;
}

/**
 * Resolve project hash: explicit project_id > git_remote hash > path hash.
 * No file I/O. Same hash on any machine cloning the same repo.
 */
export function getProjectHash(args) {
  // 1. Explicit override from MCP caller
  if (args?.project_id) return args.project_id;
  // 2. Git remote → deterministic cross-machine hash
  if (args?.git_remote && typeof args.git_remote === "string" && args.git_remote.trim().length > 0) {
    return djb2Hash(args.git_remote.trim());
  }
  // 3. Fallback: path hash
  const root = args?.project_root || process.cwd();
  return djb2Hash(root);
}

/**
 * Handle a tool call. Returns the MCP result content.
 */
export async function handleToolCall(name, args) {
  const ph = getProjectHash(args);

  switch (name) {
    case "memory_init": return handleInit(args, ph);
    case "memory_store": return handleStore(args, ph);
    case "memory_search": return handleSearch(args, ph);
    case "memory_modify": return handleModify(args, ph);
    case "memory_list": return handleList(args, ph);
    case "memory_expand": return handleExpand(args, ph);
    case "memory_export": return handleExport(args, ph);
    case "memory_graph_explore": return handleGraphExplore(args, ph);
    case "memory_graph_stats": return handleGraphStats(args, ph);
    case "memory_graph_path": return handleGraphPath(args, ph);
    case "memory_graph_invalidate": return handleGraphInvalidate(args, ph);
    case "memory_graph_invalidate_relation": return handleGraphInvalidateRelation(args, ph);
    case "memory_start_thinking": return handleStartThinking(args, ph);
    case "memory_add_thought": return handleAddThought(args, ph);
    case "memory_tasks": return handleTasks(args, ph);
    case "memory_session_recap": return handleSessionRecap(args, ph);
    case "memory_get_rules": return handleGetRules(args, ph);
    case "memory_insights": return handleInsights(args, ph);
    case "memory_postmortem": return handlePostmortem(args, ph);
    case "memory_postmortem_warnings": return handlePostmortemWarnings(args, ph);
    case "memory_pattern_feedback": return handlePatternFeedback(args, ph);
    case "memory_code_quality_check": return handleCodeQualityCheck(args, ph);
    case "memory_audit_history": return handleAuditHistory(args, ph);
    case "smart_context": return handleSmartContext(args, ph);
    case "memory_export_migration": return handleExportForMigration(args, ph);
    case "memory_graph_timeline": return handleGraphTimeline(args, ph);
    case "memory_graph_at_time": return handleGraphAtTime(args, ph);
    case "memory_graph_contradictions": return handleGraphContradictions(args, ph);
    case "memory_graph_consolidate": return handleGraphConsolidate(args, ph);
    case "memory_upload_document": return handleUploadDocument(args, ph);
    case "memory_projects": return handleProjects(args, ph);
    case "memory_project_link": return handleProjectLink(args, ph);
    case "memory_list_projects": return handleListProjects(args, ph);
    default: return err(`Unknown tool: ${name}`);
  }
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleInit(args, ph) {
  const daysBack = Math.min(30, Math.max(1, args?.days_back || 7));

  // Register/update project name
  try {
    const projectRoot = args?.project_root || process.cwd();
    const defaultName = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "unnamed";
    const gitRemote = args?.git_remote || null;
    await query(
      `INSERT INTO projects (project_hash, name, git_remote)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_hash) DO UPDATE SET
         git_remote = COALESCE(NULLIF($3, ''), projects.git_remote),
         updated_at = CURRENT_TIMESTAMP`,
      [ph, defaultName, gitRemote]
    );
  } catch { /* projects table may not exist yet */ }

  // Run dream phase on startup (consolidation, archival, pattern promotion)
  const dreamResult = await runDreamPhase(ph);

  const countRes = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = FALSE",
    [ph]
  );
  const memoryCount = countRes.rows[0]?.c || 0;

  const recentActivity = await getRecentActivity(ph, daysBack, 10);
  const taskRes = await query(
    "SELECT * FROM tasks WHERE project_hash = $1 AND status = 'open' ORDER BY created_at DESC",
    [ph]
  );
  const openTasks = taskRes.rows;
  const predictive = await getPredictiveMemories(ph, 5);

  // User-defined rules from DB
  const rulesRes = await query(
    "SELECT * FROM rules WHERE project_hash = $1 AND is_active = TRUE",
    [ph]
  );
  const userRules = rulesRes.rows;

  // Built-in rules (framework-aware) — use manifest from args if provided, fall back to global
  const manifest = args?.manifest || _projectManifest;
  const builtInRules = getBuiltInRules(manifest);

  return ok({
    project: { project_hash: ph, memory_count: memoryCount },
    rules: [...userRules.map(r => r.content), ...builtInRules.map(r => `[${r.severity}] ${r.rule}`)],
    recent_activity: recentActivity,
    open_tasks: openTasks,
    predictive_memories: predictive,
    memory_count: memoryCount,
    mode: "self-hosted",
    dream_phase: dreamResult,
    built_in_rules_count: builtInRules.length,
  });
}

async function handleStore(args, ph) {
  const content = args.content;
  if (!content || content.trim().length < 5) return err("Content too short (min 5 chars).");

  // Quality gate — 5-stage validation
  const qg = qualityGate(content, args.type, args.importance_score);
  if (qg.rejected) return err(`Quality gate: ${qg.reason}`);

  // Content dedup
  const hash = contentHash(content);
  const existingRes = await query(
    "SELECT id FROM memories WHERE project_hash = $1 AND content_hash = $2",
    [ph, hash]
  );
  if (existingRes.rows[0]) return ok({ id: existingRes.rows[0].id, deduplicated: true, message: "Memory already exists." });

  const id = generateId();
  const tags = JSON.stringify(args.tags || []);
  const relatedFiles = JSON.stringify(args.related_files || []);

  const finalType = qg.type;
  const finalImportance = qg.importance;

  await query(`
    INSERT INTO memories (id, project_hash, content, type, importance_score, tags, related_files, session_name, content_hash)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
  `, [
    id, ph, content,
    finalType,
    finalImportance,
    tags, relatedFiles,
    args.session_name || null,
    hash,
  ]);

  // Background: embedding + entity extraction (async, non-blocking)
  processMemoryAsync(id, content, finalType, ph).catch(() => {});

  const result = { id, stored: true };
  if (finalType !== args.type && args.type) result.type_corrected = { from: args.type, to: finalType };
  if (finalImportance !== args.importance_score && args.importance_score != null) result.importance_calibrated = finalImportance;
  if (qg.facade) result.warning = "Content appears to be a placeholder/facade — importance reduced.";
  return ok(result);
}

/** Background processing for a stored memory */
async function processMemoryAsync(id, content, type, ph) {
  // 1. Generate and store embedding
  if (_embeddingConfig) {
    const embedding = await generateEmbedding(content, _embeddingConfig);
    if (embedding) {
      try {
        const vec = formatEmbedding(embedding);
        await query("UPDATE memories SET embedding = $1::vector WHERE id = $2", [vec, id]);
      } catch { /* vec insert error */ }
    }
  }

  // 2. Extract and store entities
  if (_llmConfig) {
    const { entities, relations } = await extractEntities(content, type, _llmConfig);

    for (const ent of entities) {
      const entId = generateId();
      try {
        await query(`
          INSERT INTO entities (id, project_hash, name, type) VALUES ($1, $2, $3, $4)
          ON CONFLICT (project_hash, name, type) DO UPDATE SET updated_at = NOW()
        `, [entId, ph, ent.name, ent.type]);

        // Get the actual entity ID (might be existing)
        const actualRes = await query(
          "SELECT id FROM entities WHERE project_hash = $1 AND name = $2 AND type = $3",
          [ph, ent.name, ent.type]
        );
        const actualEntity = actualRes.rows[0];

        if (actualEntity) {
          try {
            await query(
              "INSERT INTO entity_mentions (memory_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
              [id, actualEntity.id]
            );
          } catch { /* */ }

          // Generate and store entity embedding
          if (_embeddingConfig) {
            const entEmbedding = await generateEmbedding(ent.name, _embeddingConfig);
            if (entEmbedding) {
              try {
                const entVec = formatEmbedding(entEmbedding);
                await query("UPDATE entities SET embedding = $1::vector WHERE id = $2", [entVec, actualEntity.id]);
              } catch { /* */ }
            }
          }
        }
      } catch { /* entity insert error */ }
    }

    for (const rel of relations) {
      try {
        const sourceRes = await query(
          "SELECT id FROM entities WHERE project_hash = $1 AND name = $2",
          [ph, rel.source]
        );
        const targetRes = await query(
          "SELECT id FROM entities WHERE project_hash = $1 AND name = $2",
          [ph, rel.target]
        );
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
}

async function handleSearch(args, ph) {
  if (!args.query) return err("Query is required.");
  const results = await searchMemories({
    query: args.query.slice(0, 500),
    projectHash: ph,
    searchMode: args.search_mode,
    memoryType: args.memory_type,
    filePath: args.file_path,
    limit: Math.min(50, Math.max(1, args.limit || 10)),
    recentOnly: args.recent_only || false,
  }, _embeddingConfig);

  return ok(results);
}

async function handleModify(args, ph) {
  const memoryId = args.memory_id || args.id;
  if (!memoryId) return err("memory_id is required.");

  const memRes = await query("SELECT * FROM memories WHERE id = $1", [memoryId]);
  const mem = memRes.rows[0];
  if (!mem) return err("Memory not found.");

  // Normalize action aliases: inactivate → archive, unarchive → reactivate
  let action = args.action;
  if (action === "inactivate") action = "archive";
  if (action === "unarchive") action = "reactivate";

  switch (action) {
    case "update": {
      const updates = [];
      const params = [];
      let paramIdx = 1;
      if (args.content) { updates.push(`content = $${paramIdx++}`); params.push(args.content); }
      if (args.type) { updates.push(`type = $${paramIdx++}`); params.push(args.type); }
      if (args.importance_score !== undefined) { updates.push(`importance_score = $${paramIdx++}`); params.push(args.importance_score); }
      if (args.tags) { updates.push(`tags = $${paramIdx++}::jsonb`); params.push(JSON.stringify(args.tags)); }
      if (args.related_files) { updates.push(`related_files = $${paramIdx++}::jsonb`); params.push(JSON.stringify(args.related_files)); }
      updates.push("updated_at = NOW()");
      params.push(memoryId);
      await query(`UPDATE memories SET ${updates.join(", ")} WHERE id = $${paramIdx}`, params);
      return ok({ updated: true, memory_id: memoryId });
    }
    case "archive":
      await query("UPDATE memories SET is_archived = TRUE, updated_at = NOW() WHERE id = $1", [memoryId]);
      return ok({ archived: true, memory_id: memoryId, reason: args.reason || null });
    case "reactivate":
      await query("UPDATE memories SET is_archived = FALSE, updated_at = NOW() WHERE id = $1", [memoryId]);
      return ok({ reactivated: true, memory_id: memoryId });
    case "delete":
      await query("DELETE FROM memories WHERE id = $1", [memoryId]);
      return ok({ deleted: true, memory_id: memoryId });
    default:
      return err(`Unknown action: ${args.action}`);
  }
}

async function handleList(args, ph) {
  const archived = args?.include_archived ? "" : "AND is_archived = FALSE";
  const res = await query(`
    SELECT id, type, importance_score, tags, created_at, LEFT(content, 200) as content_preview
    FROM memories WHERE project_hash = $1 ${archived}
    ORDER BY created_at DESC LIMIT 200
  `, [ph]);

  // Group by type
  const grouped = {};
  for (const r of res.rows) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push({ ...r, tags: safeParseJsonb(r.tags, []) });
  }

  return ok({ memories: grouped, total: res.rows.length });
}

async function handleExpand(args, ph) {
  const ids = args.memory_ids || args.ids || [];
  if (ids.length === 0) return err("No IDs provided.");

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const res = await query(
    `SELECT * FROM memories WHERE id IN (${placeholders})`,
    ids
  );

  return ok({
    memories: res.rows.map(r => ({
      ...r,
      tags: safeParseJsonb(r.tags, []),
      related_files: safeParseJsonb(r.related_files, []),
    })),
  });
}

async function handleExport(args, ph) {
  const res = await query(
    "SELECT * FROM memories WHERE project_hash = $1 ORDER BY created_at DESC",
    [ph]
  );
  return ok({ memories: res.rows, count: res.rows.length });
}

// ── Knowledge Graph ──────────────────────────────────────────────────

async function handleGraphExplore(args, ph) {
  const depth = Math.min(5, Math.max(1, args.depth || 2));
  const entityName = args.query || args.entity_name;
  if (!entityName) return err("query (entity name) is required.");

  // Find root entity
  const rootRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2) AND is_valid = TRUE",
    [ph, entityName]
  );
  const root = rootRes.rows[0];

  if (!root) return ok({ entity: null, message: `Entity "${entityName}" not found.` });

  // BFS traversal
  const visited = new Set([root.id]);
  const nodes = [{ ...root, depth: 0 }];
  const edges = [];
  let frontier = [root.id];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const nextFrontier = [];
    const placeholders = frontier.map((_, i) => `$${i + 1}`).join(",");
    const placeholders2 = frontier.map((_, i) => `$${i + 1 + frontier.length}`).join(",");

    const relsRes = await query(`
      SELECT r.*, e1.name as source_name, e2.name as target_name
      FROM relations r
      JOIN entities e1 ON r.source_id = e1.id
      JOIN entities e2 ON r.target_id = e2.id
      WHERE r.is_valid = TRUE AND (r.source_id IN (${placeholders}) OR r.target_id IN (${placeholders2}))
    `, [...frontier, ...frontier]);

    for (const rel of relsRes.rows) {
      edges.push(rel);
      for (const neighborId of [rel.source_id, rel.target_id]) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const entityRes = await query("SELECT * FROM entities WHERE id = $1", [neighborId]);
          const entity = entityRes.rows[0];
          if (entity) {
            nodes.push({ ...entity, depth: d + 1 });
            nextFrontier.push(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return ok({ root, nodes, edges, depth });
}

async function handleGraphStats(args, ph) {
  const entityCountRes = await query(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
    [ph]
  );
  const entityCount = entityCountRes.rows[0]?.c || 0;

  const relationCountRes = await query(
    "SELECT COUNT(*) as c FROM relations WHERE project_hash = $1 AND is_valid = TRUE",
    [ph]
  );
  const relationCount = relationCountRes.rows[0]?.c || 0;

  const topEntitiesRes = await query(`
    SELECT e.name, e.type, COUNT(r.id) as connection_count
    FROM entities e
    LEFT JOIN relations r ON e.id = r.source_id OR e.id = r.target_id
    WHERE e.project_hash = $1 AND e.is_valid = TRUE
    GROUP BY e.id, e.name, e.type
    ORDER BY connection_count DESC
    LIMIT 10
  `, [ph]);

  const typeDistributionRes = await query(`
    SELECT type, COUNT(*) as count FROM entities
    WHERE project_hash = $1 AND is_valid = TRUE
    GROUP BY type ORDER BY count DESC
  `, [ph]);

  return ok({
    entity_count: entityCount,
    relation_count: relationCount,
    top_entities: topEntitiesRes.rows,
    type_distribution: typeDistributionRes.rows,
  });
}

async function handleGraphPath(args, ph) {
  const sourceName = args.source_entity || args.from;
  const targetName = args.target_entity || args.to;
  if (!sourceName || !targetName) return err("source_entity and target_entity are required.");

  const fromRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
    [ph, sourceName]
  );
  const toRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
    [ph, targetName]
  );
  const from = fromRes.rows[0];
  const to = toRes.rows[0];
  if (!from || !to) return ok({ path: null, message: "One or both entities not found." });

  // BFS shortest path
  const bfsQueue = [[from.id]];
  const visited = new Set([from.id]);

  while (bfsQueue.length > 0) {
    const path = bfsQueue.shift();
    const current = path[path.length - 1];
    if (current === to.id) {
      // Resolve entity objects for the path
      const entities = [];
      for (const eid of path) {
        const eRes = await query("SELECT * FROM entities WHERE id = $1", [eid]);
        if (eRes.rows[0]) entities.push(eRes.rows[0]);
      }
      return ok({ path: entities, length: path.length - 1 });
    }

    const neighborsRes = await query(`
      SELECT CASE WHEN source_id = $1 THEN target_id ELSE source_id END as neighbor_id, relation
      FROM relations WHERE (source_id = $1 OR target_id = $1) AND is_valid = TRUE
    `, [current]);

    for (const n of neighborsRes.rows) {
      if (!visited.has(n.neighbor_id)) {
        visited.add(n.neighbor_id);
        bfsQueue.push([...path, n.neighbor_id]);
      }
    }

    if (visited.size > 100) break; // Safety limit
  }

  return ok({ path: null, message: "No path found." });
}

async function handleGraphInvalidate(args, ph) {
  await query(
    "UPDATE entities SET is_valid = FALSE, updated_at = NOW() WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
    [ph, args.entity_name]
  );
  return ok({ invalidated: true });
}

async function handleGraphInvalidateRelation(args, ph) {
  await query(
    "UPDATE relations SET is_valid = FALSE, valid_to = NOW() WHERE id = $1",
    [args.relation_id]
  );
  return ok({ invalidated: true });
}

// ── Thinking ─────────────────────────────────────────────────────────

async function handleStartThinking(args, ph) {
  const id = generateId();
  const goal = args.goal || args.title;
  if (!goal) return err("goal is required.");
  await query(
    "INSERT INTO thinking_sequences (id, project_hash, title) VALUES ($1, $2, $3)",
    [id, ph, goal]
  );
  return ok({ sequence_id: id, goal, title: goal, status: "active" });
}

async function handleAddThought(args, ph) {
  const seqRes = await query("SELECT * FROM thinking_sequences WHERE id = $1", [args.sequence_id]);
  const seq = seqRes.rows[0];
  if (!seq) return err("Thinking sequence not found.");

  const thought = args.thought || args.content;
  if (!thought) return err("thought is required.");

  const id = generateId();
  const thoughtType = args.thought_type || args.type || "general";
  await query(
    "INSERT INTO thinking_thoughts (id, sequence_id, type, content) VALUES ($1, $2, $3, $4)",
    [id, args.sequence_id, thoughtType, thought]
  );

  if (thoughtType === "conclusion") {
    await query(
      "UPDATE thinking_sequences SET status = 'completed', updated_at = NOW() WHERE id = $1",
      [args.sequence_id]
    );
  }

  return ok({ thought_id: id, thought_type: thoughtType, type: thoughtType, sequence_status: thoughtType === "conclusion" ? "completed" : "active" });
}

// ── Tasks ────────────────────────────────────────────────────────────

async function handleTasks(args, ph) {
  const taskId = args.task_id || args.id;
  const taskDescription = args.task_description || args.description;

  switch (args.action) {
    case "create": {
      const id = generateId();
      await query(
        "INSERT INTO tasks (id, project_hash, title, description, priority) VALUES ($1, $2, $3, $4, $5)",
        [id, ph, args.title || taskDescription || "Untitled", taskDescription || null, args.priority || "medium"]
      );
      return ok({ id, task_id: id, created: true });
    }
    case "get": {
      const includeCompleted = args.include_completed !== false;
      const statusFilter = includeCompleted ? "" : "AND status != 'completed'";
      const tasksRes = await query(
        `SELECT * FROM tasks WHERE project_hash = $1 ${statusFilter} ORDER BY status ASC, created_at DESC`,
        [ph]
      );
      return ok({ tasks: tasksRes.rows });
    }
    case "update": {
      if (!taskId) return err("task_id is required.");
      const updates = [];
      const params = [];
      let paramIdx = 1;
      if (args.title) { updates.push(`title = $${paramIdx++}`); params.push(args.title); }
      if (taskDescription) { updates.push(`description = $${paramIdx++}`); params.push(taskDescription); }
      if (args.status) { updates.push(`status = $${paramIdx++}`); params.push(args.status); }
      if (args.priority) { updates.push(`priority = $${paramIdx++}`); params.push(args.priority); }
      updates.push("updated_at = NOW()");
      params.push(taskId);
      await query(`UPDATE tasks SET ${updates.join(", ")} WHERE id = $${paramIdx}`, params);
      return ok({ updated: true, task_id: taskId });
    }
    case "complete": {
      if (!taskId) return err("task_id is required.");
      await query(
        "UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
        [taskId]
      );
      return ok({ completed: true, task_id: taskId });
    }
    case "delete": {
      if (!taskId) return err("task_id is required.");
      await query("DELETE FROM tasks WHERE id = $1", [taskId]);
      return ok({ deleted: true, task_id: taskId });
    }
    default:
      return err(`Unknown task action: ${args.action}`);
  }
}

// ── Sessions / Rules / Insights ──────────────────────────────────────

async function handleSessionRecap(args, ph) {
  const daysBack = Math.min(30, Math.max(1, args?.days_back || 7));
  const activity = await getRecentActivity(ph, daysBack, 50);

  const typeBreakdown = {};
  for (const m of activity) {
    typeBreakdown[m.type] = (typeBreakdown[m.type] || 0) + 1;
  }

  return ok({ activity, type_breakdown: typeBreakdown, days_back: daysBack, count: activity.length });
}

async function handleGetRules(args, ph) {
  const rulesRes = await query(
    "SELECT * FROM rules WHERE project_hash = $1 AND is_active = TRUE",
    [ph]
  );
  const userRules = rulesRes.rows;
  const builtInRules = getBuiltInRules(_projectManifest);
  return ok({
    rules: userRules,
    built_in_rules: builtInRules,
    total: userRules.length + builtInRules.length,
  });
}

async function handleInsights(args, ph) {
  const totalMemoriesRes = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = FALSE",
    [ph]
  );
  const totalMemories = totalMemoriesRes.rows[0]?.c || 0;

  const totalEntitiesRes = await query(
    "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
    [ph]
  );
  const totalEntities = totalEntitiesRes.rows[0]?.c || 0;

  const totalTasksRes = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1",
    [ph]
  );
  const totalTasks = totalTasksRes.rows[0]?.c || 0;

  const openTasksRes = await query(
    "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1 AND status = 'open'",
    [ph]
  );
  const openTasks = openTasksRes.rows[0]?.c || 0;

  const typeBreakdownRes = await query(`
    SELECT type, COUNT(*) as count, AVG(importance_score) as avg_importance
    FROM memories WHERE project_hash = $1 AND is_archived = FALSE
    GROUP BY type ORDER BY count DESC
  `, [ph]);

  const recentBugsRes = await query(`
    SELECT * FROM postmortems WHERE project_hash = $1
    ORDER BY created_at DESC LIMIT 5
  `, [ph]);

  return ok({
    total_memories: totalMemories,
    total_entities: totalEntities,
    total_tasks: totalTasks,
    open_tasks: openTasks,
    type_breakdown: typeBreakdownRes.rows,
    recent_postmortems: recentBugsRes.rows,
  });
}

// ── Postmortems ──────────────────────────────────────────────────────

async function handlePostmortem(args, ph) {
  const id = generateId();

  await query(`
    INSERT INTO postmortems (id, project_hash, title, bug_category, description, root_cause, fix_description, prevention, affected_files, warning_pattern, severity)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
  `, [
    id, ph, args.title, args.bug_category, args.description,
    args.root_cause, args.fix_description, args.prevention || null,
    JSON.stringify(args.affected_files || []), args.warning_pattern || null,
    args.severity || "medium"
  ]);

  // Create/update pattern from warning_pattern
  if (args.warning_pattern) {
    const patId = generateId();
    await query(`
      INSERT INTO patterns (id, project_hash, pattern, description, category)
      VALUES ($1, $2, $3, $4, $5)
    `, [patId, ph, args.warning_pattern, `From postmortem: ${args.title}`, args.bug_category || "general"]);
  }

  return ok({ id, recorded: true });
}

async function handlePostmortemWarnings(args, ph) {
  const files = args.files || [];
  if (files.length === 0) return ok({ warnings: [] });

  const warnings = [];

  for (const file of files) {
    // Check postmortems with matching files — affected_files is JSONB
    const postmortemsRes = await query(`
      SELECT * FROM postmortems WHERE project_hash = $1 AND affected_files::text ILIKE $2
      ORDER BY created_at DESC LIMIT 5
    `, [ph, `%${file}%`]);

    for (const pm of postmortemsRes.rows) {
      warnings.push({
        type: "postmortem",
        file,
        title: pm.title,
        severity: pm.severity,
        root_cause: pm.root_cause,
        prevention: pm.prevention,
        warning_pattern: pm.warning_pattern,
      });
    }

    // Check active patterns
    const patternsRes = await query(`
      SELECT * FROM patterns WHERE project_hash = $1 AND status != 'deprecated' AND confidence > 0.3
    `, [ph]);

    for (const pat of patternsRes.rows) {
      if (pat.pattern) {
        try {
          const regex = new RegExp(pat.pattern, "i");
          if (regex.test(file)) {
            warnings.push({
              type: "pattern",
              file,
              pattern_id: pat.id,
              pattern: pat.pattern,
              description: pat.description,
              confidence: pat.confidence,
            });
          }
        } catch { /* invalid regex */ }
      }
    }
  }

  return ok({ warnings, count: warnings.length });
}

async function handlePatternFeedback(args, ph) {
  const patternRes = await query("SELECT * FROM patterns WHERE id = $1", [args.pattern_id]);
  const pattern = patternRes.rows[0];
  if (!pattern) return err("Pattern not found.");

  const delta = args.outcome === "success" ? 0.05 : -0.10;
  const newConfidence = Math.max(0, Math.min(1, pattern.confidence + delta));
  const field = args.outcome === "success" ? "success_count" : "failure_count";

  await query(`
    UPDATE patterns SET confidence = $1, ${field} = ${field} + 1, applied_count = applied_count + 1,
    status = CASE
      WHEN $1 >= 0.85 AND applied_count >= 5 THEN 'promoted'
      WHEN $1 < 0.15 THEN 'deprecated'
      WHEN $1 >= 0.6 THEN 'active'
      ELSE status
    END,
    updated_at = NOW()
    WHERE id = $2
  `, [newConfidence, args.pattern_id]);

  return ok({ pattern_id: args.pattern_id, new_confidence: newConfidence, outcome: args.outcome });
}

// ── Code Quality Check ───────────────────────────────────────────────

function handleCodeQualityCheck(args, ph) {
  const code = args.content || args.code || "";
  const issues = [];

  // Placeholder detection
  const placeholderPatterns = [
    { pattern: /\/\/\s*TODO/gi, message: "TODO comment found" },
    { pattern: /\/\/\s*FIXME/gi, message: "FIXME comment found" },
    { pattern: /\/\/\s*HACK/gi, message: "HACK comment found" },
    { pattern: /throw new Error\(["']not implemented["']\)/gi, message: "Not implemented placeholder" },
    { pattern: /console\.log\(/g, message: "console.log statement (debug leftover?)" },
    { pattern: /pass\s*$/gm, message: "Empty pass statement (Python placeholder)" },
    { pattern: /\.\.\.(\s*\/\/)?/g, message: "Spread/ellipsis placeholder" },
  ];

  for (const { pattern, message } of placeholderPatterns) {
    const matches = code.match(pattern);
    if (matches) {
      issues.push({ type: "placeholder", message, count: matches.length });
    }
  }

  return ok({ issues, file: args.file_path || null, quality_score: issues.length === 0 ? 1.0 : Math.max(0, 1 - issues.length * 0.15) });
}

// ── Audit History ────────────────────────────────────────────────────

async function handleAuditHistory(args, ph) {
  const memoryRes = await query("SELECT * FROM memories WHERE id = $1", [args.memory_id]);
  const memory = memoryRes.rows[0];
  if (!memory) return err("Memory not found.");

  const accessRes = await query(
    "SELECT * FROM access_log WHERE memory_id = $1 ORDER BY created_at DESC LIMIT 20",
    [args.memory_id]
  );

  return ok({
    memory: { ...memory, tags: safeParseJsonb(memory.tags, []), related_files: safeParseJsonb(memory.related_files, []) },
    access_history: accessRes.rows,
    total_retrievals: memory.retrieval_count,
  });
}

// ── Smart Context ────────────────────────────────────────────────────

async function handleSmartContext(args, ph) {
  const q = args.query || "";
  const files = args.files || [];
  const tokenBudget = args.token_budget || 4000;

  // Detect intent
  const intent = detectIntent(q);

  // Parallel fetch
  const [searchResult, warnings, rules] = await Promise.all([
    searchMemories({ query: q, projectHash: ph, limit: 15 }, _embeddingConfig),
    files.length > 0 ? handlePostmortemWarnings({ files }, ph) : Promise.resolve({ content: [{ text: JSON.stringify({ warnings: [] }) }] }),
    Promise.resolve(await handleGetRules({}, ph)),
  ]);

  // Graph top entities
  const topEntitiesRes = await query(`
    SELECT e.name, e.type, COUNT(r.id) as connections
    FROM entities e
    LEFT JOIN relations r ON e.id = r.source_id OR e.id = r.target_id
    WHERE e.project_hash = $1 AND e.is_valid = TRUE
    GROUP BY e.id, e.name, e.type ORDER BY connections DESC LIMIT 5
  `, [ph]);

  const parsedRules = safeParseJson(rules.content[0].text, {});
  const parsedWarnings = safeParseJson(warnings.content[0].text, {});

  // Apply context budget compression
  const compressed = compressToTokenBudget({
    memories: searchResult.results || [],
    rules: parsedRules.built_in_rules || [],
    warnings: parsedWarnings.warnings || [],
    entities: topEntitiesRes.rows,
  }, tokenBudget);

  return ok({
    intent,
    ...compressed,
    token_budget: tokenBudget,
    tokens_used: compressed._tokensUsed,
  });
}

function detectIntent(q) {
  const lower = q.toLowerCase();
  if (/bug|fix|error|crash|fail|broken|issue|debug/.test(lower)) return "debug";
  if (/architect|design|structur|pattern|approach/.test(lower)) return "architecture";
  if (/refactor|clean|simplif|extract|split/.test(lower)) return "refactor";
  if (/histor|when|change|previous|before/.test(lower)) return "history";
  return "search";
}

// ── Knowledge Graph — Temporal ────────────────────────────────────────

async function handleGraphTimeline(args, ph) {
  const limit = Math.min(100, Math.max(1, args.limit || 50));

  // Find the entity
  const entityRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
    [ph, args.entity_name]
  );
  const entity = entityRes.rows[0];

  if (!entity) return ok({ timeline: [], count: 0, message: `Entity "${args.entity_name}" not found.` });

  // Get all relations involving this entity (both as source and target)
  const relationsRes = await query(`
    SELECT r.*, e1.name as source_name, e2.name as target_name
    FROM relations r
    JOIN entities e1 ON r.source_id = e1.id
    JOIN entities e2 ON r.target_id = e2.id
    WHERE r.project_hash = $1 AND (r.source_id = $2 OR r.target_id = $2)
    ORDER BY r.created_at DESC
  `, [ph, entity.id]);

  // Build timeline events
  const events = [];
  for (const rel of relationsRes.rows) {
    events.push({
      event_type: "relation_created",
      event_time: rel.valid_from || rel.created_at,
      relation_id: rel.id,
      relation: rel.relation,
      source_name: rel.source_name,
      target_name: rel.target_name,
      confidence: rel.confidence,
      is_valid: rel.is_valid,
    });

    if (rel.valid_to) {
      events.push({
        event_type: "relation_ended",
        event_time: rel.valid_to,
        relation_id: rel.id,
        relation: rel.relation,
        source_name: rel.source_name,
        target_name: rel.target_name,
        confidence: rel.confidence,
        is_valid: rel.is_valid,
      });
    }
  }

  // Sort by event_time descending
  events.sort((a, b) => (b.event_time || "").localeCompare(a.event_time || ""));

  const limited = events.slice(0, limit);
  return ok({ entity: entity.name, timeline: limited, count: limited.length });
}

async function handleGraphAtTime(args, ph) {
  if (!args.entity_name || !args.at_time) return err("entity_name and at_time are required.");

  // Find the entity
  const entityRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
    [ph, args.entity_name]
  );
  const entity = entityRes.rows[0];

  if (!entity) return ok({ relations: [], count: 0, message: `Entity "${args.entity_name}" not found.` });

  // Query relations active at the specified time
  const relationsRes = await query(`
    SELECT r.*, e1.name as source_name, e2.name as target_name
    FROM relations r
    JOIN entities e1 ON r.source_id = e1.id
    JOIN entities e2 ON r.target_id = e2.id
    WHERE r.project_hash = $1
      AND (r.source_id = $2 OR r.target_id = $2)
      AND r.valid_from <= $3
      AND (r.valid_to IS NULL OR r.valid_to > $3)
  `, [ph, entity.id, args.at_time]);

  return ok({
    entity: entity.name,
    at_time: args.at_time,
    relations: relationsRes.rows.map(r => ({
      relation_id: r.id,
      relation: r.relation,
      source_name: r.source_name,
      target_name: r.target_name,
      confidence: r.confidence,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
    })),
    count: relationsRes.rows.length,
  });
}

async function handleGraphContradictions(args, ph) {
  // Scope filter
  let entityFilter = "";
  const params = [ph];
  if (args.entity_name) {
    const entityRes = await query(
      "SELECT id FROM entities WHERE project_hash = $1 AND LOWER(name) = LOWER($2)",
      [ph, args.entity_name]
    );
    const entity = entityRes.rows[0];
    if (entity) {
      entityFilter = " AND (r1.source_id = $4 OR r1.target_id = $4)";
      params.push(entity.id);
    }
  }

  // Case 1: Circular — A→B and B→A with same directional relation type
  const circularTypes = ["depends_on", "extends", "imports"];

  // Build the query with numbered params for circular types
  // params so far: [ph] or [ph, entityId]
  // We need to add circularTypes as params
  const baseParamCount = params.length;
  const typePlaceholders = circularTypes.map((_, i) => `$${baseParamCount + i + 1}`).join(",");
  const circularParams = [...params, ...circularTypes];

  // Adjust entityFilter param numbers if entity was found
  let adjustedEntityFilter = entityFilter;
  if (args.entity_name && params.length > 1) {
    // entityId is at params[1], but after adding circularTypes it needs to be re-indexed
    // Actually let's restructure: put ph first, then circularTypes, then entityId
    const circParams = [ph, ...circularTypes];
    const typeP = circularTypes.map((_, i) => `$${i + 2}`).join(",");
    let entFilter = "";
    if (params.length > 1) {
      circParams.push(params[1]); // entityId
      const entIdx = circParams.length;
      entFilter = ` AND (r1.source_id = $${entIdx} OR r1.target_id = $${entIdx})`;
    }

    const circularRes = await query(`
      SELECT r1.id as relation1_id, r2.id as relation2_id,
             e1.name as entity_a, e2.name as entity_b,
             r1.relation as relation_type
      FROM relations r1
      JOIN relations r2 ON r1.source_id = r2.target_id AND r1.target_id = r2.source_id AND r1.relation = r2.relation
      JOIN entities e1 ON r1.source_id = e1.id
      JOIN entities e2 ON r1.target_id = e2.id
      WHERE r1.project_hash = $1 AND r1.is_valid = TRUE AND r2.is_valid = TRUE
        AND r1.relation IN (${typeP})
        AND r1.id < r2.id
        ${entFilter}
    `, circParams);

    // Case 2: Conflicting — same entity pair with logically conflicting relation types
    const conflictingPairs = [
      ["replaces", "depends_on"],
      ["replaces", "extends"],
    ];

    const conflicting = [];
    for (const [typeA, typeB] of conflictingPairs) {
      const conflictsRes = await query(`
        SELECT r1.id as relation1_id, r2.id as relation2_id,
               e1.name as source_name, e2.name as target_name,
               r1.relation as relation1_type, r2.relation as relation2_type
        FROM relations r1
        JOIN relations r2 ON r1.source_id = r2.source_id AND r1.target_id = r2.target_id
        JOIN entities e1 ON r1.source_id = e1.id
        JOIN entities e2 ON r1.target_id = e2.id
        WHERE r1.project_hash = $1 AND r1.is_valid = TRUE AND r2.is_valid = TRUE
          AND r1.relation = $2 AND r2.relation = $3
          AND r1.id != r2.id
      `, [ph, typeA, typeB]);

      conflicting.push(...conflictsRes.rows);
    }

    return ok({
      circular: circularRes.rows,
      conflicting,
      circular_count: circularRes.rows.length,
      conflicting_count: conflicting.length,
    });
  }

  // No entity filter case — simpler
  const typeP2 = circularTypes.map((_, i) => `$${i + 2}`).join(",");
  const circularRes = await query(`
    SELECT r1.id as relation1_id, r2.id as relation2_id,
           e1.name as entity_a, e2.name as entity_b,
           r1.relation as relation_type
    FROM relations r1
    JOIN relations r2 ON r1.source_id = r2.target_id AND r1.target_id = r2.source_id AND r1.relation = r2.relation
    JOIN entities e1 ON r1.source_id = e1.id
    JOIN entities e2 ON r1.target_id = e2.id
    WHERE r1.project_hash = $1 AND r1.is_valid = TRUE AND r2.is_valid = TRUE
      AND r1.relation IN (${typeP2})
      AND r1.id < r2.id
  `, [ph, ...circularTypes]);

  const conflictingPairs = [
    ["replaces", "depends_on"],
    ["replaces", "extends"],
  ];

  const conflicting = [];
  for (const [typeA, typeB] of conflictingPairs) {
    const conflictsRes = await query(`
      SELECT r1.id as relation1_id, r2.id as relation2_id,
             e1.name as source_name, e2.name as target_name,
             r1.relation as relation1_type, r2.relation as relation2_type
      FROM relations r1
      JOIN relations r2 ON r1.source_id = r2.source_id AND r1.target_id = r2.target_id
      JOIN entities e1 ON r1.source_id = e1.id
      JOIN entities e2 ON r1.target_id = e2.id
      WHERE r1.project_hash = $1 AND r1.is_valid = TRUE AND r2.is_valid = TRUE
        AND r1.relation = $2 AND r2.relation = $3
        AND r1.id != r2.id
    `, [ph, typeA, typeB]);

    conflicting.push(...conflictsRes.rows);
  }

  return ok({
    circular: circularRes.rows,
    conflicting,
    circular_count: circularRes.rows.length,
    conflicting_count: conflicting.length,
  });
}

async function handleGraphConsolidate(args, ph) {
  const threshold = Math.min(1.0, Math.max(0.8, args.similarity_threshold ?? 0.92));
  const dryRun = args.dry_run !== false;

  // Find entities grouped by type
  const entitiesRes = await query(
    "SELECT * FROM entities WHERE project_hash = $1 AND is_valid = TRUE ORDER BY type, name",
    [ph]
  );

  // Group by type for comparison
  const byType = {};
  for (const e of entitiesRes.rows) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const candidates = [];

  for (const [type, group] of Object.entries(byType)) {
    if (group.length < 2) continue;

    // Try embedding-based similarity first
    let embeddings = null;
    try {
      const ids = group.map(e => e.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      const vecRes = await query(
        `SELECT id, embedding FROM entities WHERE id IN (${placeholders}) AND embedding IS NOT NULL`,
        ids
      );
      if (vecRes.rows.length > 0) {
        embeddings = new Map();
        for (const row of vecRes.rows) {
          // pgvector returns string like '[0.1,0.2,...]' — parse to Float32Array
          if (row.embedding) {
            const arr = typeof row.embedding === "string"
              ? JSON.parse(row.embedding)
              : row.embedding;
            embeddings.set(row.id, new Float32Array(arr));
          }
        }
      }
    } catch { /* entities may not have embeddings */ }

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        let similarity = 0;

        // Check embedding similarity if available
        if (embeddings && embeddings.has(a.id) && embeddings.has(b.id)) {
          similarity = cosineSimilarity(embeddings.get(a.id), embeddings.get(b.id));
        } else {
          // Fallback: name similarity (normalized Levenshtein-like)
          const nameA = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const nameB = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (nameA === nameB) {
            similarity = 1.0;
          } else if (nameA.includes(nameB) || nameB.includes(nameA)) {
            similarity = Math.min(nameA.length, nameB.length) / Math.max(nameA.length, nameB.length);
          } else {
            continue; // skip dissimilar names without embeddings
          }
        }

        if (similarity >= threshold) {
          candidates.push({
            entity_a: { id: a.id, name: a.name, type: a.type },
            entity_b: { id: b.id, name: b.name, type: b.type },
            similarity: Math.round(similarity * 1000) / 1000,
          });
        }
      }
    }
  }

  if (!dryRun && candidates.length > 0) {
    // Merge: keep first (winner), re-point from second (loser)
    let merged = 0;
    for (const pair of candidates) {
      const winnerId = pair.entity_a.id;
      const loserId = pair.entity_b.id;

      // Re-point relations from loser to winner
      await query("UPDATE relations SET source_id = $1 WHERE source_id = $2", [winnerId, loserId]);
      await query("UPDATE relations SET target_id = $1 WHERE target_id = $2", [winnerId, loserId]);

      // Re-point entity mentions from loser to winner
      await query(
        "INSERT INTO entity_mentions (memory_id, entity_id) SELECT memory_id, $1 FROM entity_mentions WHERE entity_id = $2 ON CONFLICT DO NOTHING",
        [winnerId, loserId]
      );
      await query("DELETE FROM entity_mentions WHERE entity_id = $1", [loserId]);

      // Invalidate loser entity
      await query("UPDATE entities SET is_valid = FALSE, updated_at = NOW() WHERE id = $1", [loserId]);
      merged++;
    }

    return ok({ duplicates: candidates, count: candidates.length, dry_run: false, merged });
  }

  return ok({ duplicates: candidates, count: candidates.length, dry_run: dryRun });
}

// ── Document Upload ──────────────────────────────────────────────────

async function handleUploadDocument(args, ph) {
  const content = args.file_content || "";
  const fileName = args.file_name || "document";
  const tags = args.tags || [];

  if (!content.trim()) return err("file_content is required and cannot be empty.");

  // Max 4MB
  const sizeBytes = new TextEncoder().encode(content).length;
  if (sizeBytes > 4 * 1024 * 1024) {
    return err(`File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Max: 4MB.`);
  }

  // Create upload record
  const uploadId = generateId();
  await query(`
    INSERT INTO document_uploads (id, project_hash, file_name, file_type, file_size, status)
    VALUES ($1, $2, $3, 'text', $4, 'processing')
  `, [uploadId, ph, fileName, sizeBytes]);

  // Chunk content: split on double newlines, max 2000 chars per chunk
  const chunks = chunkContent(content);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = generateId();
      const chunkTags = [...tags, `doc:${fileName}`, `chunk:${i + 1}/${chunks.length}`];
      const hash = contentHash(chunks[i]);

      await query(`
        INSERT INTO memories (id, project_hash, content, type, importance_score, tags, related_files, session_name, content_hash)
        VALUES ($1, $2, $3, 'document-chunk', 0.4, $4::jsonb, '[]'::jsonb, $5, $6)
      `, [
        chunkId, ph, chunks[i], JSON.stringify(chunkTags),
        `upload:${uploadId}`, hash
      ]);

      // Generate embedding for the chunk
      if (_embeddingConfig) {
        const embedding = await generateEmbedding(chunks[i], _embeddingConfig);
        if (embedding) {
          try {
            const vec = formatEmbedding(embedding);
            await query("UPDATE memories SET embedding = $1::vector WHERE id = $2", [vec, chunkId]);
          } catch { /* vec insert error */ }
        }
      }
    }

    // Update upload record
    await query(
      "UPDATE document_uploads SET status = 'completed', chunk_count = $1 WHERE id = $2",
      [chunks.length, uploadId]
    );

    return ok({ upload_id: uploadId, chunk_count: chunks.length, file_name: fileName, file_size: sizeBytes, status: "completed" });
  } catch (e) {
    await query(
      "UPDATE document_uploads SET status = 'failed', error_message = $1 WHERE id = $2",
      [e.message, uploadId]
    );
    return err(`Document upload failed: ${e.message}`);
  }
}

function chunkContent(content) {
  const MAX_CHUNK_SIZE = 2000;
  const paragraphs = content.split(/\n\n+/);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0) chunks.push(content.trim());
  return chunks;
}

// ── Project Docs ─────────────────────────────────────────────────────

async function handleProjects(args, ph) {
  const action = args.action;

  switch (action) {
    case "list_all": {
      const docsRes = await query(
        "SELECT id, project_hash, doc_type, title, version, created_at, updated_at FROM project_docs WHERE project_hash = $1 ORDER BY updated_at DESC",
        [ph]
      );
      return ok({ docs: docsRes.rows });
    }
    case "create": {
      if (!args.doc_type || !args.content) return err("doc_type and content are required.");
      const id = generateId();
      const title = args.title || `${args.doc_type} - ${ph}`;
      await query(
        "INSERT INTO project_docs (id, project_hash, doc_type, title, content) VALUES ($1, $2, $3, $4, $5)",
        [id, ph, args.doc_type, title, args.content]
      );
      return ok({ id, doc_type: args.doc_type, title, version: 1, created_at: new Date().toISOString() });
    }
    case "update": {
      if (!args.doc_id || !args.content) return err("doc_id and content are required.");
      const existingRes = await query(
        "SELECT * FROM project_docs WHERE id = $1 AND project_hash = $2",
        [args.doc_id, ph]
      );
      if (!existingRes.rows[0]) return err("Document not found.");
      await query(
        "UPDATE project_docs SET content = $1, updated_at = NOW(), version = version + 1 WHERE id = $2",
        [args.content, args.doc_id]
      );
      const updatedRes = await query(
        "SELECT id, doc_type, title, version, updated_at FROM project_docs WHERE id = $1",
        [args.doc_id]
      );
      return ok(updatedRes.rows[0]);
    }
    case "get": {
      if (!args.doc_id) return err("doc_id is required.");
      const docRes = await query(
        "SELECT * FROM project_docs WHERE id = $1 AND project_hash = $2",
        [args.doc_id, ph]
      );
      if (!docRes.rows[0]) return err("Document not found.");
      return ok(docRes.rows[0]);
    }
    default:
      return err(`Unknown action: ${action}`);
  }
}

// ── Project Links ────────────────────────────────────────────────────

async function handleProjectLink(args, ph) {
  if (!args.target_project_hash || !args.link_type) return err("target_project_hash and link_type are required.");

  const id = generateId();
  try {
    await query(`
      INSERT INTO project_links (id, source_project_hash, target_project_hash, link_type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(source_project_hash, target_project_hash) DO UPDATE SET
        link_type = EXCLUDED.link_type,
        created_at = NOW()
    `, [id, ph, args.target_project_hash, args.link_type]);

    return ok({ success: true, source: ph, target: args.target_project_hash, link_type: args.link_type });
  } catch (e) {
    return err(`Link failed: ${e.message}`);
  }
}

// ── List Projects ────────────────────────────────────────────────────

async function handleListProjects(args, ph) {
  const projectsRes = await query(`
    SELECT project_hash,
           COUNT(*) as memory_count,
           MIN(created_at) as first_activity,
           MAX(created_at) as last_activity
    FROM memories
    GROUP BY project_hash
    ORDER BY last_activity DESC
  `);

  // Enrich with entity and task counts
  const enriched = [];
  for (const p of projectsRes.rows) {
    const entityCountRes = await query(
      "SELECT COUNT(*) as c FROM entities WHERE project_hash = $1 AND is_valid = TRUE",
      [p.project_hash]
    );

    const taskCountRes = await query(
      "SELECT COUNT(*) as c FROM tasks WHERE project_hash = $1",
      [p.project_hash]
    );

    enriched.push({
      ...p,
      entity_count: entityCountRes.rows[0]?.c || 0,
      task_count: taskCountRes.rows[0]?.c || 0,
    });
  }

  return ok({ projects: enriched, count: enriched.length });
}

// ── Quality Gate (5-stage) ────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^(ok|done|yes|no|sure|thanks|got it|ack|k|np|ty|thx|lgtm)\.?$/i,
  /^test\s*memory/i,
  /^(todo|fixme|hack|xxx|note)\s*$/i,
  /^(updated?|changed?|fixed?|added?|removed?)\s*$/i,
  /^(working on|looking at|checking)\s/i,
  /^(i will|i'll|let me|gonna)\s/i,
  /^(see above|as discussed|per discussion)$/i,
  /^(same as before|no changes?|nothing new)$/i,
  /^(bump|wip|tmp|temp|placeholder)\s*$/i,
  /^.{0,19}$/,  // Less than 20 chars
  /^(the |this |that |it |we |i )\w+\s*$/i, // Single short sentence fragments
  /(.)\1{5,}/,  // Repeated characters (aaaaaa)
  /^[\s\W]*$/,  // Only whitespace/symbols
  /^(memory stored|stored memory|saving memory)/i,
  /^https?:\/\/\S+$/i,  // Bare URL with no context
  /^(commit|merge|push|pull|rebase)\s+\w+$/i,  // Bare git commands
  /^(import|require|from|export)\s/i,  // Bare import statements
  /^(function|const|let|var|class)\s+\w+/i,  // Bare code declarations
  /^```[\s\S]{0,30}```$/,  // Tiny code blocks
];

const FACADE_PATTERNS = [
  /\bTODO\b.*\blater\b/i,
  /\bwill implement\b/i,
  /\bplaceholder\b/i,
  /\bstub\b/i,
  /\bnot yet\b/i,
  /\bcoming soon\b/i,
  /\bskip for now\b/i,
];

const TYPE_SIGNALS = {
  debug:    /\b(bug|fix|error|crash|fail|broken|issue|exception|stack\s*trace|root\s*cause|regression)\b/i,
  decision: /\b(decided|chose|choice|alternative|trade-?off|option|approach|vs\.?|versus)\b/i,
  pattern:  /\b(pattern|convention|always|never|must|should|rule|standard|practice)\b/i,
  feature:  /\b(implement|built|added|feature|ship|launch|release|complete|finished)\b/i,
  learning: /\b(learn|discover|found out|realize|til|today i|insight|understand)\b/i,
  progress: /\b(session|progress|accomplish|done today|worked on|summary|wrap.?up)\b/i,
  rule:     /\b(always|never|must|require|enforce|mandate|convention|standard)\b/i,
};

function qualityGate(content, type, importance) {
  const trimmed = content.trim();

  // Stage 1: Noise rejection
  if (NOISE_PATTERNS.some(p => p.test(trimmed))) {
    return { rejected: true, reason: "Content too vague, noisy, or short (min 20 chars of meaningful text)." };
  }

  // Stage 2: Facade detection — warn but allow
  const isFacade = FACADE_PATTERNS.some(p => p.test(trimmed));

  // Stage 3: Auto-type correction
  let correctedType = type || "learning";
  if (!type || type === "learning") {
    for (const [t, pattern] of Object.entries(TYPE_SIGNALS)) {
      if (pattern.test(trimmed)) { correctedType = t; break; }
    }
  }

  // Stage 4: Importance calibration
  let calibratedImportance = importance ?? 0.5;
  if (correctedType === "debug" || correctedType === "decision") {
    calibratedImportance = Math.max(calibratedImportance, 0.7);
  } else if (correctedType === "rule" || correctedType === "pattern") {
    calibratedImportance = Math.max(calibratedImportance, 0.6);
  }
  if (isFacade) {
    calibratedImportance = Math.min(calibratedImportance, 0.3);
  }

  // Stage 5: Length-based quality bonus
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 50) calibratedImportance = Math.min(1.0, calibratedImportance + 0.05);

  return { rejected: false, type: correctedType, importance: calibratedImportance, facade: isFacade };
}

// ── Dream Phase (on-startup consolidation) ───────────────────────────

export async function runDreamPhase(projectHash) {
  // 1. Archive stale memories (>90 days, low importance, no access)
  const archivedRes = await query(`
    UPDATE memories SET is_archived = TRUE
    WHERE project_hash = $1 AND is_archived = FALSE
      AND importance_score < 0.3
      AND created_at < NOW() - INTERVAL '90 days'
      AND id NOT IN (SELECT memory_id FROM access_log WHERE created_at > NOW() - INTERVAL '30 days')
  `, [projectHash]);

  // 2. Promote high-confidence patterns (candidate → active → promoted)
  await query(`
    UPDATE patterns SET status = 'active'
    WHERE project_hash = $1 AND status = 'candidate' AND confidence >= 0.6
  `, [projectHash]);
  await query(`
    UPDATE patterns SET status = 'promoted'
    WHERE project_hash = $1 AND status = 'active' AND confidence >= 0.85 AND success_count >= 3
  `, [projectHash]);

  // 3. Deprecate low-confidence patterns
  await query(`
    UPDATE patterns SET status = 'deprecated'
    WHERE project_hash = $1 AND status IN ('candidate', 'active') AND confidence < 0.2
  `, [projectHash]);

  // 4. Decay relation weights (older relations become weaker)
  await query(`
    UPDATE relations SET confidence = GREATEST(0.1, confidence * 0.95)
    WHERE source_id IN (SELECT id FROM entities WHERE project_hash = $1)
      AND created_at < NOW() - INTERVAL '30 days'
  `, [projectHash]);

  const promotedRes = await query(
    "SELECT COUNT(*) as c FROM patterns WHERE project_hash = $1 AND status = 'promoted'",
    [projectHash]
  );
  const deprecatedRes = await query(
    "SELECT COUNT(*) as c FROM patterns WHERE project_hash = $1 AND status = 'deprecated'",
    [projectHash]
  );

  return {
    archived: archivedRes.rowCount || 0,
    patterns_promoted: promotedRes.rows[0]?.c || 0,
    patterns_deprecated: deprecatedRes.rows[0]?.c || 0,
  };
}

// ── Built-in Rules Engine ────────────────────────────────────────────

const BUILT_IN_RULES = [
  // Security (10 rules)
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

  // Architecture (10 rules)
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

  // Performance (5 rules)
  { id: "perf-01", category: "performance", severity: "high", rule: "Add database indexes for columns used in WHERE, JOIN, and ORDER BY." },
  { id: "perf-02", category: "performance", severity: "medium", rule: "Paginate large result sets — never fetch unbounded data." },
  { id: "perf-03", category: "performance", severity: "medium", rule: "Use caching for expensive computations and frequent reads." },
  { id: "perf-04", category: "performance", severity: "low", rule: "Lazy-load heavy resources (images, modules, data) when possible." },
  { id: "perf-05", category: "performance", severity: "high", rule: "Avoid N+1 queries — use JOINs or batch fetching." },

  // Testing (5 rules)
  { id: "test-01", category: "testing", severity: "medium", rule: "Write tests for business-critical paths and edge cases." },
  { id: "test-02", category: "testing", severity: "low", rule: "Use descriptive test names that explain the expected behavior." },
  { id: "test-03", category: "testing", severity: "medium", rule: "Mock external services in tests — don't make real API calls." },
  { id: "test-04", category: "testing", severity: "low", rule: "Keep tests independent — no shared mutable state between tests." },
  { id: "test-05", category: "testing", severity: "medium", rule: "Test error paths, not just happy paths." },
];

function getBuiltInRules(projectManifest) {
  let rules = [...BUILT_IN_RULES];

  // Add framework-specific rules based on project manifest
  if (projectManifest) {
    const deps = [
      ...(projectManifest.package_json?.dependencies || []),
      ...(projectManifest.package_json?.devDependencies || []),
    ];

    if (deps.some(d => /^react/.test(d))) {
      rules.push(
        { id: "react-01", category: "framework", severity: "medium", rule: "Use React hooks at the top level — never inside conditions or loops." },
        { id: "react-02", category: "framework", severity: "medium", rule: "Memoize expensive computations with useMemo, callbacks with useCallback." },
        { id: "react-03", category: "framework", severity: "high", rule: "Always provide a unique 'key' prop when rendering lists." },
      );
    }

    if (deps.some(d => /^next/.test(d))) {
      rules.push(
        { id: "next-01", category: "framework", severity: "medium", rule: "Use 'use client' directive only for components that need interactivity." },
        { id: "next-02", category: "framework", severity: "high", rule: "Fetch data in Server Components — avoid useEffect for data loading." },
      );
    }

    if (deps.some(d => /^express|^hono|^fastify|^koa/.test(d))) {
      rules.push(
        { id: "api-01", category: "framework", severity: "high", rule: "Validate request body with a schema before processing." },
        { id: "api-02", category: "framework", severity: "medium", rule: "Return consistent error response shapes across all endpoints." },
      );
    }
  }

  return rules;
}

// ── Context Budget Compression ───────────────────────────────────────

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function compressToTokenBudget(data, budget) {
  const { memories, rules, warnings, entities } = data;
  let tokensUsed = 0;

  // Reserve allocations: 60% memories, 20% rules, 10% warnings, 10% entities
  const memBudget = Math.floor(budget * 0.60);
  const ruleBudget = Math.floor(budget * 0.20);
  const warnBudget = Math.floor(budget * 0.10);
  const entBudget = Math.floor(budget * 0.10);

  // Max 25% of budget per single item
  const maxPerItem = Math.floor(budget * 0.25);

  // Compress memories — greedy inclusion sorted by effective_score
  const compressedMemories = [];
  let memTokens = 0;
  const sorted = [...memories].sort((a, b) => (b.effective_score || b.importance_score || 0) - (a.effective_score || a.importance_score || 0));
  for (const m of sorted) {
    const contentTokens = estimateTokens(m.content);
    const itemTokens = Math.min(contentTokens, maxPerItem);
    if (memTokens + itemTokens > memBudget) break;
    compressedMemories.push({
      id: m.id,
      content: truncateToTokens(m.content, maxPerItem),
      type: m.type,
      importance: m.importance_score,
      score: m.effective_score,
      tags: m.tags,
      created_at: m.created_at,
    });
    memTokens += itemTokens;
  }
  tokensUsed += memTokens;

  // Compress rules — include as many as fit
  const compressedRules = [];
  let ruleTokens = 0;
  for (const r of rules) {
    const ruleText = typeof r === "string" ? r : `[${r.severity}] ${r.rule}`;
    const t = estimateTokens(ruleText);
    if (ruleTokens + t > ruleBudget) break;
    compressedRules.push(ruleText);
    ruleTokens += t;
  }
  tokensUsed += ruleTokens;

  // Warnings — include all that fit
  const compressedWarnings = [];
  let warnTokens = 0;
  for (const w of warnings) {
    const t = estimateTokens(JSON.stringify(w));
    if (warnTokens + t > warnBudget) break;
    compressedWarnings.push(w);
    warnTokens += t;
  }
  tokensUsed += warnTokens;

  // Entities — compact format
  const compressedEntities = entities.slice(0, Math.floor(entBudget / 10));
  tokensUsed += estimateTokens(JSON.stringify(compressedEntities));

  return {
    memories: compressedMemories,
    rules: compressedRules,
    postmortem_warnings: compressedWarnings,
    top_entities: compressedEntities,
    _tokensUsed: tokensUsed,
    _memoriesIncluded: compressedMemories.length,
    _memoriesTotal: memories.length,
  };
}

// ── Migration Tool (Local → Cloud) ──────────────────────────────────

async function handleExportForMigration(args, ph) {
  const limit = args.limit || 1000;
  const offset = args.offset || 0;

  const memoriesRes = await query(`
    SELECT id, content, type, importance_score, tags, related_files,
           session_name, created_at, updated_at
    FROM memories
    WHERE project_hash = $1 AND is_archived = FALSE
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [ph, limit, offset]);

  const totalCountRes = await query(
    "SELECT COUNT(*) as c FROM memories WHERE project_hash = $1 AND is_archived = FALSE",
    [ph]
  );
  const totalCount = totalCountRes.rows[0]?.c || 0;

  const entitiesRes = await query(`
    SELECT name, type FROM entities WHERE project_hash = $1 AND is_valid = TRUE
  `, [ph]);

  const relationsRes = await query(`
    SELECT s.name as source, t.name as target, r.relation_type, r.weight
    FROM relations r
    JOIN entities s ON r.source_id = s.id
    JOIN entities t ON r.target_id = t.id
    WHERE s.project_hash = $1
  `, [ph]);

  const tasksRes = await query(
    "SELECT title, description, status, priority, created_at FROM tasks WHERE project_hash = $1",
    [ph]
  );

  const rulesRes = await query(
    "SELECT content, category, severity FROM rules WHERE project_hash = $1 AND is_active = TRUE",
    [ph]
  );

  return ok({
    format: "memaxx-export-v1",
    project_hash: ph,
    exported_at: new Date().toISOString(),
    total_memories: totalCount,
    batch: { offset, limit, count: memoriesRes.rows.length },
    memories: memoriesRes.rows.map(m => ({
      ...m,
      tags: safeParseJsonb(m.tags, []),
      related_files: safeParseJsonb(m.related_files, []),
    })),
    entities: entitiesRes.rows,
    relations: relationsRes.rows,
    tasks: tasksRes.rows,
    rules: rulesRes.rows,
    migration_instructions: {
      cloud_import: "POST each memory to the MEMAXX Cloud API at /api/v1/memory/import with your Bearer token.",
      batch_size: "Import in batches of 50 to avoid rate limits.",
      next_offset: offset + memoriesRes.rows.length < totalCount ? offset + limit : null,
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function err(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/** Parse JSONB — PostgreSQL returns objects directly, but handle string fallback */
function safeParseJsonb(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val; // Already parsed by pg driver
  try { return JSON.parse(val); } catch { return fallback; }
}
