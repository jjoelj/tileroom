// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from './app';
import { sha256 } from './codes';
import { passwordResets, sessions, users } from './db/schema';
import { resetRateLimits } from './http';
import { db } from './runtime/db';
import { call, newUser, ORIGIN, PASSWORD } from './test-utils';

beforeEach(resetRateLimits);

async function setup() {
  const admin = await newUser();
  const user = await newUser();
  db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id)).run();
  const create = () => call(`/admin/users/${user.id}/password-reset`, { method: 'POST', cookie: admin.cookie });
  return { admin, user, create };
}

const redeem = (token: string, password = 'a different secret 42') => call('/auth/reset-password', { method: 'POST', body: { token, password } });

test('only admins list users and issue reset links; issuing does not sign anyone out', async () => {
  const { admin, user, create } = await setup();
  expect((await call('/admin/users', { cookie: user.cookie })).status).toBe(403);
  expect((await call(`/admin/users/${user.id}/password-reset`, { method: 'POST', cookie: user.cookie })).status).toBe(403);
  expect((await call('/admin/users/missing/password-reset', { method: 'POST', cookie: admin.cookie })).status).toBe(404);
  const list = await call('/admin/users', { cookie: admin.cookie });
  expect(list.json.users).toContainEqual({ id: user.id, username: user.username, displayName: expect.any(String) });
  expect(JSON.stringify(list.json)).not.toContain('passwordHash');
  const r = await create();
  expect(r.status).toBe(201);
  const stored = db.select().from(passwordResets).where(eq(passwordResets.userId, user.id)).get()!;
  expect(stored.tokenHash).toBe(sha256(r.json.token));
  expect(stored.expiresAt).toBeGreaterThan(Date.now());
  expect(stored.expiresAt).toBeLessThanOrEqual(Date.now() + 86_400_000);
  expect((await call('/me', { cookie: user.cookie })).status).toBe(200);
});

test('reset validates passwords, revokes all sessions, and can only be used once', async () => {
  const { user, create } = await setup();
  const other = await call('/auth/login', { method: 'POST', body: { username: user.username, password: PASSWORD } });
  const { token } = (await create()).json;
  expect((await redeem(token, 'short')).status).toBe(400);
  expect((await redeem(token, 'basketball')).json.error).toBe('weak_password');
  expect((await redeem(token)).status).toBe(200);
  expect((await redeem(token)).json.error).toBe('reset_invalid');
  expect((await call('/me', { cookie: user.cookie })).status).toBe(401);
  expect((await call('/me', { cookie: other.cookie })).status).toBe(401);
  expect((await call('/auth/login', { method: 'POST', body: { username: user.username, password: PASSWORD } })).status).toBe(401);
  expect((await call('/auth/login', { method: 'POST', body: { username: user.username, password: 'a different secret 42' } })).status).toBe(200);
});

test('replacement, expiry, and ordinary password changes invalidate reset links', async () => {
  const { user, create } = await setup();
  const first = (await create()).json.token;
  const second = (await create()).json.token;
  expect((await redeem(first)).json.error).toBe('reset_invalid');
  db.update(passwordResets).set({ expiresAt: Date.now() - 1 }).where(eq(passwordResets.userId, user.id)).run();
  expect((await redeem(second)).json.error).toBe('reset_invalid');
  const third = (await create()).json.token;
  expect((await call('/me/password', { method: 'POST', cookie: user.cookie, body: { current: PASSWORD, password: 'another new secret 42' } })).status).toBe(200);
  expect((await redeem(third)).json.error).toBe('reset_invalid');
});

test('concurrent submissions consume a reset link exactly once', async () => {
  const { create } = await setup();
  const { token } = (await create()).json;
  const results = await Promise.all([redeem(token), redeem(token)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
});

test('deleted accounts cannot be recovered with a reset link', async () => {
  const { admin, user, create } = await setup();
  const { token } = (await create()).json;
  expect((await call('/me', { method: 'DELETE', cookie: user.cookie, body: { password: PASSWORD } })).status).toBe(200);
  expect((await redeem(token)).json.error).toBe('reset_invalid');
  expect((await create()).status).toBe(404);
  const list = (await call('/admin/users', { cookie: admin.cookie })).json.users as { id: string }[];
  expect(list.some((u) => u.id === user.id)).toBe(false);
});

test('reset redemption checks origin and rate limits guesses', async () => {
  expect((await call('/auth/reset-password', { method: 'POST', origin: 'https://evil.test', body: { token: 'unknown', password: PASSWORD } })).status).toBe(403);
  for (let i = 0; i < 10; i++) expect((await redeem('unknown')).json.error).toBe('reset_invalid');
  expect((await redeem('unknown')).status).toBe(429);
});

test('authenticated requests renew the browser cookie and the database expiry', async () => {
  const user = await newUser();
  db.update(sessions).set({ expiresAt: Date.now() + 60_000 }).where(eq(sessions.userId, user.id)).run();
  for (let i = 0; i < 2; i++) {
    const res = await app.request('/api/me', { headers: { cookie: user.cookie, origin: ORIGIN } });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(user.cookie);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  }
  expect(db.select().from(sessions).where(eq(sessions.userId, user.id)).get()!.expiresAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  await call('/auth/logout', { method: 'POST', cookie: user.cookie });
  expect((await call('/me', { cookie: user.cookie })).status).toBe(401);
});
