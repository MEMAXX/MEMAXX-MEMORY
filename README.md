# MEMAXX Memory Local

**Persistent AI memory running 100% on your machine.**

Zero cloud dependency. SQLite-powered. Beautiful local dashboard.

---

## Features

- **36 MCP tools** — full cloud feature parity, nothing held back
- **Hybrid search** — semantic + full-text (FTS5) + knowledge graph + time-decay ranking
- **Interactive local dashboard** — knowledge graph visualization, memory browser, task tracking
- **Multi-provider embeddings** — OpenAI, OpenRouter, or Ollama (fully local, no API key needed)
- **Dream phase** — automated pattern promotion and memory consolidation on startup
- **Bug postmortems** — structured root cause analysis with pattern learning (reinforcement learning)
- **Document ingestion** — chunk text files into searchable memories
- **Minimal dependencies** — just better-sqlite3 + sqlite-vec

## Quick Start

```bash
# Install and run
npx memaxx-memory-local
```

The setup wizard guides you through:
1. Choose embedding provider (OpenAI / OpenRouter / Ollama)
2. Enter API key (or skip for local Ollama)
3. Dashboard opens automatically with onboarding guide

## MCP Configuration

Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client.

```json
{
  "mcpServers": {
    "memaxx-memory": {
      "command": "npx",
      "args": ["-y", "memaxx-memory-local"]
    }
  }
}
```

## Dashboard

The local dashboard gives you full visibility into your AI memory.

- **Start:** `npx memaxx-memory-local --dashboard`
- Auto-starts in the background alongside the MCP server
- Runs on localhost only (`127.0.0.1`) — your data never leaves your machine

**Pages:**

| Page | Description |
|------|-------------|
| Overview | Memory stats, recent activity, quick actions |
| Memory Browser | Search, filter, and inspect all stored memories |
| Knowledge Graph | Interactive entity relationship visualization |
| Tasks | Open/completed task tracking |
| Postmortems | Bug root cause analyses with pattern matching |
| Thinking Sequences | Structured reasoning chains |
| Rules | User and built-in rule management |
| Settings | Provider config, backup, maintenance |

## CLI Options

```
npx memaxx-memory-local                Start MCP server (+ dashboard in background)
npx memaxx-memory-local --setup        Run/re-run setup wizard
npx memaxx-memory-local --dashboard    Start dashboard only (opens browser)
npx memaxx-memory-local --no-dashboard Start MCP without dashboard
npx memaxx-memory-local --port 3333    Custom dashboard port
npx memaxx-memory-local --backup       Backup database
```

## How It Works

Memories are stored in a local SQLite database with vector embeddings powered by [sqlite-vec](https://github.com/asg017/sqlite-vec).

- **Semantic search** via vector similarity (cosine distance)
- **Full-text search** via SQLite FTS5
- **Knowledge graph** with bi-temporal entity tracking (facts have valid-time and transaction-time)
- **Quality gate** prevents noise with 5-stage validation before storage
- **Dream phase** runs on startup to archive stale memories and promote recurring patterns

## Data Storage

| Path | Contents |
|------|----------|
| `~/.memaxx/memories.db` | All memories, embeddings, knowledge graph |
| `~/.memaxx/local-config.json` | Provider settings, preferences |
| `.memaxx/project.json` | Per-project identity (in your project root) |

All data stays on your filesystem. Back up by copying `~/.memaxx/`.

## Requirements

- **Node.js 20+**
- One of the following for embeddings:
  - OpenAI API key
  - OpenRouter API key
  - Local [Ollama](https://ollama.com) instance (no API key required)

## License

Proprietary. See LICENSE file.
