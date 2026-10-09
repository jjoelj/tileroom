// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from './db/schema';
import { db } from './runtime/db';
import { call, newUser, PASSWORD } from './test-utils';

test('admins make unlimited invites and see who used each; others get 403', async () => {
  const [admin, member] = [await newUser(), await newUser()];
  db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id)).run();

  expect((await call('/admin/invites', { method: 'POST', cookie: member.cookie, body: {} })).status).toBe(403);
  expect((await call('/admin/invites', { cookie: member.cookie })).status).toBe(403);

  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await call('/admin/invites', { method: 'POST', cookie: admin.cookie, body: { note: `for ${i}` } })).json.code);
  expect(new Set(codes).size).toBe(12);

  const signup = await call('/auth/signup', { method: 'POST', body: { inviteCode: codes[0], username: `sam_${Date.now() % 1e6}`, password: PASSWORD, displayName: 'Sam' } });
  expect(signup.status).toBe(200);

  const list = (await call('/admin/invites', { cookie: admin.cookie })).json.invites;
  const used = list.find((i: { note: string }) => i.note === 'for 0');
  const adminName = (await call('/me', { cookie: admin.cookie })).json.displayName;
  expect(used).toMatchObject({ usedBy: { displayName: 'Sam' }, createdBy: adminName });
  expect(used.usedAt).toBeNumber();
  expect(list.find((i: { note: string }) => i.note === 'for 1').usedBy).toBeNull();
  expect(JSON.stringify(list)).not.toContain(codes[1]); // only hints, never codes

  // revoke: unused only; it's deleted, so it's gone from the list and can't sign up
  const unused = list.find((i: { note: string }) => i.note === 'for 1');
  expect((await call(`/admin/invites/${used.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(409);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: member.cookie })).status).toBe(403);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(200);
  expect((await call(`/admin/invites/${unused.id}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(409);
  expect((await call('/admin/invites', { cookie: admin.cookie })).json.invites.some((i: { id: string }) => i.id === unused.id)).toBe(false);
  const late = await call('/auth/signup', { method: 'POST', body: { inviteCode: codes[1], username: `ben_${Date.now() % 1e6}`, password: PASSWORD, displayName: 'Ben' } });
  expect(late.json.error).toBe('invite_invalid');
});
