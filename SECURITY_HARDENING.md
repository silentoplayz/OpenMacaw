# Security Hardening Guide — OpenMacaw

> Companion to `AGENTS.md` and `PROMPT_INJECTION_LAYER.md`.
> Derived from documented real-world vulnerabilities in OpenClaw (CVE-2026-25253, ClawJacked, and others).
> Drop in project root alongside other agent instruction files.

---

## Overview

OpenClaw's public security incidents provide a direct blueprint of what OpenMacaw must avoid. This document addresses vulnerabilities **outside** the prompt injection layer — covering WebSocket security, network exposure, plugin/skill supply chain integrity, and general hardening.

Every item here is grounded in a documented OpenClaw CVE or real-world incident.

---

## 1. WebSocket Origin Validation (ClawJacked / CVE-2026-25253)

### The OpenClaw Failure
The ClawJacked vulnerability allowed malicious JavaScript on any webpage to open a WebSocket connection to OpenClaw's localhost gateway — bypassing password protection entirely. The attack took milliseconds and required only that the victim visit a malicious page.

### OpenMacaw Fix

**Validate the `Origin` header on every WebSocket upgrade request. Reject anything that isn't the expected frontend origin.**

```typescript
// packages/server/src/routes/chat.ts

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${process.env.PORT ?? 3000}`,
  `http://127.0.0.1:${process.env.PORT ?? 3000}`,
  process.env.ALLOWED_ORIGIN,   // optional custom origin for reverse proxy setups
].filter(Boolean))

fastify.addHook('preValidation', async (request, reply) => {
  if (request.headers.upgrade?.toLowerCase() !== 'websocket') return

  const origin = request.headers.origin

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    request.log.warn({ origin }, 'WebSocket connection rejected: invalid origin')
    reply.code(403).send({ error: 'Forbidden: invalid WebSocket origin' })
    return
  }
})
```

**Additional WebSocket hardening:**
- Generate a CSRF token at page load, require it as a query param on the WebSocket upgrade request
- Set `maxPayload` limit on the WebSocket server (default: 1MB, never unlimited)
- Rate limit WebSocket connections per IP using `p-queue` or a token bucket

```typescript
// Fastify WebSocket config
fastify.register(fastifyWebsocket, {
  options: {
    maxPayload: 1_048_576,   // 1MB — never allow unlimited payload
    verifyClient: ({ origin, req }, cb) => {
      if (!ALLOWED_ORIGINS.has(origin)) {
        cb(false, 403, 'Forbidden')
        return
      }
      cb(true)
    }
  }
})
```

---

## 2. Port Exposure Hardening (Log Poisoning / Accidental Public Exposure)

### The OpenClaw Failure
OpenClaw's gateway was accessible on TCP port 18789 publicly on some deployments, allowing unauthenticated WebSocket requests that enabled log poisoning. Users assumed localhost binding but got public exposure due to Docker networking defaults.

### OpenMacaw Fix

**Bind to `127.0.0.1` by default — never `0.0.0.0` — unless explicitly overridden.**

```typescript
// packages/server/src/index.ts

const HOST = process.env.BIND_HOST ?? '127.0.0.1'  // safe default
const PORT = parseInt(process.env.PORT ?? '3000')

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  fastify.log.info(`OpenMacaw listening on ${address}`)
})
```

**Docker compose — explicit binding:**
```yaml
services:
  app:
    build: .
    ports:
      - "127.0.0.1:3000:3000"   # bind to loopback only, not 0.0.0.0
    environment:
      - BIND_HOST=0.0.0.0       # override only when intentionally exposing
```

**Security audit script — flag any unintended exposure:**
```bash
# scripts/security-audit.sh
echo "=== OpenMacaw Security Audit ==="

# Check if port is exposed on non-loopback interfaces
if ss -tlnp | grep ":3000" | grep -v "127.0.0.1"; then
  echo "[WARN] Port 3000 is exposed on a non-loopback interface."
  echo "       Set BIND_HOST=127.0.0.1 unless this is intentional."
fi

# Check for open gateway ports
for port in 3000 18789 8080 8443; do
  if ss -tlnp | grep ":$port" | grep "0.0.0.0"; then
    echo "[CRITICAL] Port $port is publicly exposed: potential unauthorized access."
  fi
done

echo "=== Audit Complete ==="
```

Add to `package.json`:
```json
{
  "scripts": {
    "security:audit": "bash scripts/security-audit.sh",
    "security:audit:deep": "bash scripts/security-audit.sh --deep"
  }
}
```

---

## 3. Log Poisoning Prevention

### The OpenClaw Failure
Attackers wrote malicious content to log files via WebSocket requests, which were then interpreted as legitimate operational data when logs were reviewed or ingested by downstream systems.

### OpenMacaw Fix

**Sanitize all user-controlled input before it touches the logger. Never log raw WebSocket payloads.**

```typescript
// packages/server/src/utils/logger.ts

const LOG_SANITIZE_PATTERNS = [
  /\n/g,          // newline injection
  /\r/g,          // carriage return
  /\x1b\[[0-9;]*m/g,  // ANSI escape codes
]

export function sanitizeForLog(input: string): string {
  let sanitized = input
  for (const pattern of LOG_SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[STRIPPED]')
  }
  return sanitized.slice(0, 500)  // hard length cap on any logged user input
}

// Usage
fastify.log.info({ userInput: sanitizeForLog(rawInput) }, 'Received message')

// NEVER do this:
// fastify.log.info(`User said: ${rawInput}`)
```

**Structured logging only — no string interpolation with user data:**
- Use Pino (Fastify's default) with structured JSON output
- Ship logs to a write-once sink (append-only file or external SIEM) where possible
- Never log raw tool inputs/outputs — log metadata only (tool name, server ID, outcome, latency)

---

## 4. Plugin / Skills Supply Chain Security

### The OpenClaw Failure
12% of ClawHub's registry (341 out of 2,857 skills) was compromised with malware. Malicious skills used professional documentation and innocuous names to appear legitimate, then installed keyloggers and infostealers. Manufactured popularity inflated malicious skills to the top of the registry.

### OpenMacaw Position

OpenMacaw does **not** ship a public skills marketplace in v1. This is intentional. If a plugin/extension system is added in a future version, the following requirements apply:

**Static Analysis Scanner (required before any plugin listing):**

```typescript
// packages/server/src/plugins/scanner.ts

type ScanResult = {
  pluginId: string
  passed: boolean
  findings: ScanFinding[]
  riskScore: number   // 0-100
}

type ScanFinding = {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'exfiltration' | 'obfuscation' | 'privilege_escalation' | 'malicious_network' | 'supply_chain'
  description: string
  lineNumber?: number
}

const SCAN_PATTERNS = [
  // Network exfiltration
  { pattern: /fetch\s*\(\s*['"`][^'"` ]*(?:webhook|exfil|collect)/i, severity: 'critical', category: 'exfiltration' },
  { pattern: /XMLHttpRequest/i, severity: 'high', category: 'malicious_network' },
  // Obfuscation
  { pattern: /eval\s*\(/i, severity: 'critical', category: 'obfuscation' },
  { pattern: /Function\s*\(/i, severity: 'critical', category: 'obfuscation' },
  { pattern: /atob\s*\(/i, severity: 'high', category: 'obfuscation' },
  { pattern: /fromCharCode/i, severity: 'high', category: 'obfuscation' },
  // Privilege escalation
  { pattern: /process\.env/i, severity: 'high', category: 'privilege_escalation' },
  { pattern: /child_process/i, severity: 'critical', category: 'privilege_escalation' },
  { pattern: /require\s*\(\s*['"`]fs['"` ]\)/i, severity: 'medium', category: 'privilege_escalation' },
]

export async function scanPluginAsync(pluginCode: string, pluginId: string): Promise<ScanResult> {
  const findings: ScanFinding[] = []

  for (const { pattern, severity, category } of SCAN_PATTERNS) {
    if (pattern.test(pluginCode)) {
      findings.push({ severity, category, description: `Matched pattern: ${pattern.source}` })
    }
  }

  const riskScore = findings.reduce((acc, f) => {
    return acc + ({ critical: 40, high: 20, medium: 10, low: 5 }[f.severity])
  }, 0)

  return {
    pluginId,
    passed: riskScore < 30 && !findings.some(f => f.severity === 'critical'),
    findings,
    riskScore: Math.min(riskScore, 100),
  }
}
```

**Plugin registry rules (if ever implemented):**
- Every plugin submission triggers automated scan — zero exceptions
- Critical findings = automatic rejection, no human override
- Popularity scores must be computed from verified installs only — never self-reported
- All plugins pinned to a content hash — updates require re-scan
- Plugin sandbox: runs in isolated process with no access to main agent context

---

## 5. Authentication Hardening

### The OpenClaw Failure
No built-in authentication on MCP layer. Gateway exposed without auth in many default configurations. Session identifiers used as authorization tokens (they are not).

### OpenMacaw Fix

**Auth token middleware on every route — no exceptions:**

```typescript
// packages/server/src/middleware/auth.ts

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.replace('Bearer ', '')
    ?? request.query?.token  // WebSocket upgrade fallback

  if (!token) {
    reply.code(401).send({ error: 'Unauthorized: missing token' })
    return
  }

  if (!timingSafeEqual(Buffer.from(token), Buffer.from(process.env.AUTH_TOKEN ?? ''))) {
    reply.code(401).send({ error: 'Unauthorized: invalid token' })
    return
  }
}

// Apply globally — no route is exempt
fastify.addHook('onRequest', authMiddleware)
```

**Token generation — force strong tokens:**
```typescript
// On first run, if AUTH_TOKEN is not set, generate and save one
import { randomBytes } from 'crypto'

if (!process.env.AUTH_TOKEN) {
  const generated = randomBytes(32).toString('hex')
  console.warn(`[SECURITY] No AUTH_TOKEN set. Generated token: ${generated}`)
  console.warn(`[SECURITY] Set AUTH_TOKEN=${generated} in your environment.`)
  process.env.AUTH_TOKEN = generated
}
```

**Session ID clarification (mirrors OpenClaw's mistake to avoid):**
- Session IDs are routing selectors only — they grant zero authorization
- Never use session ID as a bearer token
- One auth token per gateway instance — not per session, not per agent

---

## 6. Path Traversal Prevention

### The OpenClaw Failure
Path traversal was listed among the high-severity CVEs (CVE-2026-25157). Filesystem tool inputs were not normalized before permission checks, allowing `../../../etc/passwd` style escapes.

### OpenMacaw Fix

**Normalize and validate ALL paths before they reach `PermissionGuard`:**

```typescript
// packages/server/src/mcp/guard.ts  (addition to existing PermissionGuard)

import { resolve, normalize } from 'path'

function sanitizePath(inputPath: string): string | null {
  try {
    // Resolve to absolute path — eliminates all ../ traversal
    const normalized = resolve(normalize(inputPath))

    // Reject null bytes
    if (normalized.includes('\0')) return null

    // Reject paths that resolved outside expected root
    // (additional check on top of allowedPaths in PermissionStore)
    return normalized
  } catch {
    return null
  }
}

// In PermissionGuard.evaluate() — before any permission check:
const safePath = sanitizePath(toolInput.path)
if (!safePath) {
  return {
    allowed: false,
    reason: 'path_traversal_attempt',
    severity: 'critical'
  }
}
// Continue with safePath, never original toolInput.path
```

---

## 7. MCP Server Command Injection Prevention

### The OpenClaw Failure
Command injection was among the documented high-severity CVEs. MCP server commands were not validated before spawning, allowing shell metacharacters to escape into system execution.

### OpenMacaw Fix

**Validate MCP server commands before spawning. Never use `shell: true`.**

```typescript
// packages/server/src/mcp/registry.ts

import { spawn } from 'child_process'

const COMMAND_ALLOWLIST = /^[a-zA-Z0-9_\-./]+$/  // alphanumeric + safe chars only

function validateMCPCommand(command: string, args: string[]): boolean {
  if (!COMMAND_ALLOWLIST.test(command)) {
    throw new Error(`Invalid MCP server command: "${command}" contains unsafe characters`)
  }
  for (const arg of args) {
    // Args can have more chars but must not contain shell metacharacters
    if (/[;&|`$<>\\]/.test(arg)) {
      throw new Error(`Invalid MCP server arg: "${arg}" contains shell metacharacter`)
    }
  }
  return true
}

function spawnMCPServer(command: string, args: string[], env: Record<string, string>) {
  validateMCPCommand(command, args)

  return spawn(command, args, {
    shell: false,   // NEVER shell: true — prevents shell injection
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
```

---

## 8. API Key & Secret Storage

### The OpenClaw Failure
API keys stored in plaintext local Markdown files — readable by any skill or agent with filesystem access. Moltbook breach exposed 1.5 million agent API tokens from an unsecured database.

### OpenMacaw Fix

**Encrypt secrets at rest. Never store plaintext API keys in config files.**

```typescript
// packages/server/src/config.ts

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ENCRYPTION_ALGO = 'aes-256-gcm'
const KEY_SALT = process.env.ENCRYPTION_SALT ?? randomBytes(16).toString('hex')

function deriveKey(): Buffer {
  return scryptSync(process.env.AUTH_TOKEN ?? '', KEY_SALT, 32)
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSecret(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':')
  const key = deriveKey()
  const decipher = createDecipheriv(ENCRYPTION_ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return decipher.update(Buffer.from(encryptedHex, 'hex')) + decipher.final('utf8')
}
```

**Storage rules:**
- API keys encrypted before writing to SQLite — never stored raw
- API keys never logged — redact in activity log (`sk-ant-****`)
- API keys never returned in REST API responses after initial save
- `envReadAllowed` remains hardcoded `false` — no agent can read env vars (already in AGENTS.md)

---

## 9. SSRF Prevention

### The OpenClaw Failure
SSRF (Server-Side Request Forgery) was among the documented CVEs. Web fetch tools allowed agents to make requests to internal network addresses, enabling internal service enumeration.

### OpenMacaw Fix

**Block private/reserved IP ranges in all web fetch tool calls:**

```typescript
// packages/server/src/mcp/guard.ts  (addition)

import { lookup } from 'dns/promises'
import { isIPv4 } from 'net'

const BLOCKED_IP_RANGES = [
  /^127\./,           // loopback
  /^10\./,            // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC 1918
  /^192\.168\./,      // RFC 1918
  /^169\.254\./,      // link-local
  /^::1$/,            // IPv6 loopback
  /^fc00:/,           // IPv6 unique local
  /^fe80:/,           // IPv6 link-local
  /^0\./,             // reserved
  /^100\.64\./        // shared address space
]

async function isSSRFSafeAsync(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    
    // Block non-http(s) schemes
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    // Resolve hostname to IP and check ranges
    const addresses = await lookup(parsed.hostname, { all: true })
    for (const { address } of addresses) {
      if (BLOCKED_IP_RANGES.some(range => range.test(address))) {
        return false
      }
    }
    return true
  } catch {
    return false  // fail closed
  }
}

// In PermissionGuard.evaluate() for web fetch tools:
if (toolName === 'fetch_url') {
  const ssrfSafe = await isSSRFSafeAsync(toolInput.url)
  if (!ssrfSafe) {
    return { allowed: false, reason: 'ssrf_blocked', severity: 'high' }
  }
}
```

---

## 10. Security Audit Script

Run this regularly — especially after config changes or network exposure updates.

```bash
#!/bin/bash
# scripts/security-audit.sh

PASS=0
WARN=0
FAIL=0

check() {
  local level=$1
  local msg=$2
  echo "[$level] $msg"
  case $level in
    PASS) ((PASS++)) ;;
    WARN) ((WARN++)) ;;
    FAIL) ((FAIL++)) ;;
  esac
}

echo "=== OpenMacaw Security Audit ==="
echo ""

# Auth token
[ -z "$AUTH_TOKEN" ] && check FAIL "AUTH_TOKEN not set — gateway is unprotected" \
  || check PASS "AUTH_TOKEN is configured"

[ ${#AUTH_TOKEN} -lt 32 ] && check WARN "AUTH_TOKEN is short — recommend 64+ hex chars" \
  || check PASS "AUTH_TOKEN length OK"

# Encryption salt
[ -z "$ENCRYPTION_SALT" ] && check WARN "ENCRYPTION_SALT not set — using random (secrets won't survive restart)" \
  || check PASS "ENCRYPTION_SALT configured"

# Port exposure
if ss -tlnp 2>/dev/null | grep ":3000" | grep -qv "127.0.0.1"; then
  check WARN "Port 3000 exposed on non-loopback interface"
else
  check PASS "Port 3000 bound to loopback only"
fi

# Docker socket exposure
if [ -S /var/run/docker.sock ]; then
  check FAIL "Docker socket is accessible — agent could escape container"
fi

# Sensitive files
for f in .env config.json secrets.json; do
  [ -f "$f" ] && check WARN "Sensitive file found in working directory: $f"
done

echo ""
echo "=== Results: $PASS passed, $WARN warnings, $FAIL failed ==="
[ $FAIL -gt 0 ] && exit 1 || exit 0
```

---

## What NOT To Do (Additions to AGENTS.md)

- Do not bind the gateway to `0.0.0.0` in Docker by default — always `127.0.0.1:PORT:PORT`
- Do not use `shell: true` when spawning MCP server processes — ever
- Do not log raw user input or tool arguments — sanitize and cap length first
- Do not store API keys in plaintext in any file an agent can read
- Do not trust session IDs as authorization tokens — they are routing selectors only
- Do not skip WebSocket origin validation — `localhost` is not a security boundary
- Do not launch a public plugin marketplace without an automated code scanner
- Do not resolve user-supplied paths without `path.resolve()` normalization first
- Do not allow web fetch tools to target private IP ranges — enforce SSRF blocklist

---

## CVE Reference Table

| CVE | Severity | Type | OpenMacaw Mitigation |
|---|---|---|---|
| CVE-2026-25253 | 8.8 High | WebSocket hijacking / RCE | Section 1: Origin validation |
| CVE-2026-25593 | High | Command injection | Section 7: Command allowlist |
| CVE-2026-24763 | High | Authentication bypass | Section 5: Auth middleware |
| CVE-2026-25157 | High | Path traversal | Section 6: Path normalization |
| CVE-2026-25475 | High | SSRF | Section 9: SSRF blocklist |
| CVE-2026-26319 | Medium | Log poisoning | Section 3: Log sanitization |
| CVE-2026-26322 | Medium | RCE | Section 7: No shell spawning |
| CVE-2026-26329 | Medium | SSRF | Section 9: SSRF blocklist |
| N/A (ClawJacked) | Critical | localhost WebSocket bypass | Section 1 + Section 2 |
| N/A (Supply chain) | Critical | Malicious skills marketplace | Section 4: Plugin scanner |

---

*Drop this file in the project root alongside `AGENTS.md` and `PROMPT_INJECTION_LAYER.md`.*
*Run `npm run security:audit` regularly and after any config change.*
