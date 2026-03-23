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
- **Auth:** JWT (`@fastify/jwt`) + bcrypt — full email/password registration and login, role-based access (Super Admin / Admin / User / Pending), rate-limited login, and per-user BYOK API key cascade
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
│   ├── server/src/
│   │   ├── index.ts              # Fastify entry point
│   │   ├── config.ts             # Zod-validated config loader (env + DB cascade)
│   │   ├── agent/
│   │   │   ├── runtime.ts        # Core agentic loop (streaming, tool dispatch)
│   │   │   ├── planner.ts        # Plan mode logic
│   │   │   ├── session.ts        # Session/conversation management
│   │   │   ├── agenticRun.ts     # Agentic plan executor
│   │   │   ├── toolInterceptor.ts# Human-in-the-loop approval state machine
│   │   │   ├── canary.ts         # Canary token injection/detection
│   │   │   ├── prompts.ts        # System prompt assembly
│   │   │   └── pipeline/         # Pipeline agent runner
│   │   ├── mcp/
│   │   │   ├── client.ts         # MCP client (stdio + HTTP transports)
│   │   │   └── registry.ts       # MCP server registry & lifecycle
│   │   ├── llm/
│   │   │   ├── provider.ts       # LLM provider abstraction
│   │   │   ├── anthropic.ts      # Anthropic adapter
│   │   │   ├── openai.ts         # OpenAI adapter
│   │   │   └── ollama.ts         # Ollama adapter (+ hallucination retry)
│   │   ├── permissions/
│   │   │   ├── store.ts          # Permission CRUD (SQLite)
│   │   │   └── evaluator.ts      # PermissionGuard policy engine
│   │   ├── pipelines/
│   │   │   ├── manager.ts        # Pipeline lifecycle manager
│   │   │   ├── runner.ts         # Shared pipeline agent runner
│   │   │   ├── discord.ts        # Discord bot pipeline
│   │   │   ├── telegram.ts       # Telegram bot pipeline
│   │   │   └── line.ts           # LINE webhook pipeline
│   │   ├── routes/
│   │   │   ├── auth.ts           # Register, login, /me
│   │   │   ├── admin.ts          # Admin user management
│   │   │   ├── chat.ts           # WebSocket streaming chat
│   │   │   ├── agentic.ts        # Agentic mode REST endpoints
│   │   │   ├── execute.ts        # Direct tool execution endpoints
│   │   │   ├── servers.ts        # MCP server CRUD + start/stop
│   │   │   ├── permissions.ts    # Permission editor API
│   │   │   ├── sessions.ts       # Session + message CRUD
│   │   │   ├── activity.ts       # Audit log API
│   │   │   ├── pipelines.ts      # Pipeline CRUD + start/stop
│   │   │   ├── registry.ts       # MCP Catalog (curated + official registry)
│   │   │   ├── settings.ts       # Global & per-user settings API
│   │   │   ├── ollama.ts         # Ollama proxy/model list
│   │   │   └── model-check.ts    # Model availability check
│   │   └── db/
│   │       ├── schema.ts         # Drizzle schema (users, sessions, servers, …)
│   │       └── migrate.ts        # DB migration runner
│   └── web/src/
│       ├── App.tsx               # Root layout, sidebar, session grouping
│       ├── main.tsx
│       ├── api.ts                # Typed apiFetch helper
│       ├── pages/
│       │   ├── Auth.tsx          # Login / register
│       │   ├── Chat.tsx          # Streaming chat + approval UI
│       │   ├── Servers.tsx       # MCP server management
│       │   ├── Catalog.tsx       # MCP Catalog (browse & install)
│       │   ├── Permissions.tsx   # Granular permission editor
│       │   ├── AuditLog.tsx      # Tool call audit log
│       │   ├── Pipelines.tsx     # Pipeline management
│       │   ├── Settings.tsx      # User settings & BYOK keys
│       │   ├── Admin.tsx         # Admin panel (users, stats)
│       │   ├── Pending.tsx       # Awaiting-approval holding page
│       │   └── Forbidden.tsx     # 403 page
│       ├── components/           # Shared UI (ServerPermissionDrawer, UserMenu, …)
│       └── contexts/
│           └── AuthContext.tsx   # JWT auth state
├── Dockerfile
├── docker-compose.yml
├── AGENTS.md
├── TODO.md
├── SECURITY_HARDENING.md
└── PROMPT_INJECTION_LAYER.md
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

### PermissionGuard (`permissions/evaluator.ts`)

**The most critical component.** Every single MCP tool call MUST pass through `evaluatePermission()` before execution. No exceptions.

Permission evaluation order:
1. Is the MCP server registered and running?
2. Are permissions configured for this server?
3. For filesystem tools: denied-path check → allowed-path check → per-operation flags (read/write/create/delete)
4. For bash tools: is bash enabled? does the command match allowed glob patterns?
5. For web fetch tools: is web fetch enabled? is the domain in the allowlist?
6. Subprocess / network toggles
7. Env var access: **hardcoded DENY** — not overridable
8. **Trust Policy**: safe read-only tools in `trustedPaths` → `ALLOW_SILENT` (skip approval prompt)

Verdicts:
- `DENY` — blocked by policy, logged, returned to LLM as a structured denial
- `REQUIRE_APPROVAL` — paused for human approval in the UI (default)
- `ALLOW_SILENT` — auto-executed without prompting (opt-in via Trust Policy)

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
  pathRead: boolean
  pathWrite: boolean
  pathCreate: boolean
  pathDelete: boolean
  pathListDir: boolean
  // Tool permissions
  bashAllowed: boolean
  bashAllowedCommands: string[]         // glob patterns e.g. ["git *", "npm *"]
  webfetchAllowed: boolean
  webfetchAllowedDomains: string[]
  subprocessAllowed: boolean
  networkAllowed: boolean
  // Rate limits
  maxCallsPerMinute: number             // default: 30
  maxTokensPerCall: number
  // Prompt Injection Prevention
  promptInjectionPrevention: boolean    // server-wide PIP toggle
  toolPromptInjectionPrevention: Record<string, 'inherit' | 'enable' | 'disable'>
  // Trust Policy (auto-approve reads)
  autoApproveReads: boolean
  trustedPaths: string[]                // reads under these paths → ALLOW_SILENT
  // Env var access: hardcoded false — not stored, not configurable
}
```

---

## REST API Design

### Auth
```
GET    /api/auth/status          # Check if setup required + signup enabled
POST   /api/auth/register        # Register new user (first user → Super Admin)
POST   /api/auth/login           # Login (rate-limited: 5 attempts/min)
GET    /api/auth/me              # Verify token + issue fresh JWT
```

### Admin (admin role required)
```
GET    /api/admin/stats          # Platform stats (user/session/message counts, DB size)
GET    /api/admin/users          # List all users
POST   /api/admin/users          # Create user
PUT    /api/admin/users/:id      # Update user (name, email, role, password)
DELETE /api/admin/users/:id      # Delete user
```

### MCP Servers
```
GET    /api/servers              # List registered MCP servers
POST   /api/servers              # Register a new MCP server
GET    /api/servers/:id          # Get server details + status
PUT    /api/servers/:id          # Update server config (auto-restarts)
DELETE /api/servers/:id          # Remove server
POST   /api/servers/:id/start    # Start server process
POST   /api/servers/:id/stop     # Stop server process
GET    /api/servers/:id/tools    # List tools exposed by server
POST   /api/mcp/halt             # Emergency halt: abort all streams + disconnect all servers
```

### MCP Catalog
```
GET    /api/registry             # Curated + official MCP Registry servers (cached 5 min)
GET    /api/registry?q=...       # Search by name/title/description
```

### Permissions
```
GET    /api/permissions/:serverId   # Get all permissions for a server
PUT    /api/permissions/:serverId   # Replace all permissions
```

### Sessions & Messages
```
GET    /api/sessions                          # List sessions for current user
POST   /api/sessions                          # Create session
GET    /api/sessions/:id                      # Get session + messages
PUT    /api/sessions/:id                      # Update session (title, pin, folder, mode)
DELETE /api/sessions/:id                      # Delete session
DELETE /api/sessions                          # Delete ALL sessions for current user
DELETE /api/sessions/:id/messages             # Clear all messages in session
DELETE /api/sessions/:id/messages/:messageId  # Soft-delete a single message
POST   /api/sessions/:id/messages/:messageId/activate  # Activate a branched message
```

### Agent / Chat
```
WS     /ws/chat                    # WebSocket: streaming chat + tool call events
POST   /api/execute                # Execute approved tool call (from approval card)
GET    /api/agentic/...            # Agentic plan endpoints
```

### Activity Log
```
GET    /api/activity               # Paginated activity log
GET    /api/activity?serverId=X    # Filter by server
GET    /api/activity?outcome=DENY  # Filter by outcome
```

### Pipelines
```
GET    /api/pipelines              # List pipelines
POST   /api/pipelines              # Create pipeline (discord/telegram/line)
GET    /api/pipelines/:id          # Get pipeline details
PUT    /api/pipelines/:id          # Update pipeline config
DELETE /api/pipelines/:id          # Delete pipeline
POST   /api/pipelines/:id/start    # Start pipeline
POST   /api/pipelines/:id/stop     # Stop pipeline
```

### Settings
```
GET    /api/settings               # Global workspace settings (Super Admin only)
PUT    /api/settings/:key          # Update global setting (Super Admin only)
GET    /api/user/settings          # Current user's personal settings (BYOK keys, prefs)
PUT    /api/user/settings          # Upsert a personal setting
PUT    /api/user/settings/bulk     # Bulk-save personal settings
DELETE /api/user/settings          # Clear all personal settings
PUT    /api/user/profile           # Update profile (avatar upload via multipart)
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

### Login / Register (`/login`, `/register`)
- Email/password forms; first user auto-becomes Super Admin
- Pending-approval holding page shown to users awaiting role upgrade

### Chat (`/chat`, `/chat/:id`)
- Full-screen streaming chat interface
- Inline tool call events (collapsible): "🔧 Reading `/workspace/src/index.ts`..."
- **Human-in-the-Loop approval cards** — review and edit tool input before execution
- Denied tool calls shown inline in red with reason
- Session sidebar: time-grouped buckets (Pinned / Today / Yesterday / Previous 7 Days / Older), collapse/expand, rename, pin, delete, JSON export
- Model selector + agent mode toggle (Build / Plan)
- Emergency halt button

### MCP Servers (`/servers`)
- Table: name, transport, status (running/stopped/error/unhealthy), tool count
- Add server form: name, transport type, command or URL, args, env vars (JSON editor)
- Per-server start/stop/remove/edit controls; inline edit mode

### MCP Catalog (`/catalog`)
- Curated + official MCP Registry servers; search/filter
- One-click **Add & Start**; detects already-installed servers
- Required env var keys highlighted per entry

### Permission Editor (`/permissions/:serverId`)
- **Flagship UI feature — must be excellent**
- Filesystem: allowed/denied path lists with per-operation toggles (R/W/Create/Delete/List)
- Bash: toggle + glob-pattern command allowlist
- Web fetch: toggle + optional domain allowlist
- Subprocess / network: individual toggles
- Env var access: shown as permanently DISABLED (hardcoded in evaluator)
- **Prompt Injection Prevention (PIP)**: server-wide toggle + per-tool override (inherit/enable/disable)
- **Auto-Approve Reads (Trust Policy)**: trusted-path zone that skips approval for safe reads
- Rate limits: calls/min + max tokens/call
- Auto-saves on every change with toast confirmation

### Audit Log (`/activity`)
- Real-time live feed; auto-refreshes every 3 s
- Columns: timestamp, server, tool, outcome (`ALLOWED` / `⚡ AUTO` / `403 DENIED`), latency
- Expandable rows: full input payload + denial reason
- Filters: server, outcome, free-text search

### Pipelines (`/pipelines`)
- Discord, Telegram, LINE pipeline cards
- Per-pipeline start/stop/edit/delete; shared session selector

### Settings (`/settings`)
- Per-user BYOK API keys (Anthropic, OpenAI) — override workspace defaults
- UI preference toggles; password change
- PWA install prompt; push notification management

### Admin (`/admin`) — admin role required
- User management table: view, create, edit, delete users; role assignment
- Platform stats: total users, sessions, messages, DB size

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
      - AUTH_TOKEN=${AUTH_TOKEN}        # Legacy static token (optional)
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DEFAULT_MODEL=claude-sonnet-4-5-20250929
      - DEFAULT_PROVIDER=anthropic
      - ENABLE_SIGNUP=true               # Set to false to disable public registration
      - DEFAULT_NEW_USER_ROLE=pending    # 'user' to auto-approve, 'pending' for admin review
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
Scopes: agent, mcp, permissions, ui, docker, api, db, auth, admin, pipelines, catalog

Examples:
  feat(permissions): add per-path write toggle in permission editor UI
  security(permissions): enforce env var read denial at evaluator level
  feat(mcp): implement HTTP/SSE transport for remote MCP servers
  fix(agent): handle parallel tool calls in agentic loop
  feat(ui): add real-time tool call feed to chat page
  feat(auth): add pending-approval flow for new user registrations
  feat(admin): add user management panel with role assignment
  feat(pipelines): add Telegram long-polling bot pipeline
  feat(docker): add multi-stage Dockerfile with static frontend serving
```

---

## TODO.md — Keeping the Backlog Current

The project backlog lives in [`TODO.md`](./TODO.md) at the repo root.

**When starting work:**
- Check `TODO.md` to see if the feature/fix you're implementing is already tracked.
- If it is, note the item so you can mark it done when finished.

**When finishing work:**
- Mark the relevant item(s) in `TODO.md` as complete by changing `- [ ]` to `- [x]`.
- If your work surfaces a new bug, gap, or follow-up task that isn't already listed, add it under the appropriate category.
- Keep item descriptions concise and in the same style as the existing entries.
- Do **not** delete completed items — checked items serve as a lightweight changelog.

**Example:**
```diff
-  - [ ] Add a Chat History page (`/chat/history`) — paginated list of all sessions
+  - [x] Add a Chat History page (`/chat/history`) — paginated list of all sessions
```

---

*Drop this file in the project root. OpenCode will load it automatically on `/init` and use it as the source of truth for all agent behavior on this codebase.*
