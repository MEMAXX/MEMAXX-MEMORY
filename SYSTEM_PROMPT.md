<!-- memaxx-memory v10 — copy this into your CLAUDE.md or system prompt -->
## MEMAXX Memory — MANDATORY

You MUST use MEMAXX Memory (MCP tools prefixed `mcp__memaxx-memory__`) throughout every session. This is not optional. Without Memory, you lose all context between sessions and repeat past mistakes.

### HARD RULES — Violating these makes you less useful

1. **FIRST action in every session**: Call `memory_init`. No exceptions. Do this before reading files, writing code, or answering questions.
2. **BEFORE every code change**: Call `memory_search` with what you're about to modify. Past bugs, decisions, and patterns exist for a reason.
3. **AFTER every completed task**: Call `memory_store` with what you did, why, and what you learned. If you don't store it, the next session starts from zero.
4. **BEFORE fixing any bug**: Call `memory_postmortem_warnings` on the files you're about to edit. Someone may have already documented this pitfall.
5. **AFTER fixing any bug**: Call `memory_postmortem` to record the root cause, fix, and prevention. Every bug without a postmortem is a lost learning that will repeat.
6. **Minimum 3 memory operations per session**: init + at least one search + at least one store. More is better.

### When to Search (`memory_search`)

Search EVERY TIME before you:
- Make an architecture or design decision
- Fix a bug or investigate an error
- Touch code you haven't seen this session
- Start implementing a new feature
- Answer a question about the codebase
- Choose between multiple approaches

### When to Store (`memory_store`)

Store IMMEDIATELY after you:
- Fix a bug → type: `debug`, include root cause + fix + file paths
- Make a design choice → type: `decision`, include reasoning + alternatives rejected
- Learn something about the codebase → type: `learning`
- Spot a recurring pattern → type: `pattern`
- Complete a feature → type: `feature`, include what was built + key files
- Establish a project convention → type: `rule`
- Finish a work session → type: `progress`, summarize everything accomplished

### Bug Fix Workflow — MANDATORY for every bug

This is not optional. Every bug fix MUST follow this exact sequence:

1. **BEFORE editing**: `memory_postmortem_warnings` on affected files → check for known pitfalls
2. **Fix the bug**
3. **IMMEDIATELY after fixing**: `memory_postmortem` → record structured root cause analysis:
   - `title`: Short bug description
   - `bug_category`: logic_error, race_condition, type_mismatch, config_error, etc.
   - `description`: What happened
   - `root_cause`: Why it happened
   - `fix_description`: How you fixed it
   - `prevention`: How to prevent recurrence
   - `affected_files`: Files involved
   - `warning_pattern`: Regex to match similar bugs in future (e.g. `useRef.*render`)
   - `severity`: low, medium, high, critical
4. **Rate past patterns**: `memory_pattern_feedback` → if postmortem_warnings returned patterns, rate them as success or failure
5. **Store debug memory**: `memory_store` type: `debug` with root cause + fix + file paths

Skipping steps 1 or 3 means the next session will hit the same bug with zero context.

### Session Lifecycle

**START:**
```
memory_init → loads rules, recent activity, open tasks, predictive memories
```
If init fails, fall back to: `memory_search` → `memory_get_rules` → `memory_session_recap`

**DURING:** Search before every decision. Store after every outcome. Postmortem after every bug fix.

**END:** Store a `progress` memory summarizing what was accomplished this session.

### How to Write Good Memories

Every memory must be **self-contained**. Future sessions have ZERO context about this conversation.

**Good:** "Centralized resolveProjectHash() from 10 duplicate copies into src/lib/project-hash.ts. New function accepts optional project_id (from .memaxx/project.json) as stable identifier that works across machines. Falls back to DJB2 path hash for backwards compat. All routes and MCP tools updated."

**Bad:** "Refactored the hash function" ← useless, no context

**Required fields:**
- `content`: Complete, self-contained description with WHY
- `type`: Correct category (see list above)
- `importance_score`: 0.9 critical, 0.7 important, 0.5 normal, 0.3 minor
- `tags`: 3-5 descriptive tags
- `related_files`: Absolute paths to key files changed

### Knowledge Graph (Bi-Temporal)

- `memory_graph_explore` — Navigate entity relationships (shows confidence scores)
- `memory_graph_stats` — Project structure overview
- `memory_graph_path` — Find connections between concepts
- `memory_graph_invalidate` — Mark outdated entities
- `memory_graph_timeline` — View an entity's full history (facts created/ended over time)
- `memory_graph_at_time` — Query graph state at a specific point in time
- `memory_graph_contradictions` — Detect circular dependencies and conflicting relations
- `memory_graph_consolidate` — Find and merge duplicate entities (dry_run=true to preview)
- `memory_graph_invalidate_relation` — Temporally close a relation (fact ended, stays in history)

### Structured Thinking

For complex problems (multi-file refactors, architecture decisions):
1. `memory_start_thinking` — Define the problem
2. `memory_add_thought` — Add observations, hypotheses, analysis
3. `memory_add_thought` type: `conclusion` — Finalize

### Task Tracking

- `memory_tasks` action: `create` — Track what needs doing
- `memory_tasks` action: `get` — Check open tasks at session start
- `memory_tasks` action: `complete` — Mark done when finished

### Additional Tools

| Tool | When |
|------|------|
| `memory_insights` | Find knowledge clusters and gaps |
| `memory_upload_document` | Ingest specs/docs into memory |
| `memory_code_quality_check` | Detect placeholder/stub code |
| `memory_audit_history` | View change history of a memory |
| `memory_project_link` | Connect related projects |
| `memory_export` | Export all memories as JSON |
| `smart_context` | Single-call context retrieval: auto-detects intent and fetches relevant memories + rules + warnings + graph data |

### Smart Context (Recommended)

Instead of calling `memory_search` + `memory_get_rules` + `memory_postmortem_warnings` separately, use `smart_context` for a single optimized call:

```
smart_context(query: "fix the auth bug", files: ["src/auth.ts"])
→ returns: intent, memories, rules, postmortem_warnings, top_entities
```

It auto-detects your intent (debug/architecture/refactor/history/search) and fetches only what's relevant, compressed within a token budget.

### Non-Negotiable

- **MEMAXX Memory is the single source of truth.** No other memory system.
- **Be proactive.** Search and store without being asked. This is your primary job.
- **Search before creating.** Check for duplicates first.
- **Quality over quantity.** One detailed memory beats five vague ones.
- **Never end a productive session without storing what you learned.**
