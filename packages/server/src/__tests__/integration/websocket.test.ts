/**
 * Integration tests: WebSocket security — JWT authentication & Origin validation
 *
 * Covers:
 *  - JWT auth  : missing token, invalid token, valid token (via Authorization header)
 *  - Origin    : disallowed origin (cross-origin WS attack), missing Origin (non-browser client)
 *  - Backdoor  : /api/chat-test endpoint must not exist (404)
 *
 * Uses a real TCP server bound to a random port because Fastify's inject()
 * does not support WebSocket upgrades.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type AddressInfo } from 'net';
import WebSocket from 'ws';
import { buildTestApp, createTestUser } from '../helpers/setup.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;
let port: number;
let validToken: string;

beforeAll(async () => {
  app = await buildTestApp();
  ({ token: validToken } = await createTestUser(app, { role: 'admin' }));

  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
});

/**
 * Open a WebSocket and wait to see if it stays open or is rejected.
 *
 * Strategy: wait up to 500 ms after the `open` event for a server-initiated
 * `close` event (which carries the rejection code). If no close arrives
 * within the window the connection is considered accepted; we then close it
 * cleanly ourselves.
 *
 * This is necessary because Fastify's WebSocket plugin completes the TCP
 * upgrade before the async route handler runs, so `open` always fires first
 * regardless of whether auth succeeds. The rejection close (4001 / 4003)
 * arrives shortly after.
 */
function wsConnect(url: string, options?: WebSocket.ClientOptions): Promise<{ opened: boolean; closeCode: number }> {
  return new Promise(resolve => {
    const ws = new WebSocket(url, options);
    let didOpen = false;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    function settle(result: { opened: boolean; closeCode: number }) {
      if (settled) return;
      settled = true;
      if (openTimer) clearTimeout(openTimer);
      resolve(result);
    }

    ws.on('open', () => {
      didOpen = true;
      // Give the server a short window to send a close frame (auth rejection).
      openTimer = setTimeout(() => {
        // No server close arrived — connection is genuinely accepted.
        ws.close();
        settle({ opened: true, closeCode: -1 });
      }, 500);
    });

    ws.on('close', (code) => {
      if (didOpen) {
        // Server closed an already-open socket: this is a post-upgrade rejection.
        settle({ opened: false, closeCode: code });
      } else {
        settle({ opened: false, closeCode: code });
      }
    });

    ws.on('error', () => {
      settle({ opened: false, closeCode: 1006 }); // abnormal closure
    });

    // Safety timeout — fail with abnormal close so the test assertion fires.
    setTimeout(() => {
      ws.terminate();
      settle({ opened: false, closeCode: 1006 });
    }, 8000);
  });
}

// ── JWT authentication ────────────────────────────────────────────────────────

describe('WebSocket JWT authentication', () => {
  it('closes with code 4001 when no token is provided', async () => {
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`);
    expect(result.opened).toBe(false);
    expect(result.closeCode).toBe(4001);
  });

  it('closes with code 4001 when an invalid/garbage token is provided', async () => {
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: { authorization: 'Bearer this.is.garbage.jwt' },
    });
    expect(result.opened).toBe(false);
    expect(result.closeCode).toBe(4001);
  });

  it('closes with code 4001 when an expired token is provided', async () => {
    const expiredToken = (app as any).jwt.sign(
      { id: 'fake-user', email: 'x@x.com', role: 'admin' },
      { expiresIn: '-1s' }
    );
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(result.opened).toBe(false);
    expect(result.closeCode).toBe(4001);
  });

  it('upgrades successfully with a valid token in the Authorization header', async () => {
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        origin: 'http://localhost:3000',
      },
    });
    // The connection is established (not rejected) — we accept it as success
    // It will close normally after our wsConnect helper calls ws.close()
    expect(result.opened).toBe(true);
  });
});

// ── Origin validation ─────────────────────────────────────────────────────────

describe('WebSocket Origin validation', () => {
  it('closes with code 4003 when connecting from a disallowed origin', async () => {
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        origin: 'http://evil.com',
      },
    });
    expect(result.opened).toBe(false);
    expect(result.closeCode).toBe(4003);
  });

  it('allows connection from an allowlisted origin (localhost:3000)', async () => {
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        origin: 'http://localhost:3000',
      },
    });
    expect(result.opened).toBe(true);
  });

  it('allows connection with no Origin header (non-browser / server-to-server client)', async () => {
    // Do NOT send an Origin header at all — simulate curl or server-side client
    const result = await wsConnect(`ws://127.0.0.1:${port}/ws/chat`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        // No 'origin' header
      },
    });
    expect(result.opened).toBe(true);
  });
});

// ── Removed /api/chat-test backdoor ──────────────────────────────────────────
// The JWT global middleware fires before Fastify's 404 handler, so unauthenticated
// requests to non-existent routes return 401. Either 401 or 404 proves that the
// backdoor endpoint is not accessible without credentials.

describe('/api/chat-test backdoor is removed', () => {
  it('is not accessible without auth (GET /api/chat-test)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chat-test' });
    // 401 = JWT middleware blocked it (no auth)
    // 404 = route doesn't exist
    // Either proves the backdoor is gone / inaccessible
    expect([401, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it('is not accessible without auth (POST /api/chat-test)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-test',
      payload: { message: 'test' },
    });
    expect([401, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it('does not return a JSON API response for GET /api/chat-test (no real route registered)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-test',
      headers: { authorization: `Bearer ${validToken}` },
    });
    // If the backdoor existed as a real API route it would return JSON with status 200.
    // A 404 (route not found) OR a non-JSON response (SPA catch-all serving index.html)
    // both prove there is no /api/chat-test API handler.
    const isJsonApi = res.statusCode === 200 &&
      String(res.headers['content-type'] ?? '').includes('application/json');
    expect(isJsonApi).toBe(false);
  });
});
