// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from './db/schema';
import { db } from './runtime/db';
import { createInvite } from './store';
import { call, makeInvite, newUser, PASSWORD } from './test-utils';

test('admins make unlimited invites and see who used each; others get 403', async () => {
  const [admin, member] = [await newUser(), await newUser()];
  db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id)).run();

  expect((await call('/admin/invites', { method: 'POST', cookie: member.cookie, body: {} })).status).toBe(403);
  expect((await call('/admin/invites', { cookie: member.cookie })).status).toBe(403);

  const codes: string[] = [];
  for (let i = 0; i < 12; i++) codes.push((await call('/admin/invites', { method: 'POST', cookie: admin.cookie, })).json.code);
  expect(new Set(codes).size).toBe(12);

  const signup = await call('/auth/signup', { method: 'POST', body: { inviteCode: codes[0], username: `sam_${Date.now() % 1e6}`, password: PASSWORD, displayName: 'Sam' } });
  expect(signup.status).toBe(200);

  const list = (await call('/admin/invites', { cookie: admin.cookie })).json.invites;
  const hintOf = (code: string) => code.replace(/-/g, '').slice(-4);
  const used = list.find((i: { hint: string }) => i.hint === hintOf(codes[0]));
  const adminName = (await call('/me', { cookie: admin.cookie })).json.displayName;
  expect(used).toMatchObject({ usedBy: { displayName: 'Sam' }, createdBy: adminName });
  expect(used.usedAt).toBeNumber();
  expect(list.find((i: { hint: string }) => i.hint === hintOf(codes[1])).usedBy).toBeNull();
  expect(JSON.stringify(list)).not.toContain(codes[1]); // only hints, never codes

  // revoke: unused only; it's deleted, so it's gone from the list and can't sign up
  const unused = list.find((i: { hint: string }) => i.hint === hintOf(codes[1]));
  expect((await call(`/admin/invites/${used.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(409);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: member.cookie })).status).toBe(403);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(200);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(409);
  expect((await call('/admin/invites', { cookie: admin.cookie })).json.invites.some((i: { id: string }) => i.id === unused.id)).toBe(false);
  const late = await call('/auth/signup', { method: 'POST', body: { inviteCode: codes[1], username: `ben_${Date.now() % 1e6}`, password: PASSWORD, displayName: 'Ben' } });
  expect(late.json.error).toBe('invite_invalid');
});

test('a new invite never reuses an existing code', () => {
  const taken = makeInvite();
  const fresh = 'ZZZZ-ZZZZ-ZZZ2';
  const codes = [taken, taken, fresh];
  expect(createInvite(db, null, () => codes.shift()!)).toBe(fresh);
});

test('admins see every group, its members and its game counts; nothing about the games themselves', async () => {
  const [admin, a, b, outsider] = [await newUser(), await newUser(), await newUser(), await newUser()];
  db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id)).run();
  const g = (await call('/groups', { method: 'POST', cookie: a.cookie, body: { name: 'Admin view' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: b.cookie });
  const game = (await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false, groupId: g.id } })).json;
  await call(`/join/${game.joinCode}`, { method: 'POST', cookie: b.cookie });
  await call(`/games/${game.id}/start`, { method: 'POST', cookie: a.cookie });
  await call('/games', { method: 'POST', cookie: b.cookie, body: { bagSize: 100, randomOrder: false, groupId: g.id } });

  expect((await call('/admin/groups', { cookie: outsider.cookie })).status).toBe(403);
  const list = (await call('/admin/groups', { cookie: admin.cookie })).json.groups;
  const mine = list.find((x: { id: string }) => x.id === g.id);
  expect(mine.members.map((m: { role: string }) => m.role)).toEqual(['admin', 'member']);
  expect(mine.games).toEqual({ lobby: 1, active: 1, finished: 0 });
  expect(JSON.stringify(mine)).not.toMatch(/rack|board|bag|joinCode/);
  expect((await call(`/games/${game.id}`, { cookie: admin.cookie })).status).toBe(404); // still no game visibility
});
