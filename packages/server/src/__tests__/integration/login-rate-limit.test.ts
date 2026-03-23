/**
 * Integration tests: SQLite-backed login rate limiting
 *
 * Verifies that:
 *  - 5 login attempts from the same IP+email are allowed through (regardless of outcome)
 *  - The 6th attempt from the same IP+email returns 429
 *  - A different email from the same IP is NOT rate-limited
 *  - The rate-limit store persists (within the same process lifetime)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helpers/setup.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

async function loginAttempt(email: string, password = 'wrongpassword') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
    // Fastify's inject() uses '127.0.0.1' as request.ip by default
  });
}

describe('Login rate limiting (5 attempts / 60s per IP+email)', () => {
  it('allows first 5 attempts and blocks the 6th with 429', async () => {
    // Use a unique email to avoid interference with other tests in the file
    const email = `ratelimit-test-${Date.now()}@example.com`;

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await loginAttempt(email);
      statuses.push(res.statusCode);
    }

    // First 5: should be 401 (wrong credentials — user doesn't even exist, but it reaches the handler)
    expect(statuses.slice(0, 5).every(s => s === 401)).toBe(true);

    // 6th: should be 429 Too Many Requests
    expect(statuses[5]).toBe(429);

    const sixthBody = JSON.parse((await loginAttempt(email)).body);
    // 7th attempt is also 429
    expect(sixthBody.error).toMatch(/too many requests/i);
  });

  it('a different email from the same IP is not affected by a different email\'s rate limit', async () => {
    // Exhaust the rate limit for emailA
    const emailA = `rl-a-${Date.now()}@example.com`;
    for (let i = 0; i < 6; i++) {
      await loginAttempt(emailA);
    }

    // emailB should still be allowed (different key = different counter)
    const emailB = `rl-b-${Date.now()}@example.com`;
    const res = await loginAttempt(emailB);
    expect(res.statusCode).toBe(401); // wrong password, but NOT rate-limited (429)
  });

  it('returns a descriptive error message on 429', async () => {
    const email = `rl-msg-${Date.now()}@example.com`;
    for (let i = 0; i < 6; i++) {
      await loginAttempt(email);
    }
    const res = await loginAttempt(email);
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});
