// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invites, users } from './db/schema';
import { resetRateLimits } from './http';
import { db } from './runtime/db';
import { call, makeInvite, newUser, PASSWORD, pushesTo } from './test-utils';

beforeEach(resetRateLimits);

const signup = (inviteCode: string, username: string, password = PASSWORD) =>
  call('/auth/signup', { method: 'POST', body: { inviteCode, username, password, displayName: 'Sam' } });

const userCount = (username: string) => db.select().from(users).where(eq(users.username, username)).all().length;

describe('signup', () => {
  test('creates the account, signs in, consumes the invite', async () => {
    const code = makeInvite();
    const r = await signup(code, 'Sam_1');
    expect(r.status).toBe(200);
    const me = await call('/me', { cookie: r.cookie });
    expect(me.json).toMatchObject({ username: 'sam_1', displayName: 'Sam', isAdmin: false, pushReady: false, remindTurn: true });
    expect((await signup(code, 'sam_2')).json.error).toBe('invite_invalid');
    expect(userCount('sam_2')).toBe(0);
  });

  test('codes are normalized: case, dashes, spaces, look-alikes', async () => {
    const code = makeInvite();
    const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect((await call('/invites/check', { method: 'POST', body: { inviteCode: typed } })).json).toEqual({ valid: true, invitedBy: null });
    expect((await signup(typed, 'norm_user')).status).toBe(200);
  });

  test('unknown, revoked or expired codes create nothing', async () => {
    expect((await signup('AAAA-BBBB-CCCC', 'nobody1')).json.error).toBe('invite_invalid');
    const revoked = makeInvite();
    db.delete(invites).where(eq(invites.codeHint, revoked.slice(-4))).run(); // revoking deletes it
    const expired = makeInvite();
    db.update(invites).set({ expiresAt: Date.now() - 1 }).where(eq(invites.codeHint, expired.slice(-4))).run();
    expect((await signup(revoked, 'nobody2')).json.error).toBe('invite_invalid');
    expect((await signup(expired, 'nobody3')).json.error).toBe('invite_invalid');
    expect(userCount('nobody1') + userCount('nobody2') + userCount('nobody3')).toBe(0);
  });

  test('failed validation does not consume the code', async () => {
    const code = makeInvite();
    const taken = await newUser();
    expect((await signup(code, taken.username)).json.error).toBe('username_taken');
    expect((await signup(code, 'short_pw', 'abc')).json.error).toBe('invalid_body');
    expect((await signup(code, 'long_pw', 'x'.repeat(129))).json.error).toBe('invalid_body');
    expect((await signup(code, 'common_pw', 'basketball')).json.error).toBe('weak_password');
    expect((await signup(code, 'samesame12', 'SameSame12')).json.error).toBe('weak_password');
    expect((await signup(code, 'Bad Name!')).json.error).toBe('invalid_body');
    expect((await signup(code, 'finally_ok')).status).toBe(200);
  });

  test('10 parallel signups with one code create exactly 1 account', async () => {
    const code = makeInvite();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => signup(code, `racer_${i}`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(Array.from({ length: 10 }, (_, i) => userCount(`racer_${i}`)).reduce((a, b) => a + b)).toBe(1);
  });

  test('invite check names the inviter', async () => {
    const inviter = await newUser();
    const code = makeInvite();
    db.update(invites).set({ createdBy: inviter.id }).where(eq(invites.codeHint, code.slice(-4))).run();
    const r = await call('/invites/check', { method: 'POST', body: { inviteCode: code } });
    expect(r.json).toEqual({ valid: true, invitedBy: expect.stringMatching(/^User /) });
    expect((await signup(code, 'invited_one')).status).toBe(200);
    expect(db.select().from(users).where(eq(users.username, 'invited_one')).get()?.invitedBy).toBe(inviter.id);
  });
});

describe('login', () => {
  test('wrong password and unknown username give the same error', async () => {
    const u = await newUser();
    const wrong = await call('/auth/login', { method: 'POST', body: { username: u.username, password: 'nope nope nope' } });
    const unknown = await call('/auth/login', { method: 'POST', body: { username: 'ghost_user', password: PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });

  test('case-insensitive username, new session each time, logout ends it', async () => {
    const u = await newUser();
    const r = await call('/auth/login', { method: 'POST', body: { username: u.username.toUpperCase(), password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.cookie).not.toBe(u.cookie);
    expect((await call('/me', { cookie: r.cookie })).status).toBe(200);
    await call('/auth/logout', { method: 'POST', cookie: r.cookie });
    expect((await call('/me', { cookie: r.cookie })).status).toBe(401);
  });

  test('rate limited to 5 a minute per IP and username', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call('/auth/login', { method: 'POST', body: { username: 'limited', password: 'x' } })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  test('rate limited to 30 a minute per IP across usernames', async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await call('/auth/login', { method: 'POST', body: { username: `spray${i}`, password: 'x' } })).status);
    expect(statuses.at(-2)).toBe(401);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('guards', () => {
  test('non-GET requests need our Origin', async () => {
    const u = await newUser();
    expect((await call('/auth/logout', { method: 'POST', cookie: u.cookie, origin: 'https://evil.test' })).status).toBe(403);
    expect((await call('/auth/logout', { method: 'POST', cookie: u.cookie, origin: null })).status).toBe(403);
  });

  test('signed-out requests get 401', async () => {
    expect((await call('/me')).status).toBe(401);
    expect((await call('/games')).status).toBe(401);
  });

  test('game and join routes need a push subscription (428)', async () => {
    const u = await newUser({ push: false });
    expect((await call('/games', { cookie: u.cookie })).json).toEqual({ error: 'push_required' });
    expect((await call('/join/ABC-DEF', { cookie: u.cookie })).status).toBe(428);
    await call('/push/subscribe', { method: 'POST', cookie: u.cookie, body: { endpoint: `https://push.test/${u.username}`, keys: { p256dh: 'p', auth: 'a' } } });
    expect((await call('/games', { cookie: u.cookie })).status).toBe(200);
    expect((await call('/me', { cookie: u.cookie })).json.pushReady).toBe(true);
    expect(pushesTo(u)).toEqual([]);
    await call('/push/test', { method: 'POST', cookie: u.cookie });
    await call('/push/test', { method: 'POST', cookie: u.cookie });
    expect(pushesTo(u)).toEqual(["You're all set. We'll tell you when it's your turn.", "You're all set. We'll tell you when it's your turn."]);
  });

  test('settings: turn reminders can be switched off', async () => {
    const u = await newUser();
    await call('/me/settings', { method: 'PATCH', cookie: u.cookie, body: { remindTurn: false } });
    expect((await call('/me', { cookie: u.cookie })).json.remindTurn).toBe(false);
  });
});

test('a subscription the push service reports gone (410) is deleted', async () => {
  const { spyOn } = await import('bun:test');
  const webpush = (await import('web-push')).default;
  const u = await newUser();
  const { notify } = await import('./push');
  const spy = spyOn(webpush, 'sendNotification');
  spy.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 })));
  await notify([u.id], { title: 't', body: 'b' });
  expect((await call('/me', { cookie: u.cookie })).json.pushReady).toBe(false);
  expect((await call('/games', { cookie: u.cookie })).status).toBe(428);
});

test('unexpected errors return a bare 500 with no details', async () => {
  const { spyOn } = await import('bun:test');
  const u = await newUser();
  const log = spyOn(console, 'error').mockImplementation(() => {});
  const select = spyOn(db, 'select').mockImplementationOnce(() => {
    throw new Error('secret internals');
  });
  const r = await call('/games', { cookie: u.cookie });
  select.mockRestore();
  log.mockRestore();
  expect(r).toMatchObject({ status: 500, json: { error: 'server_error' } });
});

test('display names can be changed: 1 to 24 characters, shown everywhere', async () => {
  const u = await newUser();
  const set = (displayName: string) => call('/me/settings', { method: 'PATCH', cookie: u.cookie, body: { displayName } });
  expect((await set('   ')).status).toBe(400);
  expect((await set('x'.repeat(25))).status).toBe(400);
  expect((await set('  Joel J ')).status).toBe(200);
  expect((await call('/me', { cookie: u.cookie })).json.displayName).toBe('Joel J');
  const g = await call('/games', { method: 'POST', cookie: u.cookie, body: { bagSize: 100, randomOrder: false } });
  expect(g.json.players[0].displayName).toBe('Joel J');
});
