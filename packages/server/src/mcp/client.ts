import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import type { ToolDefinition } from '../llm/provider.js';

export interface MCPClientOptions {
  command: string;
  args?: string[];
  envVars?: Record<string, string>;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];
  private connected = false;

  async connect(options: MCPClientOptions): Promise<void> {
    const env = { ...(process.env as Record<string, string>), ...options.envVars };
    
    let command = options.command.trim();
    let args = options.args || [];

    // Parse commands with spaces (e.g. "npx -y @foo/bar")
    if (command.includes(' ') && args.length === 0) {
      const parts = command.split(' ').filter(Boolean);
      command = parts[0];
      args = parts.slice(1);
    }

    // Auto-inject '-y' for npx commands
    if (command === 'npx' || command.endsWith('/npx')) {
      if (!args.includes('-y') && !args.includes('--yes')) {
        args.unshift('-y');
      }
    }

    // Handle command resolution - try to find the executable
    // Only resolve if the command doesn't contain path separators
    if (!command.includes('/') && !command.includes('\\') && !command.includes(':')) {
      const isWindows = process.platform === 'win32';
      
      try {
        let resolved = '';
        
        if (isWindows) {
          // Windows: use `where` command
          const result = execSync(`where ${command}`, { encoding: 'utf-8', env });
          // Take first result (could be .cmd, .bat, or .exe)
          resolved = result.trim().split('\n')[0];
          
          // If npx.cmd exists, use that specifically
          if (command === 'npx' && resolved.includes('npx.cmd')) {
            // npx.cmd is good
          } else if (resolved.endsWith('.exe') && !resolved.endsWith('.cmd')) {
            // For .exe files, also check for .cmd version as it's more reliable
            try {
              const cmdVersion = execSync(`where ${command}.cmd`, { encoding: 'utf-8', env }).trim().split('\n')[0];
              if (cmdVersion && !cmdVersion.includes('not found')) {
                resolved = cmdVersion;
              }
            } catch { /* Use exe version */ }
          }
        } else {
          // Unix: use `which` command
          resolved = execSync(`which ${command}`, { encoding: 'utf-8', env }).trim();
        }
        
        if (resolved && !resolved.includes('not found') && resolved.length > 0) {
          command = resolved;
        }
      } catch {
        // Fallback to exactly what the user provided if not found
      }
    }

    this.transport = new StdioClientTransport({
      command,
      args,
      env,
      stderr: 'pipe', // Intercept errors safely
    });

    let stderrLog = '';
    
    // We bind directly to the PassThrough stream created synchronously by the SDK
    if (this.transport.stderr) {
      this.transport.stderr.on('data', (chunk) => {
        stderrLog += chunk.toString();
      });
    }

    this.client = new Client(
      {
        name: 'openmacaw-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await new Promise<void>((resolve, reject) => {
      let isSettled = false;
      const timeoutMillis = 30000;
      
      const timeoutId = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Connection timed out after ${timeoutMillis}ms. Intercepted Stderr: ${stderrLog.trim()}`));
        }
      }, timeoutMillis);

      if (this.transport) {
         this.transport.onerror = (error) => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeoutId);
              reject(new Error(`Transport error: ${error.message} \nStderr: ${stderrLog.trim()}`));
            }
         };

         this.transport.onclose = () => {
             if (!isSettled) {
               isSettled = true;
               clearTimeout(timeoutId);
               reject(new Error(`Transport closed unexpectedly. Stderr: ${stderrLog.trim()}`));
             }
         };
      }

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
          reject(new Error(`Failed to connect: ${e.message} \nStderr: ${stderrLog.trim()}`));
        }
      });
    });

    // Clear event bindings explicitly now that connection succeeded
    if (this.transport) {
       this.transport.onerror = () => {};
       this.transport.onclose = () => { this.connected = false; };
    }

    await this.loadTools();
  }

  private async loadTools(): Promise<void> {
    if (!this.client) return;

    try {
      const response = await this.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
      );

      this.tools = (response.tools || []).map((tool: { name: string; description?: string; inputSchema: unknown }) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    } catch (e) {
      console.error('Failed to load tools from MCP:', e);
      this.tools = [];
    }
  }

  getTools(): ToolDefinition[] {
    return this.tools;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.connected) {
      throw new Error('Client not connected');
    }

    const response = await this.client.request(
      { 
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        }
      },
      CallToolResultSchema
    );

    return response;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* Ignore */ }
      this.client = null;
    }

    this.transport = null;
    this.connected = false;
  }
}
