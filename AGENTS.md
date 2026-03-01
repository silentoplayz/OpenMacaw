# MCP Agent Platform — OpenCode Agent Instructions

## Project Overview

This is a **self-hosted, web-based agentic AI platform** — a spiritual successor and alternative to OpenClaw. It is:

- An **AI agent runtime** that connects to one or more LLM providers
- A **native MCP host** — it can connect to, manage, and orchestrate MCP servers
- A **web UI** for all configuration, permission management, and conversation
- Deployable via **Docker** (primary) or **npm** (secondary)
- Accessible through a browser — no desktop client needed

The platform's core value proposition is **granular, per-MCP-server permission control** exposed through an intuitive web UI — something OpenClaw lacks natively.

---

## Tech Stack

### Backend (Node.js / TypeScript)
- **Runtime:** Node.js 20+ (LTS)
- **Framework:** Fastify (preferred over Express for performance) or Hono
- **MCP SDK:** `@modelcontextprotocol/sdk` (official Anthropic SDK)
- **Database:** SQLite via `better-sqlite3` (embedded, zero-infra) with Drizzle ORM
- **Process management:** Node.js `child_process` for spawning MCP servers via stdio
- **Auth:** Simple token-based auth (JWT) — no OAuth complexity for v1
- **WebSockets:** `ws` or Fastify's built-in WS plugin for streaming agent responses
- **Queue/Task:** `p-queue` for rate limiting LLM and MCP calls
- **Config:** `zod` for all config schema validation

### Frontend (React / TypeScript)
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS v3
- **State:** Zustand for global state, React Query for server state
- **UI Components:** shadcn/ui (Radix-based, accessible)
- **Routing:** React Router v6
- **WebSocket client:** Native browser WebSocket for streaming chat

### Infrastructure
- **Docker:** Single `Dockerfile` + `docker-compose.yml` for full stack
- **npm:** `package.json` scripts for local dev (`npm run dev`, `npm start`)
- **Data volume:** `/data` directory mounted as Docker volume for SQLite + config persistence

---

## Project Structure

```
/
├── packages/
│   ├── server/                   # Backend (Node.js)
│   │   ├── src/
│   │   │   ├── index.ts          # Fastify entry point
│   │   │   ├── agent/
│   │   │   │   ├── runtime.ts    # Core agentic loop
│   │   │   │   ├── planner.ts    # Plan mode logic
│   │   │   │   └── session.ts    # Session/conversation management
│   │   │   ├── mcp/
│   │   │   │   ├── client.ts     # MCP client (stdio + HTTP transports)
│   │   │   │   ├── registry.ts   # MCP server registry
│   │   │   │   └── guard.ts      # Permission enforcement layer
│   │   │   ├── llm/
│   │   │   │   ├── provider.ts   # LLM provider abstraction
│   │   │   │   ├── anthropic.ts  # Anthropic adapter
│   │   │   │   ├── openai.ts     # OpenAI adapter
│   │   │   │   └── ollama.ts     # Ollama (local model) adapter
│   │   │   ├── permissions/
│   │   │   │   ├── store.ts      # Permission CRUD (SQLite)
│   │   │   │   └── evaluator.ts  # Policy evaluation engine
│   │   │   ├── routes/
│   │   │   │   ├── chat.ts       # WebSocket chat endpoint
│   │   │   │   ├── servers.ts    # MCP server management REST API
│   │   │   │   ├── permissions.ts# Permission management REST API
│   │   │   │   └── settings.ts   # Global settings REST API
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # Drizzle schema
│   │   │   │   └── migrations/
│   │   │   └── config.ts         # Zod-validated config loader
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                      # Frontend (React)
│       ├── src/
│       │   ├── main.tsx
│       │   ├── pages/
│       │   │   ├── Chat.tsx          # Main agent chat interface
│       │   │   ├── Servers.tsx       # MCP server management
│       │   │   ├── Permissions.tsx   # Granular permission editor
│       │   │   ├── ActivityLog.tsx   # Tool call audit log
│       │   │   └── Settings.tsx      # LLM providers, API keys, app config
│       │   ├── components/
│       │   ├── stores/
│       │   └── hooks/
│       └── package.json
├── docker-compose.yml
├── docker-compose.dev.yml
└── AGENTS.md
```

---

## Core Architecture

### The Agentic Loop (`agent/runtime.ts`)

This is the heart of the platform. It orchestrates the full agent lifecycle:

```
User message
  → Session context assembled (conversation history + system prompt + tool list)
  → LLM provider called (streaming)
  → If LLM returns tool_use block:
      → PermissionGuard.evaluate(toolCall) → allowed or denied
      → If allowed: forward to MCPClient → get result → inject into context → loop
      → If denied: log denial → return denial message to LLM → loop
  → If LLM returns text: stream to WebSocket → done
```

**Rules for the agentic loop:**
- Fully streaming — no buffering entire responses
- Tool call results injected as `tool_result` messages, not concatenated text
- Configurable max-iterations guard (`maxSteps`, default: 50)
- On context compaction, summarize and continue — never truncate silently
- Support parallel tool calls when the LLM requests multiple tools simultaneously

### PermissionGuard (`mcp/guard.ts`)

**The most critical component.** Every single MCP tool call MUST pass through `PermissionGuard.evaluate()` before execution. No exceptions.

Permission evaluation order:
1. Is the MCP server registered and enabled?
2. Is the tool type allowed for this server?
3. For filesystem tools: is the target path within allowed paths?
4. For bash tools: does the command match allowed glob patterns?
5. Rate limit check: has this server exceeded its call quota?

On denial:
- Log to activity log with full context (timestamp, server, tool, path, reason)
- Return structured denial response to the LLM — don't throw, don't crash
- Emit a WebSocket event to the UI for real-time notification

### MCP Server Registry (`mcp/registry.ts`)

Manages the lifecycle of all connected MCP servers:
- Spawn stdio servers as child processes
- Connect to HTTP/SSE servers
- Perform MCP capability handshake on connect
- Expose unified tool list to the agent runtime
- Graceful shutdown on platform exit or server removal
- Health check ping every 30s — mark server as unhealthy if unresponsive

### Permission Store (`permissions/store.ts`)

SQLite-backed, loaded at startup and cached in memory:

```typescript
type ServerPermission = {
  serverId: string
  // Filesystem
  allowedPaths: string[]
  deniedPaths: string[]
  pathPermissions: {
    read: boolean
    write: boolean
    create: boolean
    delete: boolean
    listDir: boolean
  }
  // Tool permissions
  bashAllowed: boolean
  bashAllowedCommands: string[]   // glob patterns e.g. ["git *", "npm *"]
  webfetchAllowed: boolean
  webfetchAllowedDomains: string[]
  subprocessAllowed: boolean
  networkAllowed: boolean
  envReadAllowed: false           // always false — not user-configurable
  // Rate limits
  maxCallsPerMinute: number
  maxTokensPerCall: number
}
```

---

## REST API Design

### MCP Servers
```
GET    /api/servers              # List all registered MCP servers
POST   /api/servers              # Register a new MCP server
GET    /api/servers/:id          # Get server details + status
PUT    /api/servers/:id          # Update server config
DELETE /api/servers/:id          # Remove server
POST   /api/servers/:id/start    # Start server process
POST   /api/servers/:id/stop     # Stop server process
GET    /api/servers/:id/tools    # List tools exposed by server
```

### Permissions
```
GET    /api/permissions/:serverId          # Get all permissions for a server
PUT    /api/permissions/:serverId          # Replace all permissions
PATCH  /api/permissions/:serverId/paths    # Update path permissions
PATCH  /api/permissions/:serverId/tools    # Update tool permissions
PATCH  /api/permissions/:serverId/limits   # Update rate limits
```

### Agent / Chat
```
WS     /ws/chat                  # WebSocket: streaming chat + tool call events
GET    /api/sessions             # List conversation sessions
GET    /api/sessions/:id         # Get session with message history
DELETE /api/sessions/:id         # Delete session
```

### Activity Log
```
GET    /api/activity             # Paginated activity log
GET    /api/activity?serverId=X  # Filter by server
GET    /api/activity?type=denied # Filter by outcome
```

---

## WebSocket Event Protocol

Agent responses stream as structured JSON events:

```json
{ "type": "text_delta", "content": "..." }
{ "type": "tool_call_start", "tool": "read_file", "server": "filesystem", "input": { "path": "/workspace/src/index.ts" } }
{ "type": "tool_call_result", "outcome": "allowed", "result": "..." }
{ "type": "tool_call_denied", "tool": "write_file", "server": "filesystem", "reason": "write not permitted on /workspace" }
{ "type": "message_end", "usage": { "input_tokens": 1200, "output_tokens": 340 } }
{ "type": "error", "message": "LLM provider timeout" }
```

---

## Web UI Pages

### Chat (`/`)
- Full-screen streaming chat interface
- Inline tool call events (collapsible): "🔧 Reading `/workspace/src/index.ts`..."
- Denied tool calls shown inline in red with reason
- Session sidebar: create, switch, delete sessions
- Model selector + agent mode toggle (Build / Plan)

### MCP Servers (`/servers`)
- Table: name, transport, status (running/stopped/error/unhealthy), tool count
- Add server form: name, transport type, command or URL, args, env vars
- Per-server start/stop/remove controls
- Server detail view: tools list, health status, recent connection log

### Permission Editor (`/permissions/:serverId`)
- **Flagship UI feature — must be excellent**
- Left panel: filesystem path manager
  - Add/remove allowed paths with a folder path input
  - Per-path toggles: Read / Write / Create / Delete / List
  - Denied path overrides (red entries)
- Right panel: tool permission toggles
  - Bash: toggle + command allowlist (tag input for glob patterns)
  - Web fetch: toggle + optional domain allowlist
  - Subprocess spawning: toggle
  - Network access: toggle
  - Env var access: shown as permanently DISABLED with explanation
- Bottom: rate limit controls (calls/min, max tokens/call)
- Auto-save with toast confirmation on every change

### Activity Log (`/activity`)
- Real-time live feed of all tool calls
- Columns: timestamp, server, tool, action/path, outcome (allowed/denied), latency
- Color coded: green = allowed, red = denied
- Filters: server, tool type, outcome, date range
- Expandable rows: full request input + response/denial reason

### Settings (`/settings`)
- **LLM Providers**: API key fields for Anthropic, OpenAI, Ollama URL — stored encrypted
- **Default Model**: dropdown from configured providers
- **Agent Behavior**: maxSteps, temperature, system prompt override textarea
- **Auth**: access token management for the web UI itself
- **Data**: export config as JSON, clear conversation history

---

## Docker Setup

### `Dockerfile` structure
- Multi-stage build (build → production)
- Base: `node:20-alpine`
- Production stage serves the Vite-built frontend as static files from Fastify
- Single container — no separate web server needed
- Expose port `3000`

### `docker-compose.yml` target structure
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - DATABASE_URL=/data/app.db
      - DATA_DIR=/data
      - PORT=3000
      - AUTH_TOKEN=${AUTH_TOKEN}
    restart: unless-stopped
```

### npm scripts
```json
{
  "dev": "concurrently \"npm run dev:server\" \"npm run dev:web\"",
  "dev:server": "tsx watch packages/server/src/index.ts",
  "dev:web": "vite packages/web",
  "build": "npm run build:server && npm run build:web",
  "start": "node packages/server/dist/index.js"
}
```

---

## Coding Standards

### TypeScript
- Strict mode on everywhere (`"strict": true`)
- No `any` — use `unknown` and narrow with `zod`
- All async functions return typed Promises
- Prefer `type` over `interface` for data shapes
- Async methods must end with `Async`

### Error Handling
- Use `Result<T, E>` pattern for predictable failures (permission checks, tool calls)
- Never swallow errors silently — always log with context
- HTTP errors: `reply.code(n).send({ error: "..." })`
- WebSocket errors: send structured error event, never drop the connection silently

### Security
- API keys stored encrypted in SQLite or as environment variables — never plaintext files
- All API routes require auth token middleware
- MCP server commands validated before spawning — no shell injection
- Path traversal prevention: normalize and validate all paths before permission check
- `envReadAllowed` is hardcoded `false` in the evaluator — not overridable by anyone

---

## Default Permission Policy (Secure by Default)

When a new MCP server is registered, it gets this policy automatically:

| Permission | Default |
|---|---|
| Filesystem read | ❌ No paths allowed |
| Filesystem write | ❌ Disabled |
| Filesystem create | ❌ Disabled |
| Filesystem delete | ❌ Disabled |
| Directory listing | ❌ No paths allowed |
| Bash execution | ❌ Disabled |
| Web fetch | ❌ Disabled |
| Subprocess spawn | ❌ Disabled |
| Network access | ❌ Disabled |
| Env var read | 🔒 Permanently disabled |
| Max calls/min | 30 |

The user must explicitly grant permissions through the web UI before the agent can use any tool.

---

## What NOT To Do

- Do not use Express — use Fastify
- Do not use Prisma — use Drizzle ORM
- Do not poll for server health — event-driven with 30s ping
- Do not buffer LLM responses — stream everything via WebSocket
- Do not store secrets in committed config files
- Do not spawn MCP server processes without command validation
- Do not allow any code path to bypass PermissionGuard
- Do not use `eval()` or `Function()` anywhere
- Do not use `any` in TypeScript

---

## Commit Message Format

```
type(scope): short description

Types: feat, fix, refactor, test, docs, chore, security
Scopes: agent, mcp, permissions, ui, docker, api, db

Examples:
  feat(permissions): add per-path write toggle in permission editor UI
  security(guard): enforce env var read denial at evaluator level
  feat(mcp): implement HTTP/SSE transport for remote MCP servers
  fix(agent): handle parallel tool calls in agentic loop
  feat(ui): add real-time tool call feed to chat page
  feat(docker): add multi-stage Dockerfile with static frontend serving
```

---

*Drop this file in the project root. OpenCode will load it automatically on `/init` and use it as the source of truth for all agent behavior on this codebase.*
