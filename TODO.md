# OpenMacaw — TODO

Based on a full codebase audit (March 2026). Items marked 🔴 are high priority.

---

## 🔴 UI/UX — Chat Sidebar Overflow

- [ ] **Add a Chat History page** (`/chat/history`) — paginated list of all sessions, like Google AI Studio. The sidebar should only show the most recent sessions (e.g. last 10–20).
- [ ] Add a "View all chats →" link at the bottom of the sidebar that navigates to `/chat/history`
- [ ] Chat History page: search by title, date filter, bulk delete
- [ ] Sidebar "Older" group: collapse by default, show count badge + "View all" link once it exceeds ~30 sessions

### General Chat UX
- [ ] Message branching / alternate responses (DB already has `parentId` + `isActive` — UI needs to expose a branching selector)
- [ ] Keyboard shortcut for new chat (`Ctrl/Cmd + N`)
- [ ] Conversation export to Markdown (currently only JSON)
- [ ] Session folders — `folderId` column exists in schema but UI has no folder create/manage UI
- [ ] Search messages within a session
- [ ] Voice input (Web Speech API)

---

## 🔴 Multi-Tenancy / Isolation

> **Current state**: Sessions and messages are scoped to `userId`. MCP servers, permissions, pipelines, and the audit log are **global** (shared across all users) — this causes bleed between accounts.

### Per-User MCP Servers
- [ ] Add nullable `userId` to `servers` table — `NULL` = workspace-wide (admin-managed), non-null = private to that user
- [ ] Server CRUD API must filter by `userId` for non-admin requests
- [ ] Admin panel: expose workspace-shared servers separately from user-private ones
- [ ] MCP Catalog: "Install as private (just me) or shared (workspace)?" prompt for admins

### Per-User Pipelines
- [ ] Add `userId` to `pipelines` table; scope pipeline CRUD to owner
- [ ] Admins see all pipelines; users see only their own

### Per-User Audit Log
- [ ] Add `userId` to `activity_log` table (denormalized from `sessionId → sessions.userId`)
- [ ] `/api/activity` must filter by `userId` for non-admin users; admins get a global view with user filter

### Config Clarity
- [ ] Settings page: clearly label which settings are workspace-wide vs. personal

---

## 🔴 Open WebUI Compatibility

> Implementing the Open WebUI API surface allows OpenMacaw to interoperate with Open WebUI frontends and tools.

### Tools API
- [ ] `GET /api/v1/tools` — list tools in Open WebUI format
- [ ] `POST /api/v1/tools` — register a custom tool
- [ ] `DELETE /api/v1/tools/:id`
- [ ] Map Open WebUI tool calls → MCP server calls through the PermissionGuard

### Functions API
- [ ] `GET/POST /api/v1/functions` — pipe, filter, and action function types
- [ ] Pipe: intercepts/transforms messages before/after LLM
- [ ] Filter: pre/post hooks on every message
- [ ] Action: button-triggered tool call from the UI

### Prompts API
- [ ] `GET/POST/PUT/DELETE /api/v1/prompts` — saved prompt templates
- [ ] Slash-command trigger in chat input (e.g. `/summarize`)
- [ ] Template variables: `{{USER_MESSAGE}}`, `{{CLIPBOARD}}`, etc.
- [ ] Add `prompts` table to DB schema

### Models API
- [ ] `GET /api/v1/models` — unified model list (Anthropic + OpenAI + Ollama) with capability flags (`vision`, `tool_use`, `json_mode`)

### Misc
- [ ] `POST /api/v1/chat/completions` — OpenAI-compatible completions endpoint
- [ ] Bearer token auth on `/api/v1/*` routes

---

## 🔒 Security

> Cross-referenced against OpenClaw CVEs (2026) **and** Invariant Labs MCP Tool Poisoning research (Apr 2025), MCP Safety Audit paper (arXiv:2504.03767), and MCP-Scan vulnerability categories.
> Status: ✅ = mitigated, ⚠️ = partial/gap, 🔴 = not mitigated.

### 🔴 WebSocket Authentication Missing (analog: CVE-2026-25253 "ClawJacked")
OpenClaw's critical ClawJacked flaw was an unauthenticated WebSocket that trusted any local connection and reflected auth tokens. In OpenMacaw:
- [x] **`/ws/chat` has no authentication check** — `chat.ts` route registers the WebSocket handler without verifying the JWT. Any client that can open a WS connection can send messages and execute agent runs against arbitrary sessions. **Add `jwtVerify()` on the WebSocket upgrade request before accepting the connection.**
- [x] **No `Origin` header validation on WebSocket** — browsers allow cross-origin WebSocket connections to `localhost`. A malicious page can connect to a local OpenMacaw instance. **Add an allowlisted `Origin` check (e.g. same host header) on the WS upgrade.**
- [x] **`/api/chat-test` endpoint is unauthenticated** — the HTTP test endpoint at `chat.ts:191` calls `getSession()` and runs the full agent without any `jwtVerify()`. This is a backdoor that bypasses all auth. **Either remove this endpoint or gate it behind auth + dev-only env flag.** *(Removed entirely.)*

### ⚠️ JWT Stored in localStorage (XSS Token Exfiltration)
OpenClaw's ClawJacked attack exfiltrated tokens from LocalStorage. OpenMacaw has the same architecture:
- [ ] **JWT stored in `localStorage`** (`AuthContext.tsx:25`) — readable by any JavaScript on the page (XSS, malicious browser extension, injected script). Consider migrating to `HttpOnly` cookie storage so the token is inaccessible to JS. If localStorage is kept, add a `__Host-` prefixed cookie as a secondary CSRF guard.
- [ ] **`openmacaw_user` object stored in localStorage** — exposes user role, email, and profile data to any XSS. Store only the essential identity fragment or derive it from the token on the client.

### ⚠️ Login Rate Limit Not Persistent (Brute Force Risk)
OpenClaw had no rate limiting at all; OpenMacaw has in-memory rate limiting, but:
- [x] **Rate limit map is in-memory and lost on restart** — `loginAttempts` map in `auth.ts` resets every time the server restarts, allowing unlimited brute force attempts across restarts. Persist counts in Redis or SQLite, or use `@fastify/rate-limit` with a store adapter. *(Now SQLite-backed; survives restarts.)*
- [ ] **Rate limiting only on `/api/auth/login`** — all other endpoints (register, password reset, API key endpoints) are unthrottled. Use `@fastify/rate-limit` globally with per-route overrides.

### ⚠️ Log Poisoning / Indirect Prompt Injection (CVE-2026-2.13 analog)
OpenClaw allowed log poisoning via WebSocket — attacker writes to logs, agent reads logs, logs contain injected instructions:
- [x] **Console logs echo raw tool inputs and user messages** — `chat.ts` logs `userMessage.substring(0, 50)` and tool names. If logs are fed back into the agent context (e.g. for debugging), this is an injection vector. Sanitize all user-controlled values before logging. *(Removed.)*
- [ ] **Tool result content is not sanitized before LLM injection** — malicious file contents or web page responses returned from MCP servers flow directly into the LLM context. The PIP layer exists but is opt-in per server. **Default PIP to ON for all new servers; make disabling it an explicit opt-out.**

### ⚠️ SSRF via Web Fetch (CVE-2026-26322 analog)
OpenClaw's Gateway had a high-severity SSRF that let attackers proxy requests to internal services:
- [x] **Web fetch domain allowlist does not block internal IP ranges** — even with the domain allowlist enabled, a crafted domain (e.g. via DNS rebinding) can resolve to `10.x.x.x`, `192.168.x.x`, `127.x.x.x`, or `169.254.x.x`. Add an outbound SSRF guard: resolve the URL hostname and reject requests to RFC-1918 / loopback / link-local ranges before forwarding. *(Implemented with `dns.lookup()` in evaluator.ts.)*
- [x] **No DNS rebinding protection on webfetch tools** — validate the resolved IP at connection time, not just the hostname string. *(Covered by same fix.)*

### ⚠️ Command Injection via Args Parsing (CVE-2026-24763 analog)
OpenClaw had a command injection in Docker sandbox via unsafe PATH env var handling:
- [x] **`normalizeArgs` falls back to `.split(' ')` string splitting** — in `servers.ts:25`: `argsStr.split(' ').filter(Boolean)`. Space-splitting is unsafe for args containing quoted spaces. This can cause argument injection. Replace with a proper shell-words parser (`shell-quote`, `shlex`) or enforce JSON array format strictly. *(Now uses `shell-quote`.)*
- [x] **No validation on MCP server `command` field** — the command field accepts any string. Validate that it matches an allowlist of known-safe executables (e.g. `npx`, `node`, `python`, `uvx`) and reject absolute paths to system binaries like `/bin/sh`. *(`validateCommand()` added in servers.ts.)*

### ⚠️ Malicious Catalog Package Installs (Malicious ClawHub Skills analog)
OpenClaw's marketplace was exploited with hundreds of malicious skill packages:
- [ ] **Catalog installs use `npx -y` with no integrity verification** — `npx -y` auto-installs any npm package without prompting. A typosquatted or compromised package (e.g. `@modelcontextprotocol/server-filesytem`) installs and runs as the server process. Add npm package provenance verification (npm `--provenance` flag) or compare package checksums against a pinned manifest.
- [ ] **No MCP server command sandboxing** — installed MCP servers run with full user privileges. Consider running them in a restricted subprocess (seccomp/namespaces on Linux, or via Docker).
- [ ] **No warning when installing community registry servers vs. curated servers** — the UI should visually distinguish curated (vetted by OpenMacaw team) from official registry (unvetted third-party) servers with a clear risk label.

### ✅ / ⚠️ Path Traversal (CVE-2026-26329 analog)
OpenClaw had browser-upload path traversal allowing writes outside intended directories:
- [x] **Path normalization exists** — `evaluator.ts` uses `resolvePath()` and `relativePath()` to detect traversal. This correctly handles `../` sequences.
- [x] **Symlink traversal not checked** — `resolvePath` resolves symlinks on the OS, but if an allowed path contains a symlink pointing outside the intended directory, the evaluator will approve it. Add a `realpath()` check that follows symlinks before comparing against allowed paths. *(Fixed: `resolveIncomingPath` now calls `realpathSync()`.)*
- [ ] **Windows path separator normalization** — `evaluator.ts:127` replaces `\` with `/` for Windows paths, but this is done in the evaluator, not at the server command level. MCP server args containing Windows paths passed to `normalizeArgs` are not normalized first.

### ✅ Auth Bypass (CVE-2026-25593 analog)
- [x] **JWT required on all REST routes** — global auth middleware in `index.ts` verifies JWT before any route handler.
- [x] **Self-healing JWT on `/api/auth/me`** — always re-reads role from DB, preventing stale JWT privilege escalation.
- [x] **WebSocket still bypasses global auth middleware** (see first section above — now fixed).

### General Hardening
- [ ] **Canary token leak detection** — inject unique canary strings into tool results; alert if they appear in outbound webfetch/network requests
- [ ] **Sandbox mode** — wrap high-risk tool calls (bash, write, delete) in a container or VM
- [x] **Content-Security-Policy headers** — add strict CSP to all HTML responses to limit XSS blast radius *(Added `onSend` hook in `index.ts` with CSP + X-Frame-Options + X-Content-Type-Options + Referrer-Policy.)*
- [ ] **Tool name collision protection** — two MCP servers with the same tool name must not silently alias; return an error and require manual disambiguation
- [ ] **Mask `isSecret` env var values** in Servers UI (show `••••••` instead of plaintext)
- [x] **Remove all `[DEBUG]` console logs** before any public/production release (`auth.ts`, `chat.ts`) *(Done.)*
- [ ] **Audit log tamper-evidence** — HMAC-sign log entries so they cannot be silently edited
- [x] **Tool poisoning defense** — strip or truncate excessively long tool `description` fields from MCP servers before injecting them into the LLM system prompt (tool metadata is an injection vector) *(Fixed: `toolSanitizer.ts` strips injection markers and caps descriptions at 2000 chars.)*

### 🔴 MCP Tool Poisoning Attacks (Invariant Labs TPA — Apr 2025)
> Invariant Labs demonstrated that malicious instructions hidden in MCP tool `description` fields are invisible to users but fully visible to the LLM. A poisoned `add` tool can instruct the LLM to read `~/.ssh/id_rsa` and exfiltrate it via a hidden parameter. This affects all MCP hosts (Cursor, Claude Desktop, OpenClaw, OpenMacaw).

- [x] 🔴 **Tool descriptions injected into LLM context unsanitized** — `client.ts:loadTools()` stores descriptions verbatim; `anthropic.ts` and `openai.ts` pass `tool.description` directly to the provider API with **no length cap, no sanitization, no injection pattern stripping**. Implement: (a) hard length cap on descriptions (e.g. 2000 chars), (b) strip `<IMPORTANT>`, `[SYSTEM]`, `[INST]`, and other prompt injection markers from descriptions, (c) show full raw descriptions to the user in the Servers UI for manual review. *(Fixed: `toolSanitizer.ts` enforces 2000-char cap and strips 30+ injection marker patterns from descriptions and schemas.)*
- [x] 🔴 **Tool input schemas not validated against advertised schema** — MCP tools can declare hidden parameters (e.g. `sidenote`) that the LLM fills with exfiltrated data. The permission evaluator does not inspect or restrict which parameters the LLM populates. Add a schema-enforcement layer that rejects tool calls with unexpected parameters not in the approved schema. *(Fixed: `validateToolCallArgs()` in `toolSanitizer.ts` rejects tool calls with undeclared parameters.)*
- [ ] **No user visibility into full tool descriptions** — the Servers UI shows tool names but not the full raw descriptions that the LLM sees. Add a "View raw description" expander per tool so users can inspect for hidden instructions.

### 🔴 MCP Rug Pulls / Tool Description Mutation (Invariant Labs — Apr 2025)
> A malicious MCP server can initially advertise benign tool descriptions to pass user review, then silently change them on reconnect/restart to include poisoned instructions. No MCP host currently detects this.

- [ ] 🔴 **No tool pinning or description hashing** — `client.ts:loadTools()` replaces the tool list in memory on every `connect()` call with no comparison to previously-approved versions. Implement: (a) SHA-256 hash each tool's `(name, description, inputSchema)` on first registration, (b) on reconnect, compare hashes and alert the user if any tool changed, (c) require explicit re-approval for changed tools before they become available to the agent.
- [ ] **No `tools/list_changed` notification handling** — the MCP protocol supports server-initiated notifications when tools change. OpenMacaw does not listen for these. Implement the handler and trigger a re-hash + user alert.

### 🔴 Cross-Server Tool Shadowing (Invariant Labs — Apr 2025)
> A malicious MCP server can inject instructions in its tool description that override behavior of tools from *other* trusted servers, even if the malicious tool is never called directly.

- [ ] **Cross-server instruction isolation** — tool descriptions from one MCP server can reference and modify behavior of tools from another server. Add per-server instruction isolation: (a) prepend each tool description with `[Server: <name>]` context, (b) add system prompt instructions explicitly forbidding cross-server instruction following, (c) warn in the UI when a tool description mentions another server's tool names.
- [ ] **Tool description cross-reference scanning** — scan new tool descriptions for references to other registered server names or tool names. Flag for user review if cross-references are detected.

### 🔴 Credential Theft via process.env Leakage (MCP Safety Audit — arXiv:2504.03767)
> The MCP Safety Audit paper demonstrated credential theft attacks where MCP tools (e.g. `printEnv` from the Everything server) expose environment variables containing API keys, and multi-server RADE attacks where stolen credentials are exfiltrated via Slack or web fetch tools.

- [x] 🔴 **`process.env` spread to child MCP server processes** — `client.ts:168` passes `...(process.env as Record<string, string>)` to every spawned MCP server, exposing `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, and all other host secrets to every MCP server process. **This completely undermines the env var access control.** Fix: construct a minimal env object containing only the server's declared `envVars` + essential system vars (`PATH`, `HOME`, `NODE_PATH`), never spread `process.env`. *(Fixed: now only forwards `PATH`, `HOME`, `NODE_PATH`, `LANG`, `TERM`, `SHELL`, `USER`, `TMPDIR`, `TMP`, `TEMP`, and XDG dirs + declared envVars.)*
- [x] **`envReadAllowed` heuristic is trivially bypassable** — `evaluator.ts:141` only checks for `'env' in toolInput || 'environment' in toolInput`. A tool using parameter names like `variables`, `environ`, `envVars`, `config_vars`, or `system_info` bypasses this check entirely. Replace the keyword heuristic with a proper deny-by-default approach: inspect all tool results for patterns matching API key formats (`sk-ant-*`, `sk-*`, `hf_*`, `ghp_*`, `xoxb-*`, etc.). *(Fixed: expanded to 18 env-related parameter name synonyms with case-insensitive matching.)*

### 🔴 Secret Exfiltration via Tool Results / Outbound Args (MCP Safety Audit — arXiv:2504.03767)
> RADE (Retrieval-Agent Deception) attacks demonstrated end-to-end credential theft: a poisoned file is read by an MCP tool, its contents (including exfiltration instructions) are injected into the LLM context, the LLM then uses another tool (web fetch, Slack, email) to send the stolen data to the attacker.

- [x] 🔴 **No scanning of tool results for leaked secrets** — tool results from MCP servers are passed directly into the LLM conversation context (`runtime.ts:536`) with no scanning for credential patterns. Implement a secret-detection scanner that checks all tool results for patterns matching known API key formats and redacts them before LLM injection. *(Fixed: `secretScanner.ts` scans and redacts 15+ credential patterns before injecting results into LLM context.)*
- [x] 🔴 **No scanning of outbound tool call arguments for exfiltrated data** — the LLM can pass stolen credentials as arguments to web fetch, email, or messaging tools. Add an outbound argument scanner in the PermissionGuard that checks tool call arguments for credential-like patterns and blocks/flags the call. *(Fixed: outbound tools are scanned for credential patterns before execution; blocked if secrets detected.)*
- [ ] **No data-flow taint tracking between servers** — data read by Server A's tools can be passed to Server B's tools without restriction. Implement per-server data boundaries: tag tool results with their source server ID and warn/block when data from one server flows to another server's outbound tools.

### ⚠️ WebSocket Hardening Gaps
- [x] **No `maxPayload` on WebSocket** — `app.ts:52` registers `@fastify/websocket` with no options; defaults to ~100MB `maxPayload`. Set `maxPayload: 1_048_576` (1MB) to prevent memory exhaustion from oversized messages. *(Fixed: `maxPayload: 1_048_576` set in `app.ts`.)*
- [ ] **No WebSocket message rate throttling** — authenticated clients can flood the WebSocket with unlimited messages. Add per-connection message rate limiting (e.g. 10 messages/second).
- [ ] **No CSRF token on WebSocket upgrade** — the Origin check provides partial protection, but a dedicated CSRF token (generated at page load, required as query param on WS upgrade) would add defense-in-depth.
- [x] **WebSocket session ownership not enforced** — `chat.ts:115` calls `getSession(sessionId)` without `userId`, allowing any authenticated user to interact with any other user's session via WebSocket. Pass `userId` from the JWT payload and verify ownership. *(Fixed: `getSession(sessionId, authenticatedUserId)` now enforced on both `chat` and `regenerate` message types.)*

### ⚠️ Network / Deployment Hardening
- [x] **Bind host hardcoded to `0.0.0.0`** — `index.ts:24` binds to all interfaces with no override. Add `HOST` env var (default `127.0.0.1` for non-Docker, `0.0.0.0` for Docker). Document in docker-compose.yml. *(Fixed: uses `HOST` env var, defaults to `127.0.0.1` unless `DOCKER` env is set.)*
- [x] **Hardcoded JWT secret fallback** — `app.ts:54` uses `'super-secret-openmacaw-key-change-me'` when `JWT_SECRET` is not set. In production this allows trivial token forgery. Generate a random secret on first run and persist it, or refuse to start without an explicit `JWT_SECRET`. *(Fixed: production refuses to start without `JWT_SECRET`; dev uses random ephemeral secret.)*

### ⚠️ API Key / Secret Storage
- [ ] **API keys stored as plaintext in SQLite** — `userSettings.value` and `settings.value` columns store ANTHROPIC_API_KEY, OPENAI_API_KEY as raw text. Implement AES-256-GCM encryption at rest (see `SECURITY_HARDENING.md` Section 8 for reference implementation).
- [ ] **MCP server env vars stored as plaintext JSON** — `servers.env_vars` column stores sensitive values (API tokens, credentials) as plaintext JSON strings. Encrypt before storing; decrypt only when spawning the server process.
- [ ] **API keys returned in REST API responses** — settings endpoints may return raw API key values. Redact secrets in API responses (return `sk-ant-****` instead of full key) except at the moment of initial save.

---

## 🤖 Agent Capabilities

- [ ] **Context compaction** — summarize older messages when history grows large and continue seamlessly
- [ ] **Parallel tool calls** — execute multiple concurrent tool calls when the LLM requests them simultaneously
- [ ] Tool call retry on transient MCP failures (exponential backoff)
- [ ] Add Google Gemini as an LLM provider
- [ ] Add Mistral / Groq provider adapters
- [ ] Streaming token usage display (live counter during generation)
- [ ] Agent memory across sessions (native store or Memory MCP server integration)

---

## 🏗️ Infrastructure

- [ ] **Versioned DB migrations** — replace single-snapshot `migrate.ts` with a proper migration runner (e.g. `drizzle-kit migrate`)
- [ ] `GET /api/health` endpoint — DB status, MCP server statuses, uptime
- [ ] Graceful shutdown — drain in-flight requests and MCP connections before exit
- [ ] Structured logging — replace `console.log` with `pino` (Fastify native)
- [ ] Docker multi-arch build (`linux/amd64` + `linux/arm64`) for Raspberry Pi / Apple Silicon
- [ ] Optional PostgreSQL backend (Drizzle supports it — add a PG adapter + env toggle)
- [ ] S3/R2 storage for avatar images instead of base64-in-SQLite

---

## 🧪 Testing

- [x] Unit tests for `PermissionGuard` evaluator (path traversal, glob matching, trust policy edge cases) — 26 tests via Vitest
- [x] Integration tests for auth flows (register, login, rate limit, pending approval) — 13 tests via Vitest
- [x] Integration tests for WebSocket JWT auth & origin validation — 10 tests via Vitest
- [x] Integration tests for HTTP security headers (CSP, X-Frame-Options, etc.) — 6 tests via Vitest
- [x] Unit tests for command injection prevention (`validateCommand`, `normalizeArgs`) — 30 tests via Vitest
- [ ] E2E test: start MCP server → chat message → tool call → approval → result
- [ ] Pipeline integration tests (Discord, Telegram mocks)
- [ ] Load test: WebSocket streaming under concurrent users
- [ ] Fuzz: tool inputs with path traversal payloads against the evaluator

---

## 📝 Developer Experience

- [ ] OpenAPI / Swagger spec at `/api/docs` (auto-generated from Fastify schemas)
- [ ] `CONTRIBUTING.md` — setup guide, conventions, PR checklist
- [ ] `CHANGELOG.md` with versioned release notes
- [ ] Dev seed script: demo users, servers, sessions for local testing
- [ ] Auto-generate env var docs from the Zod config schema

---

---

## 🧩 Skills System

> **Current state**: Agent behavior is defined entirely by the global/session system prompt and MCP server tool descriptions. There is no way to save, share, or reuse task-specific instruction sets across sessions. OpenClaw's "ClawHub Skills" solved this but allowed arbitrary command execution — OpenMacaw's approach is instruction-only, with all tool calls still gated through the PermissionGuard.
> **Implementation order**: Skills System → Scheduled Automation → Self-Improving Agent.

### Database
- [ ] **Add `skills` table** — columns: `id` (UUID PK), `name` (text, unique per scope), `description` (text), `instructions` (text — markdown body), `toolHints` (JSON — suggested MCP tools the skill works best with), `triggers` (JSON — slash-command names, keyword patterns), `userId` (nullable FK → `users.id` — `NULL` = workspace-global), `isGlobal` (boolean), `enabled` (boolean, default true), `createdAt`, `updatedAt`
- [ ] **Add `skill_versions` table** — columns: `id`, `skillId` (FK), `version` (integer, auto-increment per skill), `instructions` (text — snapshot of instructions at this version), `changedBy` (FK → `users.id`), `changeNote` (text, nullable), `createdAt` — append-only history for rollback and audit

### Agent Runtime Integration
- [ ] **Skill loader in agent runtime** — before each LLM call, query active skills for the current session/user and concatenate their `instructions` into the system prompt (integration point: `runtime.ts` where `session.systemPrompt` is already injected). Skills append after the base system prompt, separated by `---` delimiters with skill name headers
- [ ] **Per-session skill activation** — sessions can enable/disable individual skills; store as a JSON array of skill IDs on the session or in a `session_skills` join table
- [ ] **Tool hint injection** — when a skill declares `toolHints`, include a note in the system prompt suggesting the agent use those specific MCP tools for the skill's task
- [ ] **Slash-command trigger in chat input** — if a skill declares triggers (e.g. `/summarize`, `/review`), intercept the chat input, match against registered triggers, and prepend the skill's instructions to the user message before sending to the agent

### API Routes (`/api/skills`)
- [ ] `GET /api/skills` — list skills visible to the authenticated user (own + global); support `?search=`, `?global=`, `?enabled=` query filters
- [ ] `POST /api/skills` — create a skill; non-admins can only create personal skills (`userId` = self, `isGlobal` = false); admins can create global skills
- [ ] `PUT /api/skills/:id` — update a skill; creates a new `skill_versions` entry before overwriting `instructions`
- [ ] `DELETE /api/skills/:id` — soft-delete or hard-delete a skill; only the owner or an admin can delete
- [ ] `GET /api/skills/:id/versions` — list version history for a skill
- [ ] `POST /api/skills/:id/revert/:versionId` — revert a skill's instructions to a previous version

### Web UI — Skills Management Page
- [ ] **Skills page** (`/skills`) — paginated list of all accessible skills with search, filter by scope (personal / global), and enable/disable toggles
- [ ] **Skill editor** — create/edit form with name, description, markdown instructions editor (with preview), tool hints multi-select (populated from registered MCP tools), trigger configuration
- [ ] **Skill detail view** — read-only view with version history timeline and diff viewer
- [ ] **Session skill picker** — in the chat UI, add a skill selector (popover or sidebar panel) to activate/deactivate skills for the current session
- [ ] **Sidebar integration** — show active skill count badge on the chat input area; click to manage

### Import / Export
- [ ] **Skill import from SKILL.md** — parse markdown files with YAML frontmatter (`name`, `description`, `triggers`, `toolHints`) into the `skills` table; support drag-and-drop upload or file picker on the Skills page. Compatible with OpenClaw's SKILL.md format
- [ ] **Skill export to markdown** — download a skill as a `.md` file with YAML frontmatter for portability and version control
- [ ] **Bulk import from directory** — scan a folder for `*.skill.md` files and batch-import

### Scoping & Permissions
- [ ] **Per-user vs workspace-global scoping** — admins can create global skills visible to all users; regular users can only create personal skills scoped to their `userId`
- [ ] **Skill visibility rules** — users see their own skills + all enabled global skills; admins see everything with an owner filter
- [ ] **Skill approval for global promotion** — optional workflow: user submits a personal skill for global promotion → admin reviews and approves/rejects

### Versioning
- [ ] **Automatic version tracking** — every update to a skill's `instructions` field creates a `skill_versions` entry with the previous content, version number, and author
- [ ] **Diff viewer in UI** — show side-by-side or inline diff between any two versions of a skill
- [ ] **Rollback** — one-click revert to a previous version (creates a new version entry pointing to the old content)

---

## 🧠 Self-Improving Agent

> **Current state**: The agent can use MCP tools but cannot create new skills, modify its own instructions, or install new capabilities. OpenClaw allowed skills to self-modify and execute arbitrary code — this led to the "Malicious ClawHub Skills" exploit chain. OpenMacaw's approach is security-hardened: all self-improvement actions are **proposals requiring human approval**, never silent mutations.
> **Depends on**: Skills System must be implemented first.

### Internal Agent Tools
- [ ] **`create_skill` tool** — the agent can call this to propose a new skill with a name, description, and instructions body. The proposal is surfaced to the user as an approval card in the chat UI (similar to tool call approval). On approval, the skill is persisted to the `skills` table as a personal skill owned by the session's user. On denial, the proposal is discarded with optional feedback
- [ ] **`update_skill` tool** — the agent can propose modifications to an existing skill's instructions. Shows a diff in the approval card. On approval, creates a new `skill_versions` entry and updates the skill. The agent must reference an existing skill by ID or name
- [ ] **`install_mcp_server` tool** — the agent can propose installing a new MCP server from the Catalog (reuses the existing one-click install flow from `/api/registry`). The proposal card shows the server name, package, description, and a security risk label (curated vs. community). On approval, the server is registered and started via the existing `registry.ts` → `servers.ts` flow

### Skill Suggestions
- [ ] **Post-task skill suggestion** — after completing a multi-step task (detected by agent step count or tool call diversity), the agent can suggest creating a reusable skill from the workflow it just performed. The suggestion includes a draft skill name, description, and distilled instructions
- [ ] **Suggestion suppression** — user can dismiss suggestions with "Don't suggest this again" (stored as a user preference) to avoid repetitive prompts
- [ ] **Suggestion quality gate** — only suggest skills when the workflow involved 3+ distinct tool calls or spanned 5+ agent steps, to avoid trivial suggestions

### Safety & Approval
- [ ] **All self-improvement actions require human-in-the-loop approval** — the agent cannot silently create, modify, or delete skills. Every mutation surfaces an approval card in the chat UI with full details of the proposed change
- [ ] **Approval card UI** — rich approval cards for `create_skill`, `update_skill`, and `install_mcp_server` proposals, showing the full content/diff and approve/deny buttons with optional feedback textarea
- [ ] **Audit trail** — all self-improvement proposals (approved and denied) are logged to the `activity_log` with action type `skill_proposal` / `server_install_proposal`
- [ ] **Rate limiting** — cap the number of self-improvement proposals per session (e.g. max 5 per session) to prevent agent loops that repeatedly propose skills
- [ ] **No silent execution** — unlike OpenClaw where skills could execute arbitrary commands, OpenMacaw skills are instruction-only. The agent's proposed skills go through the same PermissionGuard pipeline as all other tool calls — skills cannot bypass permission checks

---

## ⏰ Scheduled Automation

> **Current state**: Agent runs are triggered by user messages (chat) or external platform messages (Discord/Telegram/LINE pipelines). There is no way to run the agent on a timer. Architecturally similar to pipelines — a background runner calling the agent runtime on a trigger — just timer-triggered instead of message-triggered.
> **Depends on**: Skills System (for skill-based schedules). Can be built in parallel with Skills for the prompt-only mode.

### Database
- [ ] **Add `schedules` table** — columns: `id` (UUID PK), `userId` (FK → `users.id`), `sessionId` (FK → `sessions.id`, nullable — `NULL` = create a new session per run), `name` (text), `cronExpression` (text — standard 5-field cron), `skillId` (FK → `skills.id`, nullable — if set, run this skill's instructions as the prompt), `prompt` (text — freeform prompt used when `skillId` is null), `enabled` (boolean, default true), `lastRun` (timestamp, nullable), `nextRun` (timestamp), `status` (text — `idle` / `running` / `error`), `errorMessage` (text, nullable), `createdAt`, `updatedAt`
- [ ] **Add `schedule_runs` table** — columns: `id`, `scheduleId` (FK), `sessionId` (FK — the session used for this run), `startedAt`, `completedAt`, `status` (text — `success` / `error` / `timeout`), `errorMessage` (text, nullable), `toolCallCount` (integer), `tokenUsage` (JSON, nullable) — run history for debugging and monitoring

### Scheduler Service
- [ ] **Scheduler loop** — a lightweight service (using `node-cron` or a simple `setInterval` loop) that checks `schedules` table for rows where `enabled = true` and `nextRun <= now()`. On match, enqueue the run and update `nextRun` based on `cronExpression`
- [ ] **Run execution** — each scheduled run creates or reuses a session, injects the `prompt` (or the referenced skill's `instructions`), and calls the agent runtime in `autoExecute` mode (same pattern as pipeline runs in `pipelines/`)
- [ ] **Concurrency control** — only one run per schedule at a time; if a run is still in progress when the next trigger fires, skip and log a warning
- [ ] **Timeout** — configurable per-schedule timeout (default 5 minutes); kill the agent run if it exceeds the limit
- [ ] **Error handling** — on failure, set `status = 'error'`, store `errorMessage`, and optionally disable the schedule after N consecutive failures (configurable)

### API Routes (`/api/schedules`)
- [ ] `GET /api/schedules` — list schedules for the authenticated user; admins see all with user filter
- [ ] `POST /api/schedules` — create a schedule; validate cron expression, resolve `skillId` if provided
- [ ] `PUT /api/schedules/:id` — update a schedule; recalculate `nextRun` on cron change
- [ ] `DELETE /api/schedules/:id` — delete a schedule and its run history
- [ ] `POST /api/schedules/:id/run` — manually trigger an immediate run (bypasses cron timing)
- [ ] `GET /api/schedules/:id/runs` — paginated run history with status, duration, token usage

### Web UI — Schedules Management Page
- [ ] **Schedules page** (`/schedules`) — list of all schedules with name, cron expression (human-readable), next run time, last run status, and enable/disable toggle
- [ ] **Schedule editor** — create/edit form with name, cron builder (visual cron picker or freeform input with validation + human-readable preview), prompt textarea or skill selector dropdown, session reuse toggle, timeout configuration
- [ ] **Run history view** — per-schedule run log showing start/end times, status, error messages, token usage, and a link to the session used for each run
- [ ] **Next run preview** — show the next 5 scheduled fire times based on the cron expression for verification

### Permissions & Security
- [ ] **Owner-scoped execution** — scheduled runs use the schedule owner's `userId` for permission resolution, BYOK API key cascade (same as the existing `userSettings` → `settings` fallback), and session ownership
- [ ] **Security policy per schedule** — configurable per schedule: `autoExecute` (full autonomy — all tool calls execute without approval, same as pipeline mode) or `queueApproval` (high-risk tool calls are queued for approval — the user reviews them on next visit to the Schedules page or via notification)
- [ ] **Notification on completion** — optional webhook, email, or in-app notification when a scheduled run completes or errors
- [ ] **Schedule CRUD scoped to owner** — users can only manage their own schedules; admins can view/manage all

### Integration with Skills
- [ ] **Skill-based schedules** — a schedule can reference a `skillId` instead of a freeform `prompt`; on run, the skill's current `instructions` are used as the agent prompt. This means updating the skill automatically updates all schedules that reference it
- [ ] **Quick-schedule from skill** — on the Skills page, add a "Schedule this skill" action that pre-fills the schedule editor with the skill reference

---

*Last updated: March 2026 — security section expanded with Invariant Labs TPA, MCP Safety Audit (arXiv:2504.03767), and full codebase audit findings*
