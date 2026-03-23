# OpenMacaw

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Website](https://img.shields.io/badge/Website-openmacaw.com-green)](https://openmacaw.com)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen)](#)

**A self-hosted, security-first AI agent platform with granular MCP server permission control.**

OpenMacaw is an open-source web-based AI agent runtime that connects to LLM providers, orchestrates MCP servers, and enforces fine-grained permission policies — all through a clean browser UI. No desktop client required. Designed as a security-hardened successor to OpenClaw.

---

## What It Does

OpenMacaw lets you run an AI agent locally that can use tools via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Every tool call passes through a configurable permission guard before it executes — giving you precise, auditable control over what the agent can and cannot do.

**Core capabilities:**
- Connect to any MCP server (stdio or HTTP/SSE transport)
- Control exactly what each server can access: paths, commands, domains, and more
- Stream agent responses and tool calls in real time via WebSocket
- Approve or deny individual tool calls with inline editing before execution
- Run autonomous agentic plans with a drag-to-reorder step editor and optional final checkpoint
- Log every tool call with timestamp, outcome, latency, and full payload
- Pipe the agent into Discord, Telegram, or LINE via the Pipelines system
- Multi-user with role-based access control (Admin / User / Pending)

---

## Features

### Authentication & Multi-User
- Email/password registration and login with bcrypt hashing
- JWT-based sessions (7-day expiry, self-healing token refresh on `/api/auth/me`)
- Login rate limiting (5 attempts per minute per IP/email)
- Role hierarchy: **Super Admin** → **Admin** → **User** → **Pending**
- First registered user becomes Super Admin automatically
- Configurable signup: open or admin-invite only (`ENABLE_SIGNUP`, `DEFAULT_NEW_USER_ROLE`)
- Per-user profile with avatar upload (resized to 200×200 WebP via Sharp)
- Per-user API key overrides (BYOK): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` stored in `user_settings`, cascaded over global keys at agent runtime

### Chat Interface
- Full streaming chat with live tool call events shown inline
- **Human-in-the-Loop approval cards** — review and edit tool arguments before execution
- **Agentic Mode** — propose a multi-step plan, reorder steps by dragging, add custom steps, set a mid-run checkpoint for final review
- Auto-generated conversation titles
- Session sidebar with time-grouped buckets (Pinned / Today / Yesterday / Previous 7 Days / Older)
- Inline session rename, pin/unpin, delete, and JSON export from the context menu
- Collapsible folder groups in the sidebar
- Code blocks with one-click copy
- Collapsible tool call summaries per response (tools used, server, input)
- Hallucination detection for local Ollama models with automatic retry
- Emergency halt button — aborts all active LLM streams and disconnects MCP servers

### MCP Servers
- Register stdio or HTTP/SSE servers with name, command, args, and env vars
- One-click start / stop / restart per server
- Inline edit mode for updating server config (auto-restarts on save)
- Live status badges: `running`, `stopped`, `error`, `unhealthy`
- Tool count display per server
- Auto-reconnect on startup for previously enabled servers
- Environment variable JSON editor with format/validation
- Emergency halt: `/api/mcp/halt` terminates all streams and pauses all servers

### Permission Editor
- Per-server permission policies stored in SQLite
- **Filesystem:** allowed/denied path lists with per-operation toggles (read, write, create, delete, list)
- **Bash:** toggle + glob-pattern allowlist for commands
- **Web Fetch:** toggle + optional domain allowlist
- **Network & Subprocess:** individual toggles
- **Rate Limits:** max calls per minute and max tokens per call
- **Prompt Injection Prevention (PIP):** server-wide toggle with per-tool overrides (inherit / enable / disable)
- **Auto-Approve Reads (Trust Policy):** trusted-path zone for safe read-only tools that skip the approval prompt
- Env var read access is permanently hardcoded `false` in the evaluator — not overridable by anyone
- Auto-saves on every change with toast confirmation

### MCP Catalog
- Curated library of popular MCP servers (Filesystem, Fetch, Memory, Brave Search, GitHub, GitLab, Slack, PostgreSQL, Puppeteer, Google Maps, and more)
- Live integration with the official [MCP Registry](https://registry.modelcontextprotocol.io) (paginated, cached 5 min)
- One-click **Add & Start** installs the server and connects it immediately
- Detects already-installed servers
- Required environment variable keys highlighted per entry
- Search and free-text filtering across title, description, and package name

### Audit Log
- Live feed of every tool call across all sessions
- Columns: timestamp, tool name, target server, outcome (`ALLOWED` / `⚡ AUTO` / `403 DENIED`), latency
- Click any row to expand the full input payload and denial reason
- Filter by server, outcome, or free-text search
- Auto-refreshes every 3 seconds

### Pipelines
- Connect the agent to external chat platforms without code changes
- **Discord** — bot responds in a channel or DM; supports per-reaction approval gate
- **Telegram** — long-polling bot with optional chat ID allowlist
- **LINE** — inbound webhook with signature verification
- Each pipeline shares a conversation session and runs the agent in auto-execute mode
- Start, stop, restart, and edit config without redeploying

### Settings & Admin
- Per-user API key overrides for Anthropic and OpenAI (server keys used as fallback)
- Global workspace settings: default model, temperature, max steps, personality/system prompt, signup policy — Super Admin only
- **Admin Panel** (`/admin`): user management, role assignment, platform stats (user count, session count, DB size)
- Self-healing JWT: fresh token issued on every `/api/auth/me` call reflecting current DB role
- Password change via Settings page; Admin can reset other users' passwords

### LLM Providers
- **Anthropic** (Claude) — full streaming, native tool use blocks
- **OpenAI** (GPT-4o, o-series) — streaming with tool calls
- **Ollama** — local model support with hallucination retry loop

---

## Security Pipeline

Every MCP tool call is evaluated through a multi-stage `PermissionGuard` before execution:

1. **Server registered & running?** → DENY if not
2. **Filesystem path checks**: denied-path list → allowed-path list → per-operation flags (read/write/create/delete)
3. **Bash command glob matching**: against user-configured allowlist patterns
4. **Web fetch domain filtering**: against optional domain allowlist
5. **Subprocess / network toggles**
6. **Env var access**: hardcoded DENY, not user-configurable
7. **Trust Policy**: safe read-only tools in trusted paths → `ALLOW_SILENT` (skip approval prompt)
8. **Prompt Injection Prevention (PIP)**: scrubs tool results to strip embedded instructions

All denials are logged to the activity log with full context and surfaced in real time to the UI.

---

## Deployment

### Docker (Recommended)

**Prerequisites:** Docker v20+ and Docker Compose.

1. Clone the repository:
   ```bash
   git clone https://github.com/OpenMacaw/OpenMacaw.git
   cd OpenMacaw
   ```

2. Create a `.env` file:
   ```env
   AUTH_TOKEN=your_secret_token
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   OLLAMA_BASE_URL=http://localhost:11434
   DEFAULT_MODEL=claude-sonnet-4-5-20250929
   DEFAULT_PROVIDER=anthropic
   ENABLE_SIGNUP=true
   DEFAULT_NEW_USER_ROLE=pending
   ```

   | Variable | Default | Description |
   |---|---|---|
   | `AUTH_TOKEN` | *(none)* | Legacy static token (superseded by JWT login) |
   | `ANTHROPIC_API_KEY` | *(none)* | Anthropic API key (workspace default) |
   | `OPENAI_API_KEY` | *(none)* | OpenAI API key (workspace default) |
   | `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
   | `DEFAULT_MODEL` | `claude-sonnet-4-5-20250929` | Default LLM model |
   | `DEFAULT_PROVIDER` | `anthropic` | Default LLM provider |
   | `ENABLE_SIGNUP` | `true` | Allow new user registration |
   | `DEFAULT_NEW_USER_ROLE` | `pending` | Role assigned to new signups (`user` or `pending`) |
   | `MAX_STEPS` | `50` | Max agentic loop iterations |
   | `TEMPERATURE` | `1.0` | LLM temperature |

3. Start:
   ```bash
   docker compose up -d
   ```
   The app is available at **[http://localhost:3000](http://localhost:3000)**. Data persists in `./data`.

4. Stop:
   ```bash
   docker compose down
   ```

### Manual Docker Build

```bash
docker build -t openmacaw .

docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --restart unless-stopped \
  openmacaw
```

> On Windows PowerShell, replace `$(pwd)` with `${PWD}`.

### Local Development

```bash
npm install
npm run dev        # starts both server (port 3000) and web (port 5173) with hot reload
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20+, Fastify, TypeScript (strict mode) |
| MCP | `@modelcontextprotocol/sdk` |
| Database | SQLite via `better-sqlite3` + Drizzle ORM |
| Frontend | React 18, Vite, Tailwind CSS v3, shadcn/ui |
| State | Zustand + React Query |
| Auth | JWT (`@fastify/jwt`) + bcrypt |
| Streaming | Native WebSocket |
| Image Processing | Sharp (avatar uploads) |

---

## Project Structure

```
/
├── packages/
│   ├── server/src/
│   │   ├── agent/          # Agentic loop, planner, session management, tool interceptor
│   │   ├── db/             # Drizzle schema, migrations, raw SQLite wrapper
│   │   ├── llm/            # Anthropic, OpenAI, Ollama adapters
│   │   ├── mcp/            # MCP client, server registry
│   │   ├── permissions/    # PermissionGuard evaluator + SQLite store
│   │   ├── pipelines/      # Discord, Telegram, LINE pipeline runners
│   │   └── routes/         # Fastify REST + WebSocket routes
│   └── web/src/
│       ├── pages/          # Chat, Servers, Catalog, Permissions, Pipelines, Admin, Settings, etc.
│       ├── components/     # Shared UI components (ServerPermissionDrawer, UserMenu, etc.)
│       └── contexts/       # AuthContext
├── Dockerfile
├── docker-compose.yml
├── AGENTS.md               # Coding standards and architecture reference
├── SECURITY_HARDENING.md   # Threat model and hardening decisions
└── PROMPT_INJECTION_LAYER.md # PIP implementation details
```

---

## Roadmap

### Completed
- [x] Streaming agent runtime with Planner-Executor architecture
- [x] MCP client with stdio and HTTP/SSE transports
- [x] PermissionGuard with filesystem, bash, web, subprocess, and rate limit policies
- [x] Prompt Injection Prevention (PIP) with per-tool overrides
- [x] Auto-approve reads (Trust Policy) for trusted path zones
- [x] Real-time WebSocket chat with inline tool call approval UI
- [x] Agentic mode with drag-to-reorder plan editor and mid-run checkpoint
- [x] Activity audit log with search, filter, and payload inspection
- [x] Discord, Telegram, and LINE pipeline integrations
- [x] MCP Catalog with curated list + live official MCP Registry integration
- [x] Hallucination detection and retry for Ollama models
- [x] Multi-user system: registration, login, roles (Super Admin / Admin / User / Pending)
- [x] Per-user BYOK API keys with cascade resolution (user → global → env)
- [x] Admin panel: user management, role control, platform stats
- [x] Session sidebar with time-grouped buckets, pin, rename, delete, export
- [x] Emergency halt — abort all streams and disconnect all MCP servers

### In Progress / Planned
- [ ] **Chat history page** — paginated view to prevent sidebar overflow on high session counts
- [ ] **Full multi-tenant isolation** — per-user MCP servers, permissions, audit logs, and pipelines
- [ ] **Open WebUI compatibility** — tools, functions, prompts, and models API surface
- [ ] Sandbox mode — isolated execution environments for high-risk tool calls
- [ ] Enhanced canary token leak detection pipeline
- [ ] Session search and tagging
- [ ] Marketplace — community MCP server sharing

---

[Open an Issue](https://github.com/OpenMacaw/OpenMacaw/issues) | [Website](https://openmacaw.com)

---
*Inspired by OpenClaw. Reimagined for safety, precision, and multi-user deployments.*
