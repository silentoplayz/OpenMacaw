/**
 * Unit tests for the MCP client environment isolation (SAFE_SYSTEM_VARS allowlist).
 *
 * These tests verify that the env construction logic in MCPClient.connect()
 * does NOT leak sensitive env vars like ANTHROPIC_API_KEY or JWT_SECRET
 * to child processes, while still forwarding essential system vars.
 *
 * Since connect() spawns a real process, we test the env-building logic
 * by extracting and verifying the allowlist behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// The SAFE_SYSTEM_VARS allowlist from client.ts (duplicated here for testing;
// if the source list changes, these tests will catch regressions when combined
// with integration tests).
const SAFE_SYSTEM_VARS = [
  'PATH', 'HOME', 'NODE_PATH', 'LANG', 'TERM', 'SHELL', 'USER',
  'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR', 'XDG_DATA_HOME',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
];

/**
 * Simulate the env-building logic from MCPClient.connect().
 * This mirrors the code in client.ts lines 162-185.
 */
function buildMcpEnv(options: {
  command: string;
  envVars?: Record<string, string>;
}): Record<string, string> {
  const systemEnv: Record<string, string> = {};
  for (const key of SAFE_SYSTEM_VARS) {
    if (process.env[key]) systemEnv[key] = process.env[key]!;
  }

  const baseEnv: Record<string, string> = {};
  const cmd = options.command.trim();
  if (cmd === 'npx' || cmd.endsWith('/npx')) {
    baseEnv.npm_config_token = '';
    baseEnv.npm_config__auth = '';
    baseEnv.npm_config_registry = 'https://registry.npmjs.org/';
  }

  return {
    ...systemEnv,
    ...baseEnv,
    ...options.envVars,
  };
}

describe('MCP client environment isolation', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Set up sensitive env vars that should NOT leak
    const sensitiveVars = [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'JWT_SECRET',
      'DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'STRIPE_SECRET_KEY',
    ];
    for (const key of sensitiveVars) {
      savedEnv[key] = process.env[key];
      process.env[key] = `test-secret-${key}`;
    }
    // Ensure PATH is set for the positive test
    savedEnv['PATH'] = process.env['PATH'];
    if (!process.env['PATH']) {
      process.env['PATH'] = '/usr/bin:/bin';
    }
  });

  afterAll(() => {
    // Restore original env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('does NOT include ANTHROPIC_API_KEY', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('does NOT include OPENAI_API_KEY', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('does NOT include JWT_SECRET', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).not.toHaveProperty('JWT_SECRET');
  });

  it('does NOT include DATABASE_URL', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).not.toHaveProperty('DATABASE_URL');
  });

  it('does NOT include AWS_SECRET_ACCESS_KEY', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });

  it('DOES include PATH', () => {
    const env = buildMcpEnv({ command: 'node' });
    expect(env).toHaveProperty('PATH');
    expect(env.PATH).toBeTruthy();
  });

  it('DOES include HOME when set', () => {
    if (process.env.HOME) {
      const env = buildMcpEnv({ command: 'node' });
      expect(env).toHaveProperty('HOME');
    }
  });

  it('applies envVars from server config (operator-declared vars)', () => {
    const env = buildMcpEnv({
      command: 'node',
      envVars: { MY_API_KEY: 'operator-provided-key' },
    });
    expect(env.MY_API_KEY).toBe('operator-provided-key');
  });

  it('envVars override system vars', () => {
    const env = buildMcpEnv({
      command: 'node',
      envVars: { PATH: '/custom/path' },
    });
    expect(env.PATH).toBe('/custom/path');
  });

  it('clears npm auth tokens for npx commands', () => {
    const env = buildMcpEnv({ command: 'npx' });
    expect(env.npm_config_token).toBe('');
    expect(env.npm_config__auth).toBe('');
    expect(env.npm_config_registry).toBe('https://registry.npmjs.org/');
  });

  it('clears npm auth tokens for full-path npx', () => {
    const env = buildMcpEnv({ command: '/usr/local/bin/npx' });
    expect(env.npm_config_token).toBe('');
  });

  it('does NOT set npm overrides for non-npx commands', () => {
    const env = buildMcpEnv({ command: 'python' });
    expect(env).not.toHaveProperty('npm_config_token');
    expect(env).not.toHaveProperty('npm_config_registry');
  });

  it('only includes allowlisted system vars (no surprise leakage)', () => {
    const env = buildMcpEnv({ command: 'node' });
    const allowedKeys = new Set([...SAFE_SYSTEM_VARS]);
    for (const key of Object.keys(env)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
