/**
 * Unit tests for command-injection prevention and args parsing in routes/servers.ts
 *
 * Tests cover:
 *  - validateCommand() — detects dangerous shell patterns
 *  - normalizeArgs()   — safe args parsing via shell-quote
 */

import { describe, it, expect } from 'vitest';
import { validateCommand, normalizeArgs } from '../../routes/servers.js';

// ── validateCommand() ─────────────────────────────────────────────────────────

describe('validateCommand()', () => {
  // ── Valid commands (should return null) ───────────────────────────────────────
  describe('valid commands — returns null', () => {
    it('allows npx @modelcontextprotocol/server-filesystem', () => {
      expect(validateCommand('npx @modelcontextprotocol/server-filesystem')).toBeNull();
    });

    it('allows node server.js', () => {
      expect(validateCommand('node server.js')).toBeNull();
    });

    it('allows python3 main.py', () => {
      expect(validateCommand('python3 main.py')).toBeNull();
    });

    it('allows uvx some-package', () => {
      expect(validateCommand('uvx some-package')).toBeNull();
    });

    it('allows relative paths like ./my-server', () => {
      expect(validateCommand('./my-server')).toBeNull();
    });

    it('returns null for undefined (HTTP transport — no command)', () => {
      expect(validateCommand(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(validateCommand('')).toBeNull();
    });
  });

  // ── Absolute system binary paths ──────────────────────────────────────────────
  describe('system binary absolute paths — returns error', () => {
    it('blocks /bin/sh', () => {
      expect(validateCommand('/bin/sh')).not.toBeNull();
    });

    it('blocks /bin/bash -c "rm -rf /"', () => {
      expect(validateCommand('/bin/bash -c "rm -rf /"')).not.toBeNull();
    });

    it('blocks /usr/bin/python3', () => {
      expect(validateCommand('/usr/bin/python3')).not.toBeNull();
    });

    it('blocks /usr/local/bin/node', () => {
      expect(validateCommand('/usr/local/bin/node')).not.toBeNull();
    });

    it('blocks /sbin/shutdown', () => {
      expect(validateCommand('/sbin/shutdown')).not.toBeNull();
    });

    it('blocks /usr/sbin/useradd', () => {
      expect(validateCommand('/usr/sbin/useradd')).not.toBeNull();
    });
  });

  // ── Shell metacharacters (injection vectors) ──────────────────────────────────
  describe('shell metacharacters — returns error', () => {
    it('blocks semicolon chaining: node server.js; rm -rf /', () => {
      expect(validateCommand('node server.js; rm -rf /')).not.toBeNull();
    });

    it('blocks double-ampersand: node server.js && evil', () => {
      expect(validateCommand('node server.js && evil')).not.toBeNull();
    });

    it('blocks pipe: node server.js | evil', () => {
      expect(validateCommand('node server.js | evil')).not.toBeNull();
    });

    it('blocks command substitution $(...)', () => {
      expect(validateCommand('node $(cat /etc/passwd)')).not.toBeNull();
    });

    it('blocks backtick command substitution `evil`', () => {
      expect(validateCommand('node `evil`')).not.toBeNull();
    });

    it('blocks single & (background execution)', () => {
      expect(validateCommand('node server.js & evil')).not.toBeNull();
    });
  });

  // ── Error message quality ─────────────────────────────────────────────────────
  describe('error message', () => {
    it('includes a helpful hint to use npx/node/python3/uvx', () => {
      const msg = validateCommand('/bin/sh');
      expect(msg).toContain('npx');
    });
  });
});

// ── normalizeArgs() ───────────────────────────────────────────────────────────

describe('normalizeArgs()', () => {
  // ── Empty / null inputs ───────────────────────────────────────────────────────
  describe('empty inputs', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeArgs(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeArgs('')).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(normalizeArgs('   ')).toBeUndefined();
    });
  });

  // ── JSON array pass-through ───────────────────────────────────────────────────
  describe('JSON array input (pass-through)', () => {
    it('passes through a JSON array unchanged', () => {
      const input = '["--flag1", "--flag2", "--allow", "/workspace"]';
      const result = normalizeArgs(input);
      expect(result).toBeDefined();
      expect(JSON.parse(result!)).toEqual(['--flag1', '--flag2', '--allow', '/workspace']);
    });

    it('wraps a JSON scalar string in an array', () => {
      const result = normalizeArgs('"--single-flag"');
      expect(result).toBeDefined();
      expect(JSON.parse(result!)).toEqual(['--single-flag']);
    });
  });

  // ── Shell-quote parsing for CLI-style strings ─────────────────────────────────
  describe('shell-quote parsing for CLI strings', () => {
    it('splits a simple two-flag string', () => {
      const result = normalizeArgs('--flag1 --flag2');
      expect(result).toBeDefined();
      expect(JSON.parse(result!)).toEqual(['--flag1', '--flag2']);
    });

    it('preserves spaces inside double-quoted arguments', () => {
      const result = normalizeArgs('--allow-path "/my dir/with spaces"');
      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual(['--allow-path', '/my dir/with spaces']);
    });

    it('preserves spaces inside single-quoted arguments', () => {
      const result = normalizeArgs("--root '/path/with spaces'");
      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual(['--root', '/path/with spaces']);
    });

    it('handles a mix of quoted and unquoted tokens', () => {
      const result = normalizeArgs('npx -y @scope/package --dir "/some dir"');
      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual(['npx', '-y', '@scope/package', '--dir', '/some dir']);
    });
  });

  // ── Output is always a valid JSON array string ────────────────────────────────
  describe('output is always parseable JSON', () => {
    it('always returns valid JSON', () => {
      const inputs = [
        '--flag value',
        '["--a","--b"]',
        '--root "/path with spaces"',
      ];
      for (const input of inputs) {
        const result = normalizeArgs(input);
        expect(result).toBeDefined();
        expect(() => JSON.parse(result!)).not.toThrow();
        expect(Array.isArray(JSON.parse(result!))).toBe(true);
      }
    });
  });
});
