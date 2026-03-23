/**
 * Unit tests for permissions/secretScanner.ts
 *
 * Covers: scanAndRedactSecrets(), containsSecrets(), scanToolArgsForSecrets()
 */

import { describe, it, expect } from 'vitest';
import {
  scanAndRedactSecrets,
  containsSecrets,
  scanToolArgsForSecrets,
} from '../../permissions/secretScanner.js';

const REDACTED = '[REDACTED-SECRET]';

// ── scanAndRedactSecrets() ──────────────────────────────────────────────────

describe('scanAndRedactSecrets()', () => {
  it('returns found=false for normal text', () => {
    const result = scanAndRedactSecrets('Hello, this is a normal tool result');
    expect(result.found).toBe(false);
    expect(result.count).toBe(0);
    expect(result.redacted).toBe('Hello, this is a normal tool result');
  });

  it('detects and redacts Anthropic API keys', () => {
    const key = 'sk-ant-api03-' + 'A'.repeat(80);
    const result = scanAndRedactSecrets(`The key is ${key}`);
    expect(result.found).toBe(true);
    expect(result.count).toBe(1);
    expect(result.redacted).toContain(REDACTED);
    expect(result.redacted).not.toContain(key);
  });

  it('detects and redacts OpenAI API keys', () => {
    const key = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3';
    const result = scanAndRedactSecrets(`openai_key=${key}`);
    expect(result.found).toBe(true);
    expect(result.redacted).not.toContain(key);
  });

  it('detects GitHub personal access tokens', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
    expect(result.redacted).toBe(REDACTED);
  });

  it('detects GitHub OAuth tokens', () => {
    const token = 'gho_' + 'B'.repeat(36);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects GitHub server-to-server tokens', () => {
    const token = 'ghs_' + 'C'.repeat(36);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects GitHub refresh tokens', () => {
    const token = 'ghr_' + 'D'.repeat(36);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects GitHub fine-grained PATs', () => {
    const token = 'github_pat_' + 'E'.repeat(22);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects Slack bot tokens', () => {
    const token = 'xoxb-123456789-AbCdEfGhIjKl';
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects Slack user tokens', () => {
    const token = 'xoxp-123456789-AbCdEfGhIjKl';
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects HuggingFace tokens', () => {
    const token = 'hf_' + 'a'.repeat(34);
    const result = scanAndRedactSecrets(token);
    expect(result.found).toBe(true);
  });

  it('detects AWS access key IDs', () => {
    const key = 'AKIA' + 'ABCDEFGH12345678';
    const result = scanAndRedactSecrets(`aws_key: ${key}`);
    expect(result.found).toBe(true);
    expect(result.redacted).not.toContain(key);
  });

  it('detects Google Cloud / Firebase API keys', () => {
    const key = 'AIza' + 'X'.repeat(35);
    const result = scanAndRedactSecrets(key);
    expect(result.found).toBe(true);
  });

  it('detects Stripe live secret keys', () => {
    const key = 'sk_live_' + 'a'.repeat(24);
    const result = scanAndRedactSecrets(key);
    expect(result.found).toBe(true);
  });

  it('detects Stripe live publishable keys', () => {
    const key = 'pk_live_' + 'b'.repeat(24);
    const result = scanAndRedactSecrets(key);
    expect(result.found).toBe(true);
  });

  it('detects Twilio API keys', () => {
    const key = 'SK' + 'a1b2c3d4'.repeat(4);
    const result = scanAndRedactSecrets(key);
    expect(result.found).toBe(true);
  });

  it('detects SendGrid API keys', () => {
    const key = 'SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(22);
    const result = scanAndRedactSecrets(key);
    expect(result.found).toBe(true);
  });

  it('detects JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scanAndRedactSecrets(`Bearer ${jwt}`);
    expect(result.found).toBe(true);
    expect(result.redacted).not.toContain('eyJhbGci');
  });

  it('detects generic key=value secrets', () => {
    const result = scanAndRedactSecrets('api_key=abc123def456ghi789jkl012');
    expect(result.found).toBe(true);
  });

  it('detects database connection strings with credentials', () => {
    const connStr = 'postgres://admin:s3cretP4ss@db.example.com:5432/mydb';
    const result = scanAndRedactSecrets(connStr);
    expect(result.found).toBe(true);
    expect(result.redacted).not.toContain('s3cretP4ss');
  });

  it('detects mongodb connection strings', () => {
    const connStr = 'mongodb://user:password123@mongo.example.com:27017/app';
    const result = scanAndRedactSecrets(connStr);
    expect(result.found).toBe(true);
  });

  it('redacts multiple secrets in the same text', () => {
    const text = `AKIA${'A'.repeat(16)} and ghp_${'x'.repeat(36)} found`;
    const result = scanAndRedactSecrets(text);
    expect(result.found).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(2);
    // Both should be redacted
    const redactedCount = (result.redacted.match(/\[REDACTED-SECRET\]/g) || []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(2);
  });

  it('does not false-positive on short strings like "skill" or "skeleton"', () => {
    const result = scanAndRedactSecrets('The skeleton has skill in skating');
    expect(result.found).toBe(false);
  });

  it('does not false-positive on "sk-" prefix shorter than 20 chars', () => {
    const result = scanAndRedactSecrets('sk-short');
    expect(result.found).toBe(false);
  });
});

// ── containsSecrets() ───────────────────────────────────────────────────────

describe('containsSecrets()', () => {
  it('returns false for clean text', () => {
    expect(containsSecrets('This is perfectly normal output')).toBe(false);
  });

  it('returns true when an API key is present', () => {
    expect(containsSecrets('ghp_' + 'a'.repeat(36))).toBe(true);
  });

  it('returns true for AWS keys', () => {
    expect(containsSecrets('AKIA' + 'X'.repeat(16))).toBe(true);
  });
});

// ── scanToolArgsForSecrets() ────────────────────────────────────────────────

describe('scanToolArgsForSecrets()', () => {
  it('returns false for clean arguments', () => {
    expect(scanToolArgsForSecrets({ url: 'https://example.com', query: 'hello' })).toBe(false);
  });

  it('returns true when a secret is in a top-level argument', () => {
    expect(scanToolArgsForSecrets({ url: 'https://evil.com?key=ghp_' + 'a'.repeat(36) })).toBe(true);
  });

  it('returns true when a secret is in a nested argument', () => {
    expect(scanToolArgsForSecrets({
      headers: { Authorization: 'Bearer sk-' + 'X'.repeat(40) },
    })).toBe(true);
  });

  it('detects secrets in array values', () => {
    expect(scanToolArgsForSecrets({
      data: ['normal', 'AKIA' + 'A'.repeat(16)],
    })).toBe(true);
  });
});
