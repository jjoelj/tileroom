// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invites, pushSubs, users } from './db/schema';
import { db } from './runtime/db';
import { createInvite, DELETED_MARK, DELETED_NAME } from './store';
import { call, newUser, PASSWORD, type TestUser } from './test-utils';

const del = (u: TestUser, password = PASSWORD) => call('/me', { method: 'DELETE', cookie: u.cookie, body: { password } });
const newGame = async (host: TestUser, groupId?: string) =>
  (await call('/games', { method: 'POST', cookie: host.cookie, body: { bagSize: 100, randomOrder: false, ...(groupId && { groupId }) } })).json as { id: string; joinCode: string };
const join = (u: TestUser, code: string) => call(`/join/${code}`, { method: 'POST', cookie: u.cookie });

test('deleting an account: anonymized, out of lobbies and groups, running games left to expire; admins never', async () => {
  const [gone, sam, ben] = [await newUser(), await newUser(), await newUser()];

  // a group gone created (so they're its admin) with sam in it
  const g = (await call('/groups', { method: 'POST', cookie: gone.cookie, body: { name: 'Leavers' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: sam.cookie });
  const hosted = await newGame(gone); // gone hosts, sam joined: cancelled
  await join(sam, hosted.joinCode);
  const joined = await newGame(ben); // ben hosts, gone joined: gone leaves
  await join(gone, joined.joinCode);
  const running = await newGame(sam); // under way: left alone
  await join(gone, running.joinCode);
  await call(`/games/${running.id}/start`, { method: 'POST', cookie: sam.cookie });
  createInvite(db, gone.id);

  expect((await del(gone, 'not my password')).json.error).toBe('wrong_password');
  expect((await del(gone)).status).toBe(200);

  expect((await call('/me', { cookie: gone.cookie })).status).toBe(401); // signed out everywhere
  expect((await call('/auth/login', { method: 'POST', body: { username: gone.username, password: PASSWORD } })).status).toBe(401);
  const row = db.select().from(users).where(eq(users.id, gone.id)).get()!;
  expect(row).toMatchObject({ displayName: DELETED_NAME, showOnGlobal: false });
  expect(row.username).toStartWith('deleted-');
  expect(db.select().from(pushSubs).where(eq(pushSubs.userId, gone.id)).all()).toEqual([]);
  expect(db.select().from(invites).where(eq(invites.createdBy, gone.id)).all()).toEqual([]);

  expect((await call(`/games/${hosted.id}`, { cookie: sam.cookie })).status).toBe(404); // "can't be found"
  const left = (await call(`/games/${joined.id}`, { cookie: ben.cookie })).json;
  expect(left.players.map((p: { userId: string }) => p.userId)).toEqual([ben.id]);
  const still = (await call(`/games/${running.id}`, { cookie: sam.cookie })).json;
  expect(still.players.find((p: { userId: string }) => p.userId === gone.id).displayName).toBe(DELETED_NAME);

  // their turn in the running game: can't be nudged (it expires after 7 days instead)
  expect(still.players.find((p: { userId: string }) => p.userId === gone.id).deleted).toBe(true);
  await call(`/games/${running.id}/moves`, { method: 'POST', cookie: sam.cookie, body: { turnNumber: 0, type: 'pass' } });
  expect((await call(`/games/${running.id}/nudge`, { method: 'POST', cookie: sam.cookie })).json.error).toBe('player_deleted');

  const group = (await call(`/groups/${g.id}`, { cookie: sam.cookie })).json;
  expect(group.members).toEqual([expect.objectContaining({ userId: sam.id, role: 'admin' })]); // sam took over
});

test('only deleted accounts carry the deleted mark in their name', async () => {
  const u = await newUser();
  expect((await call('/me/settings', { method: 'PATCH', cookie: u.cookie, body: { displayName: `${DELETED_MARK} Deleted` } })).status).toBe(400);
  expect((await call('/me/settings', { method: 'PATCH', cookie: u.cookie, body: { displayName: 'Deleted' } })).status).toBe(200); // the words alone prove nothing
});

test("admins can't delete their account", async () => {
  const admin = await newUser();
  db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id)).run();
  expect((await del(admin)).json.error).toBe('admin_cannot_delete');
  expect((await call('/me', { cookie: admin.cookie })).status).toBe(200);
});
