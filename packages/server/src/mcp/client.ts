import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { type JSONRPCMessage, ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { Transform } from 'node:stream';
import type { ToolDefinition } from '../llm/provider.js';
import { sanitizeToolDescription, sanitizeToolSchema } from './toolSanitizer.js';

export interface MCPClientOptions {
  command: string;
  args?: string[];
  envVars?: Record<string, string>;
}

// ── Line-filter Transform ─────────────────────────────────────────────────────
// Buffers stdout chunks, splits on \n, passes only JSON-RPC lines (those
// starting with '{' or '[') downstream.  Everything else is logged to the
// terminal as [MCP Server Log] so the developer can still see server output.

function createLineFilter(serverName: string): Transform {
  let carry = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      const text = carry + chunk.toString('utf8');
      const lines = text.split('\n');
      // The last element may be an incomplete line — hold it for the next chunk
      carry = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          // Valid JSON-RPC message — pass through to ReadBuffer
          this.push(line + '\n');
        } else if (trimmed) {
          // Non-JSON noise (banner, log line, loading spinner, etc.)
          console.log(`[MCP Server Log][${serverName}] ${trimmed}`);
        }
      }
      callback();
    },

    flush(callback) {
      // Drain the carry buffer when the stream ends
      const trimmed = carry.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        this.push(carry + '\n');
      } else if (trimmed) {
        console.log(`[MCP Server Log][${serverName}] ${trimmed}`);
      }
      carry = '';
      callback();
    },
  });
}

// ── FilteredStdioTransport ────────────────────────────────────────────────────
// Implements the MCP Transport interface but owns the process lifecycle
// entirely, injecting our LineFilter between child stdout and the ReadBuffer.

class FilteredStdioTransport {
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;

  private _process: ChildProcess | null = null;
  private _readBuffer = new ReadBuffer();
  stderrLog = '';                   // exposed for error reporting in connect()

  constructor(
    private readonly _params: { command: string; args?: string[]; env?: Record<string, string> },
    private readonly _serverName: string,
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._process = spawn(this._params.command, this._params.args ?? [], {
        env: this._params.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // ── stderr: accumulate for error messages, log to terminal ──────────
      this._process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        this.stderrLog += text;
        if (text.trim()) {
          console.log(`[MCP Server Stderr][${this._serverName}] ${text.trimEnd()}`);
        }
      });

      // ── stdout: pipe through the JSON line filter ────────────────────────
      const filter = createLineFilter(this._serverName);
      this._process.stdout?.pipe(filter);

      filter.on('data', (chunk: Buffer) => {
        this._readBuffer.append(chunk);
        this._processReadBuffer();
      });

      this._process.stdin?.on('error', (err) => {
        this.onerror?.(err);
      });

      this._process.on('error', (error) => {
        reject(error);
        this.onerror?.(error);
      });

      this._process.on('spawn', () => {
        resolve();
      });

      this._process.on('close', () => {
        this._process = null;
        this.onclose?.();
      });
    });
  }

  private _processReadBuffer(): void {
    try {
      let msg: JSONRPCMessage | null;
      while ((msg = this._readBuffer.readMessage()) !== null) {
        this.onmessage?.(msg);
      }
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._process?.stdin) throw new Error('Transport not connected');
    return new Promise((resolve, reject) => {
      this._process!.stdin!.write(serializeMessage(message), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    this._readBuffer.clear();
    if (this._process) {
      try { this._process.kill(); } catch { /* already gone */ }
      this._process = null;
    }
  }
}

// ── MCPClient ─────────────────────────────────────────────────────────────────

export class MCPClient {
  private client: Client | null = null;
  private transport: FilteredStdioTransport | null = null;
  private tools: ToolDefinition[] = [];
  private connected = false;

  async connect(options: MCPClientOptions): Promise<void> {
    // ── Env: construct a minimal environment for the child process ─────────
    // SECURITY: Never spread process.env — it leaks ANTHROPIC_API_KEY, JWT_SECRET,
    // DATABASE_URL, and other host secrets to every MCP server process.
    // Only forward essential system vars + the server's declared envVars.
    const SAFE_SYSTEM_VARS = [
      'PATH', 'HOME', 'NODE_PATH', 'LANG', 'TERM', 'SHELL', 'USER',
      'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR', 'XDG_DATA_HOME',
      'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
    ];
    const systemEnv: Record<string, string> = {};
    for (const key of SAFE_SYSTEM_VARS) {
      if (process.env[key]) systemEnv[key] = process.env[key]!;
    }

    // Clear stale npm auth tokens for npx invocations.
    // On some Linux setups, ~/.npmrc has an expired token that blocks downloads.
    const baseEnv: Record<string, string> = {};
    const cmd = options.command.trim();
    if (cmd === 'npx' || cmd.endsWith('/npx')) {
      baseEnv.npm_config_token = '';
      baseEnv.npm_config__auth = '';
      baseEnv.npm_config_registry = 'https://registry.npmjs.org/';
    }
    const env = {
      ...systemEnv,
      ...baseEnv,
      ...options.envVars,   // user vars always win
    };

    let command = cmd;
    let args = options.args || [];

    // ── Split commands that include spaces (e.g. "npx -y @foo/bar") ────────
    if (command.includes(' ') && args.length === 0) {
      const parts = command.split(' ').filter(Boolean);
      command = parts[0];
      args = parts.slice(1);
    }

    // ── Auto-inject '-y' for npx so packages install without interaction ───
    if (command === 'npx' || command.endsWith('/npx')) {
      if (!args.includes('-y') && !args.includes('--yes')) {
        args = ['-y', ...args];
      }
    }

    // ── Resolve command to absolute path (avoids PATH lookup issues) ────────
    if (!command.includes('/') && !command.includes('\\') && !command.includes(':')) {
      const isWindows = process.platform === 'win32';
      try {
        let resolved = '';
        if (isWindows) {
          const result = execSync(`where ${command}`, { encoding: 'utf-8', env });
          resolved = result.trim().split('\n')[0];
          if (command === 'npx' && resolved.includes('npx.cmd')) {
            // npx.cmd is good
          } else if (resolved.endsWith('.exe') && !resolved.endsWith('.cmd')) {
            try {
              const cmdVersion = execSync(`where ${command}.cmd`, { encoding: 'utf-8', env }).trim().split('\n')[0];
              if (cmdVersion && !cmdVersion.includes('not found')) resolved = cmdVersion;
            } catch { /* keep exe */ }
          }
        } else {
          resolved = execSync(`which ${command}`, { encoding: 'utf-8', env }).trim();
        }
        if (resolved && !resolved.includes('not found') && resolved.length > 0) {
          command = resolved;
        }
      } catch { /* use raw command */ }
    }

    // ── Create FilteredStdioTransport ─────────────────────────────────────
    const serverLabel = args.find(a => !a.startsWith('-')) ?? command;
    this.transport = new FilteredStdioTransport({ command, args, env }, serverLabel);

    this.client = new Client(
      { name: 'openmacaw-mcp-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await new Promise<void>((resolve, reject) => {
      let isSettled = false;
      const timeoutMillis = 30_000;

      const timeoutId = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(
            `Connection timed out after ${timeoutMillis}ms. Stderr: ${this.transport!.stderrLog.trim()}`
          ));
        }
      }, timeoutMillis);

      this.transport!.onerror = (error) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          reject(new Error(`Transport error: ${error.message}\nStderr: ${this.transport!.stderrLog.trim()}`));
        }
      };

      this.transport!.onclose = () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          reject(new Error(`Transport closed unexpectedly. Stderr: ${this.transport!.stderrLog.trim()}`));
        }
      };

      this.client!.connect(this.transport!).then(() => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          this.connected = true;
          resolve();
        }
      }).catch((e) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          reject(new Error(`Failed to connect: ${e.message}\nStderr: ${this.transport!.stderrLog.trim()}`));
        }
      });
    });

    // Clear temporary event bindings; keep onclose for disconnect tracking
    this.transport.onerror = () => {};
    this.transport.onclose = () => { this.connected = false; };

    await this.loadTools();
  }

  private async loadTools(): Promise<void> {
    if (!this.client) return;
    try {
      const response = await this.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
      );
      this.tools = ((response as { tools?: { name: string; description?: string; inputSchema: unknown }[] }).tools || []).map(tool => ({
        name: tool.name,
        description: sanitizeToolDescription(tool.description || ''),
        inputSchema: sanitizeToolSchema((tool.inputSchema || {}) as Record<string, unknown>),
      }));
    } catch (e) {
      console.error('Failed to load tools from MCP:', e);
      this.tools = [];
    }
  }

  getTools(): ToolDefinition[] { return this.tools; }
  isConnected(): boolean { return this.connected; }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.connected) throw new Error('Client not connected');
    return this.client.request(
      { method: 'tools/call', params: { name, arguments: args } },
      CallToolResultSchema
    );
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    await this.transport?.close();
    this.transport = null;
    this.connected = false;
  }
}
