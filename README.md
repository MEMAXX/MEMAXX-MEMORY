# MEMAXX Memory

**Self-hosted AI memory for coding assistants. Free forever.**

Your AI finally remembers — every decision, bug fix, and pattern, across sessions and devices.

---

## Why MEMAXX?

AI coding assistants forget everything between sessions. MEMAXX gives them persistent memory:

- **33 MCP tools** — search, store, knowledge graph, postmortems, structured thinking
- **Hybrid search** — semantic + full-text + graph-boosted + time-decay ranking
- **Knowledge graph** — bi-temporal entity tracking with relationships
- **Local dashboard** — memory browser, graph visualization, task tracking
- **Multi-provider** — OpenAI, OpenRouter, or Ollama (100% local, no API key needed)
- **Zero cloud** — PostgreSQL + pgvector, your data never leaves your machine

## Quick Start (Docker)

```bash
git clone https://github.com/MEMAXX/MEMAXX-MEMORY.git
cd MEMAXX-MEMORY
cp .env.example .env    # Add your API key
docker compose up -d
```

That's it. MEMAXX is running at `http://localhost:3100`.

## MCP Configuration

Add this to your AI coding tool's MCP config:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

**Windsurf** (`.windsurf/mcp.json`):
```json
{
  "mcpServers": {
    "memaxx-memory": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

## AI System Prompt (Important!)

For your AI assistant to use MEMAXX Memory effectively, copy the system prompt into your project's `CLAUDE.md` (or equivalent):

```bash
# Claude Code
cp SYSTEM_PROMPT.md your-project/CLAUDE.md

# Or append to existing CLAUDE.md
cat SYSTEM_PROMPT.md >> your-project/CLAUDE.md
```

This teaches your AI to:
- Call `memory_init` at session start
- Search memory before every code change
- Store learnings after every task
- Run postmortems after every bug fix
- Use the knowledge graph and smart context

The full prompt is in [`SYSTEM_PROMPT.md`](./SYSTEM_PROMPT.md). You can also copy it from the Dashboard onboarding screen.

## Remote Access (Tailscale)

Access your memory from anywhere — laptop, phone, another machine:

1. Install [Tailscale](https://tailscale.com) on both machines
2. Set an auth token in your `.env`:
   ```
   AUTH_TOKEN=your-secret-token
   ```
3. Restart: `docker compose up -d`
4. Connect from anywhere:
   ```json
   {
     "mcpServers": {
       "memaxx-memory": {
         "url": "http://your-machine.tailnet:3100/mcp",
         "headers": {
           "Authorization": "Bearer your-secret-token"
         }
       }
     }
   }
   ```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP Streamable HTTP (JSON-RPC) |
| `GET /` | Local dashboard (memory browser, graph, tasks) |
| `GET /health` | Health check (version, db status, uptime) |
| `GET /api/*` | Dashboard REST API |

## Dashboard

Full visibility into your AI memory — runs at `http://localhost:3100`.

| Page | What it does |
|------|-------------|
| Overview | Memory stats, recent activity, type breakdown |
| Memory Browser | Search, filter, inspect all stored memories |
| Knowledge Graph | Interactive entity relationship visualization |
| Tasks | Open/completed task tracking |
| Postmortems | Bug root cause analyses with pattern matching |
| Thinking | Structured reasoning chains |
| Rules | User and built-in rule management |
| Settings | Provider config, backup, export/import |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | Yes | — | `openai`, `openrouter`, or `ollama` |
| `EMBEDDING_API_KEY` | Yes* | — | API key (*not needed for Ollama) |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | Embedding model |
| `LLM_PROVIDER` | No | — | LLM for entity extraction |
| `LLM_API_KEY` | No | — | LLM API key |
| `LLM_MODEL` | No | `gpt-4o-mini` | LLM model |
| `DATABASE_URL` | No | Auto-configured by Docker | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | No | `memaxx` | PostgreSQL password |
| `PORT` | No | `3100` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `AUTH_TOKEN` | No | — | Bearer token for remote access |

## Run Without Docker

> **Note:** PostgreSQL 17 with pgvector must be running separately. Set the `DATABASE_URL` environment variable to point to your PostgreSQL instance.

```bash
# Install dependencies
npm install

# Interactive setup
node bin.mjs --setup

# Start server
node bin.mjs

# Or use legacy stdio transport (for npx)
node bin.mjs --stdio
```

### CLI Options

```
node bin.mjs                Start HTTP server (MCP + Dashboard)
node bin.mjs --stdio        Legacy stdio MCP transport
node bin.mjs --setup        Interactive setup wizard
node bin.mjs --backup       Backup database
node bin.mjs --port 8080    Custom port
node bin.mjs --auth-token X Set auth token
```

## Ollama (100% Local)

Run MEMAXX with zero external API calls:

```env
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_BASE_URL=http://host.docker.internal:11434
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
LLM_BASE_URL=http://host.docker.internal:11434
```

> `host.docker.internal` lets the Docker Compose PostgreSQL setup reach Ollama on your host machine.

## How It Works

```
AI Coding Assistant (Claude Code, Cursor, Windsurf)
        │
        │  MCP Streamable HTTP (POST /mcp)
        ▼
┌─────────────────────────────┐
│  MEMAXX Memory Server       │
│                             │
│  ┌───────────────────────┐  │
│  │ 33 MCP Tools          │  │
│  │ memory_init            │  │
│  │ memory_store           │  │
│  │ memory_search          │  │
│  │ smart_context          │  │
│  │ memory_graph_explore   │  │
│  │ memory_postmortem      │  │
│  │ ...                    │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │ PostgreSQL + pgvector  │  │
│  │ Memories, Embeddings  │  │
│  │ Knowledge Graph       │  │
│  │ Tasks, Postmortems    │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

- **Semantic search** via pgvector (cosine distance)
- **Full-text search** via PostgreSQL tsvector + GIN
- **Knowledge graph** with bi-temporal entity tracking
- **Quality gate** prevents noise with 5-stage validation
- **Dream phase** archives stale memories and promotes patterns on startup

## Data Storage

| Path | Contents |
|------|----------|
| `/var/lib/postgresql/data` (Docker volume `pgdata`) | All memories, embeddings, knowledge graph |
| `~/.memaxx/local-config.json` | Provider settings (local mode only) |

Back up with `docker compose exec postgres pg_dump -U memaxx memaxx > backup.sql`.

## Requirements

- **Docker** (includes PostgreSQL 17 with pgvector)
- One of:
  - OpenAI API key
  - OpenRouter API key
  - Local [Ollama](https://ollama.com) instance (free, no API key)

## License

MIT
