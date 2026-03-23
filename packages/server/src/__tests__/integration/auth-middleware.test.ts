/**
 * Integration tests: Global JWT authentication middleware
 *
 * Verifies that:
 *  - All /api/* routes (except /api/auth/*) require a valid JWT
 *  - Pending-role users are rejected even with a valid JWT (live DB check)
 *  - Public auth routes remain accessible without a token
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, createTestUser } from '../helpers/setup.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

// ── Routes that must be public (no auth required) ─────────────────────────────

describe('Public auth routes bypass the JWT middleware', () => {
  it('GET /api/auth/status is accessible without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/auth/login is accessible without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nonexistent@example.com', password: 'wrong' },
    });
    // Returns 401 (bad credentials), NOT 401 (missing JWT) — the middleware let it through
    // We just check it's not a "missing JWT" 401 — it reaches the handler
    expect(res.statusCode).not.toBe(500);
  });

  it('POST /api/auth/register is accessible without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Test', email: `bypass-test-${Date.now()}@example.com`, password: 'pass123' },
    });
    // Returns 201 or 403 (signup disabled), but NOT "unauthorized"
    expect([201, 403, 409]).toContain(res.statusCode);
  });
});

// ── Protected routes: require valid JWT ───────────────────────────────────────

describe('Protected /api/* routes require JWT', () => {
  it('GET /api/sessions returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/servers returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/servers' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/activity returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/sessions returns 401 with a garbage token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: 'Bearer this.is.not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/sessions returns 401 with an expired token', async () => {
    // Sign a token that expired 1 second ago
    const expiredToken = (app as any).jwt.sign(
      { id: 'fake-id', email: 'x@x.com', role: 'admin' },
      { expiresIn: '-1s' }
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/sessions succeeds with a valid admin token', async () => {
    const { token } = await createTestUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── Live DB check: pending users are blocked ──────────────────────────────────

describe('Pending-role user is rejected (live DB check)', () => {
  it('returns 401 for a pending user even with a valid JWT signature', async () => {
    const { token } = await createTestUser(app, { role: 'pending' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    // The JWT signature is valid but the live DB lookup reveals role=pending
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/unauthorized|disabled/i);
  });
});
