// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { gamePlayers } from './db/schema';
import { sockets, watching } from './realtime';
import { db } from './runtime/db';
import type { Socket } from './runtime/serve';
import { call, newUser, ORIGIN, PASSWORD, pushesTo, type TestUser } from './test-utils';

/** A fake socket, opened as `u` from `origin`, recording what it's sent. */
function connect(u: TestUser, origin = ORIGIN) {
  const got: { t: string; view?: { myRack: string[] | null; players: unknown[] } }[] = [];
  const ws: Socket = { send: (s) => void got.push(JSON.parse(s)), close() {} };
  const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin, cookie: u.cookie } }));
  if (w) sockets.open(ws, w);
  return { got, ok: !!w, sub: (sub: string, focused = true) => w && sockets.message(ws, w, JSON.stringify({ sub, focused })), close: () => w && sockets.close(ws, w) };
}

test('watchers of a game get their own view; players on the lobby get a nudge; nobody else hears anything', async () => {
  const [a, b, stranger] = [await newUser(), await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false } })).json.id;
  const code = (await call(`/games/${id}`, { cookie: a.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: b.cookie });
  await call(`/games/${id}/start`, { method: 'POST', cookie: a.cookie });
  db.update(gamePlayers).set({ rack: [...'CATXYZQ'] }).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.seat, 0))).run();

  expect(connect(a, 'https://evil.test').ok).toBe(false); // cross-site sockets are refused
  const [sa, sb, ss] = [connect(a), connect(b), connect(stranger)];
  sa.sub(id);
  sb.sub('lobby');
  ss.sub(id); // not seated: must get nothing
  expect(watching(a.id, id)).toBe(true);
  expect(watching(b.id, id)).toBe(false);
  expect(ss.got).toEqual([]); // not seated, not in a group: nothing, not even on subscribe
  for (const s of [sa, sb]) s.got.length = 0; // subscribing sends a fresh view (watcher lists); start counting now

  const tiles = [{ r: 7, c: 6, letter: 'C' }, { r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'T' }];
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 0, type: 'play', tiles } })).status).toBe(200);

  expect(sa.got).toHaveLength(1);
  expect(sa.got[0]!.t).toBe('game');
  expect(sa.got[0]!.view!.myRack).toHaveLength(7); // a's own rack, refilled
  expect(JSON.stringify(sa.got[0])).not.toContain('"rack"'); // no one else's rack (SPEC §6.1)
  expect(sb.got).toEqual([{ t: 'lobby' }]);
  expect(ss.got).toEqual([]);
  expect(pushesTo(b).at(-1)).toContain('Your turn. ');

  // b opens the game: a's pass reaches b live, with no push
  const before = pushesTo(b).length;
  sb.sub(id);
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: b.cookie, body: { turnNumber: 1, type: 'pass' } })).status).toBe(200);
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 2, type: 'pass' } })).status).toBe(200);
  expect(sb.got.at(-1)!.t).toBe('game');
  expect(pushesTo(b)).toHaveLength(before);

  for (const s of [sa, sb, ss]) s.close();
  expect(watching(b.id, id)).toBe(false);
});

test('group screens: a new code nudges members watching; refocusing nudges too; outsiders hear nothing', async () => {
  const [a, b, stranger] = [await newUser(), await newUser(), await newUser()];
  const g = (await call('/groups', { method: 'POST', cookie: a.cookie, body: { name: 'Friends' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: b.cookie });
  const [sb, ss] = [connect(b), connect(stranger)];
  sb.sub(`group:${g.id}`);
  ss.sub(`group:${g.id}`);
  expect(sb.got).toEqual([{ t: 'group' }]); // on subscribe: refetch what changed while away
  sb.got.length = 0;

  await call(`/groups/${g.id}/code`, { method: 'POST', cookie: a.cookie });
  expect(sb.got).toEqual([{ t: 'group' }]);

  sb.sub(''); // window loses focus: misses the next change...
  await call(`/groups/${g.id}/code`, { method: 'POST', cookie: a.cookie });
  expect(sb.got).toHaveLength(1);
  sb.sub(`group:${g.id}`); // ...and catches up on refocus
  expect(sb.got).toHaveLength(2);
  expect(ss.got).toEqual([]);
  for (const s of [sb, ss]) s.close();
});

test('presence: players see who else has the game open right now, live', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false } })).json.id;
  const code = (await call(`/games/${id}`, { cookie: a.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: b.cookie });
  await call(`/games/${id}/start`, { method: 'POST', cookie: a.cookie });
  const [sa, sb] = [connect(a), connect(b)];
  type P = { userId: string; here: boolean };
  const bHere = () => (sa.got.at(-1)!.view!.players as P[]).find((p) => p.userId === b.id)!.here;

  sa.sub(id);
  expect(bHere()).toBe(false);
  sb.sub(id); // b opens it
  expect(bHere()).toBe(true);
  sb.sub(''); // b switches away (or the app goes to the background)
  expect(bHere()).toBe(false);
  sb.sub(id);
  sb.close(); // b's connection drops
  expect(bHere()).toBe(false);
  expect((await call(`/games/${id}`, { cookie: a.cookie })).json.players.find((p: P) => p.userId === b.id).here).toBe(false); // REST views agree
  sa.close();
});

test('deleting an account closes its sockets: it hears nothing more and is no longer "here"', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false } })).json.id;
  const code = (await call(`/games/${id}`, { cookie: a.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: b.cookie });
  await call(`/games/${id}/start`, { method: 'POST', cookie: a.cookie });
  const [sa, sb] = [connect(a), connect(b)];
  sa.sub(id);
  sb.sub(id);
  await call('/me', { method: 'DELETE', cookie: b.cookie, body: { password: PASSWORD } });
  const heard = sb.got.length;
  expect((sa.got.at(-1)!.view!.players as { userId: string; here: boolean }[]).find((p) => p.userId === b.id)!.here).toBe(false);
  await call(`/games/${id}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 0, type: 'pass' } });
  expect(sb.got.length).toBe(heard);
  sa.close();
});

test('someone leaving a lobby: the host, watching it, gets the new seats live', async () => {
  const [host, guest] = [await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: host.cookie, body: {} })).json.id;
  const code = (await call(`/games/${id}`, { cookie: host.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: guest.cookie });
  const sh = connect(host);
  sh.sub(id);
  await call(`/games/${id}/players/me`, { method: 'DELETE', cookie: guest.cookie });
  expect(sh.got.at(-1)!.view!.players).toHaveLength(1);
  sh.close();
});

test('a visible window that is not in front still gets live updates, but is not "here" and still gets pushes', async () => {
  const [host, guest] = [await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: host.cookie, body: {} })).json.id;
  const code = (await call(`/games/${id}`, { cookie: host.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: guest.cookie });
  const [sh, sg] = [connect(host), connect(guest)];
  sh.sub(id);
  sg.sub(id, false); // beside the host's window, not focused
  await call(`/games/${id}`, { method: 'PATCH', cookie: host.cookie, body: { layout: 'special' } });
  expect((sg.got.at(-1)!.view as unknown as { layout: string }).layout).toBe('special'); // the setting arrives live
  const here = (sh.got.at(-1)!.view!.players as { userId: string; here: boolean }[]).find((p) => p.userId === guest.id)!.here;
  expect(here).toBe(false);
  expect(watching(guest.id, id)).toBe(false); // so they'd still get a push
  sg.sub(id, true); // they click into it
  expect((sh.got.at(-1)!.view!.players as { userId: string; here: boolean }[]).find((p) => p.userId === guest.id)!.here).toBe(true);
  for (const s of [sh, sg]) s.close();
});
