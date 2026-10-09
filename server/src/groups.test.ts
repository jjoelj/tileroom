// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { gamePlayers, games, groups, groupWords } from './db/schema';
import { deleteEmptyOrphans, expireProposals } from './groups';
import { sockets } from './realtime';
import { resetRateLimits } from './http';
import { db } from './runtime/db';
import { call, newUser, ORIGIN, pushesTo, type TestUser } from './test-utils';

beforeEach(resetRateLimits);

const DAY = 86_400_000;

async function newGroup(name = 'Friends') {
  const owner = await newUser();
  const r = await call('/groups', { method: 'POST', cookie: owner.cookie, body: { name } });
  expect(r.status).toBe(201);
  return { owner, id: r.json.id as string, code: r.json.joinCode as string };
}

/** A group with `n` members, the first being its creator (admin). */
async function groupOf(n: number) {
  const { owner, id, code } = await newGroup();
  const members = [owner];
  for (let i = 1; i < n; i++) {
    const u = await newUser();
    expect((await call(`/groups/join/${code}`, { method: 'POST', cookie: u.cookie })).status).toBe(200);
    members.push(u);
  }
  return { id, code, members };
}

const propose = (id: string, u: TestUser, word: string, action: string) => call(`/groups/${id}/proposals`, { method: 'POST', cookie: u.cookie, body: { word, action } });
const vote = (proposalId: string, u: TestUser, v: 'yes' | 'no') => call(`/proposals/${proposalId}/vote`, { method: 'POST', cookie: u.cookie, body: { vote: v } });
const detail = (id: string, u: TestUser) => call(`/groups/${id}`, { cookie: u.cookie });

describe('membership', () => {
  test('create, preview, join by code; non-members get 404', async () => {
    const { owner, id, code } = await newGroup('Family');
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const guest = await newUser();
    const preview = await call(`/groups/join/${code.toLowerCase().replace('-', '')}`, { cookie: guest.cookie });
    expect(preview.json).toMatchObject({ id, name: 'Family', joined: false });
    expect((await detail(id, guest)).status).toBe(404);
    expect((await call(`/groups/join/${code}`, { method: 'POST', cookie: guest.cookie })).json.myRole).toBe('member');
    const d = await detail(id, owner);
    expect(d.json.members.map((m: { role: string }) => m.role)).toEqual(['admin', 'member']);
    const list = await call('/groups', { cookie: guest.cookie });
    expect(list.json.groups).toEqual([expect.objectContaining({ id, name: 'Family', memberCount: 2, role: 'member' })]);
  });

  test('admins: only they regenerate the code or change roles; a group always keeps one', async () => {
    const { id, code, members } = await groupOf(3);
    const [a, b, c] = members as [TestUser, TestUser, TestUser];
    expect((await call(`/groups/${id}/code`, { method: 'POST', cookie: b.cookie })).status).toBe(403);
    const fresh = await call(`/groups/${id}/code`, { method: 'POST', cookie: a.cookie });
    expect(fresh.json.joinCode).not.toBe(code);
    expect((await call(`/groups/join/${code}`, { cookie: c.cookie })).status).toBe(404); // the old code is cut off
    expect((await call(`/groups/${id}/members/${a.id}/role`, { method: 'PUT', cookie: a.cookie, body: { role: 'member' } })).json.error).toBe('last_admin');
    expect((await call(`/groups/${id}/settings`, { method: 'PATCH', cookie: b.cookie, body: { name: 'Mine now' } })).status).toBe(403);
    const renamed = await call(`/groups/${id}/settings`, { method: 'PATCH', cookie: a.cookie, body: { name: '  Book club ' } });
    expect(renamed.json).toMatchObject({ name: 'Book club', spectatorsSeeRacks: false });
    // the last admin leaves: the longest-standing member takes over
    expect((await call(`/groups/${id}/members/me`, { method: 'DELETE', cookie: a.cookie })).status).toBe(200);
    expect((await detail(id, b)).json.members).toEqual([expect.objectContaining({ userId: b.id, role: 'admin' }), expect.objectContaining({ userId: c.id, role: 'member' })]);
  });
});

test('members with the group open hear about changes live; outsiders hear nothing', async () => {
  const { id, code, members } = await groupOf(1);
  const listen = (u: TestUser, sub: string) => {
    const got: unknown[] = [];
    const ws = { send: (s: string) => void got.push(JSON.parse(s)), close() {} };
    const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin: ORIGIN, cookie: u.cookie } }))!;
    sockets.open(ws, w);
    sockets.message(ws, w, JSON.stringify({ sub }));
    return { got, close: () => sockets.close(ws, w) };
  };
  const outsider = await newUser();
  const a = listen(members[0]!, `group:${id}`);
  const spy = listen(outsider, `group:${id}`);
  a.got.length = 0; // subscribing nudges a refetch; count from here
  await call(`/groups/join/${code}`, { method: 'POST', cookie: (await newUser()).cookie });
  expect(a.got).toEqual([{ t: 'group' }]);
  expect(spy.got).toEqual([]);
  a.close();
  spy.close();
});

test("no group push for members looking at the group's page", async () => {
  const { id, members } = await groupOf(3);
  const [a, b, c] = members as [TestUser, TestUser, TestUser];
  const ws = { send() {}, close() {} };
  const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin: ORIGIN, cookie: b.cookie } }))!;
  sockets.open(ws, w);
  sockets.message(ws, w, JSON.stringify({ sub: `group:${id}` }));
  const [bBefore, cBefore] = [pushesTo(b).length, pushesTo(c).length];
  await propose(id, a, 'QXZT', 'add');
  expect(pushesTo(b)).toHaveLength(bBefore); // on the page: sees it live
  expect(pushesTo(c)).toHaveLength(cBefore + 1);
  sockets.close(ws, w);
});

describe('the end of a group', () => {
  const exists = (id: string) => !!db.select().from(groups).where(eq(groups.id, id)).get();
  const leaveAll = async (id: string, members: TestUser[]) => {
    for (const u of members) expect((await call(`/groups/${id}/members/me`, { method: 'DELETE', cookie: u.cookie })).status).toBe(200);
  };
  const newGame = (id: string, u: TestUser) => call('/games', { method: 'POST', cookie: u.cookie, body: { bagSize: 100, randomOrder: false, groupId: id } });

  test('admins can delete a group with no games, with its votes and words', async () => {
    const { id, members } = await groupOf(2);
    const [a, b] = members as [TestUser, TestUser];
    const pid = (await propose(id, a, 'QXZR', 'add')).json.proposals[0].id;
    await vote(pid, b, 'yes');
    await propose(id, a, 'QXZS', 'add'); // still open
    expect((await call(`/groups/${id}`, { method: 'DELETE', cookie: b.cookie })).status).toBe(403);
    expect((await call(`/groups/${id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(200);
    expect(exists(id)).toBe(false);
    expect(db.select().from(groupWords).where(eq(groupWords.groupId, id)).all()).toEqual([]);
  });

  test("a group with games can't be deleted: its games show its name", async () => {
    const { id, members } = await groupOf(1);
    await newGame(id, members[0]!);
    expect((await call(`/groups/${id}`, { method: 'DELETE', cookie: members[0]!.cookie })).json.error).toBe('group_has_games');
  });

  test('the last member leaving deletes a group with no games', async () => {
    const { id, members } = await groupOf(2);
    await leaveAll(id, members);
    expect(exists(id)).toBe(false);
  });

  test('with games, it is orphaned instead: no code reaches it; once its games are gone, it is deleted', async () => {
    const { id, code, members } = await groupOf(2);
    const g = await newGame(id, members[0]!);
    await leaveAll(id, members);
    expect(exists(id)).toBe(true);
    const stranger = await newUser();
    expect((await call(`/groups/join/${code}`, { cookie: stranger.cookie })).status).toBe(404);
    expect((await call(`/groups/join/${code}`, { method: 'POST', cookie: stranger.cookie })).status).toBe(404);
    expect((await call(`/groups/${id}`, { cookie: stranger.cookie })).status).toBe(404);
    db.delete(games).where(eq(games.id, g.json.id)).run(); // e.g. voided after 7 days
    deleteEmptyOrphans();
    expect(exists(id)).toBe(false);
  });
});

describe('house words (unanimous)', () => {
  test('passes only when every member says yes; members are told', async () => {
    const { id, members } = await groupOf(3);
    const [a, b, c] = members as [TestUser, TestUser, TestUser];
    const p = await propose(id, a, 'qxzj', 'add');
    expect(p.status).toBe(201);
    const pid = p.json.proposals[0].id;
    expect(pushesTo(b).at(-1)).toMatch(/proposed adding QXZJ\. Vote now\.$/);
    expect((await vote(pid, b, 'yes')).json.proposals).toHaveLength(1); // c still waiting
    const done = await vote(pid, c, 'yes');
    expect(done.json.proposals).toHaveLength(0);
    expect(done.json.words.add).toEqual(['QXZJ']);
    expect(pushesTo(a).at(-1)).toBe('QXZJ is now a house word');
  });

  test('one no rejects at once', async () => {
    const { id, members } = await groupOf(3);
    const [a, b] = members as [TestUser, TestUser];
    const pid = (await propose(id, a, 'QXZK', 'add')).json.proposals[0].id;
    const r = await vote(pid, b, 'no');
    expect(r.json.history[0]).toMatchObject({ word: 'QXZK', status: 'rejected' });
    expect(r.json.words.add).toEqual([]);
    expect((await vote(pid, a, 'yes')).json.error).toBe('proposal_closed');
  });

  test('a joiner must vote too; a leaver no longer blocks', async () => {
    const { id, code, members } = await groupOf(2);
    const [a, b] = members as [TestUser, TestUser];
    const pid = (await propose(id, a, 'QXZL', 'add')).json.proposals[0].id;
    const c = await newUser();
    await call(`/groups/join/${code}`, { method: 'POST', cookie: c.cookie });
    expect((await vote(pid, b, 'yes')).json.proposals).toHaveLength(1); // c joined: their vote is needed
    await call(`/groups/${id}/members/me`, { method: 'DELETE', cookie: c.cookie });
    expect((await detail(id, a)).json.words.add).toEqual(['QXZL']); // c left: a and b are everyone
  });

  test('a group of one decides alone', async () => {
    const { owner, id } = await newGroup();
    expect((await propose(id, owner, 'QXZM', 'add')).json.words.add).toEqual(['QXZM']);
  });

  test('each word has one way in and out; check reports where a word stands', async () => {
    const { owner: a, id } = await newGroup();
    expect((await propose(id, a, 'CAT', 'add')).json.message).toBe('CAT is already a valid word');
    expect((await propose(id, a, 'QXZN', 'ban')).json.error).toBe('invalid_proposal');
    expect((await propose(id, a, 'QXZN', 'remove')).json.error).toBe('invalid_proposal');
    expect((await propose(id, a, 'CAT', 'ban')).json.words.ban).toEqual(['CAT']);
    expect((await propose(id, a, 'CAT', 'add')).json.message).toBe('CAT is banned in this group. Propose unbanning it instead.');
    expect((await call(`/groups/${id}/words/cat`, { cookie: a.cookie })).json).toEqual({ word: 'CAT', inBase: true, approved: 'ban', openProposal: null });
    expect((await propose(id, a, 'CAT', 'unban')).json.words.ban).toEqual([]);
    await propose(id, a, 'QXZN', 'add');
    expect((await propose(id, a, 'QXZN', 'ban')).json.message).toBe('QXZN is a house word. Propose removing it instead.');
    expect((await propose(id, a, 'QXZN', 'remove')).json.words.add).toEqual([]);
    expect((await propose(id, a, 'not a word', 'add')).json.error).toBe('invalid_body');
  });

  test('limits: one open proposal per word, 5 open per member, 500 house words', async () => {
    const { id, members } = await groupOf(2);
    const [a, b] = members as [TestUser, TestUser];
    for (const w of ['QXA', 'QXB', 'QXC', 'QXD', 'QXE']) expect((await propose(id, a, w, 'add')).status).toBe(201);
    expect((await propose(id, a, 'QXF', 'add')).json.error).toBe('too_many_proposals');
    expect((await propose(id, b, 'QXA', 'add')).json.error).toBe('already_proposed');
    // 495 approved + 5 open adds = 500: no more adds or bans, but removals are always allowed
    db.insert(groupWords)
      .values(Array.from({ length: 495 }, (_, i) => ({ groupId: id, word: `QW${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, kind: 'add' as const })))
      .run();
    expect((await propose(id, b, 'QXG', 'add')).json.error).toBe('word_list_full');
    expect((await propose(id, b, 'CAT', 'ban')).json.error).toBe('word_list_full');
    expect((await propose(id, b, 'QWAA', 'remove')).status).toBe(201);
  });

  test('unanimity has 7 days; then it expires as rejected', async () => {
    const { id, members } = await groupOf(2);
    const [a, b] = members as [TestUser, TestUser];
    await propose(id, a, 'QXZP', 'add');
    expireProposals(Date.now() + 8 * DAY);
    const d = await detail(id, a);
    expect(d.json.proposals).toHaveLength(0);
    expect(d.json.history[0]).toMatchObject({ word: 'QXZP', status: 'expired' });
    expect(pushesTo(b).at(-1)).toBe("Adding QXZP didn't get every vote in 7 days");
  });
});

describe('group games', () => {
  const setRack = (gameId: string, seat: number, letters: string) =>
    db.update(gamePlayers).set({ rack: [...letters] }).where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.seat, seat))).run();
  const across = (word: string, turnNumber = 0) => ({ turnNumber, type: 'play', tiles: [...word].map((letter, i) => ({ r: 7, c: 7 + i, letter })) });

  test('members only: others are refused, even with the code', async () => {
    const { id, members } = await groupOf(2);
    const [a] = members as [TestUser];
    const outsider = await newUser();
    expect((await call('/games', { method: 'POST', cookie: outsider.cookie, body: { bagSize: 100, randomOrder: false, groupId: id } })).status).toBe(404);
    const g = await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false, groupId: id } });
    expect(g.json.group).toEqual({ id, name: 'Friends' });
    const preview = await call(`/join/${g.json.joinCode}`, { cookie: outsider.cookie });
    expect(preview.json).toMatchObject({ group: { id, name: 'Friends' }, canJoin: false });
    const join = await call(`/join/${g.json.joinCode}`, { method: 'POST', cookie: outsider.cookie });
    expect(join.status).toBe(403);
    expect(join.json).toEqual({ error: 'not_group_member', message: 'This game is for Friends. Join the group first.' });
  });

  test("the group's words are frozen at start: adds count, bans don't, later votes change nothing", async () => {
    const { id, members } = await groupOf(2);
    const [a, b] = members as [TestUser, TestUser];
    const pass = async (word: string, action: string) => {
      const pid = (await propose(id, a, word, action)).json.proposals[0].id;
      await vote(pid, b, 'yes');
    };
    await pass('QXZJ', 'add');
    await pass('CAT', 'ban');
    const g = await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false, groupId: id } });
    await call(`/join/${g.json.joinCode}`, { method: 'POST', cookie: b.cookie });
    const started = await call(`/games/${g.json.id}/start`, { method: 'POST', cookie: a.cookie });
    expect(started.json.houseWords).toEqual({ add: ['QXZJ'], ban: ['CAT'] });
    await pass('DOG', 'ban'); // after the start: not in this game

    setRack(g.json.id, 0, 'CATQXZJ');
    expect((await call(`/games/${g.json.id}/moves`, { method: 'POST', cookie: a.cookie, body: across('CAT') })).json.message).toBe(
      "CAT isn't in this game's word list",
    );
    expect((await call(`/games/${g.json.id}/moves`, { method: 'POST', cookie: a.cookie, body: across('QXZJ') })).status).toBe(200);
    expect((await call(`/games/${g.json.id}`, { cookie: b.cookie })).json.houseWords).toEqual({ add: ['QXZJ'], ban: ['CAT'] });
  });
});

describe('spectating (SPEC §4.11)', () => {
  /** A started group game: a and b seated, c a member watching. Optionally with trays visible to spectators. */
  async function watched(racks = false) {
    const { id: groupId, members } = await groupOf(3);
    const [a, b, c] = members as [TestUser, TestUser, TestUser];
    if (racks) await call(`/groups/${groupId}/settings`, { method: 'PATCH', cookie: a.cookie, body: { spectatorsSeeRacks: true } });
    const g = await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false, groupId } });
    await call(`/join/${g.json.joinCode}`, { method: 'POST', cookie: b.cookie });
    await call(`/games/${g.json.id}/start`, { method: 'POST', cookie: a.cookie });
    return { groupId, gameId: g.json.id as string, a, b, c };
  }

  test('members who are not seated watch read-only; outsiders get 404', async () => {
    const { gameId, a, c } = await watched();
    const v = await call(`/games/${gameId}`, { cookie: c.cookie });
    expect(v.json).toMatchObject({ role: 'spectator', mySeat: null, myRack: null, spectatorRacks: null, spectatorsSeeRacks: false });
    expect((await call(`/games/${gameId}/log`, { cookie: c.cookie })).status).toBe(200);
    expect((await call(`/games/${gameId}/moves`, { method: 'POST', cookie: c.cookie, body: { turnNumber: 0, type: 'pass' } })).status).toBe(404);
    expect((await call(`/games/${gameId}/nudge`, { method: 'POST', cookie: c.cookie })).status).toBe(404);
    expect((await call(`/games/${gameId}`, { cookie: (await newUser()).cookie })).status).toBe(404);
    expect((await call(`/games/${gameId}`, { cookie: a.cookie })).json.role).toBe('player'); // seated: never a spectator view
  });

  test('trays: copied at start; turning off applies at once, turning on only to later games', async () => {
    const { groupId, gameId, a, c } = await watched(true);
    const v = await call(`/games/${gameId}`, { cookie: c.cookie });
    expect(v.json.spectatorsSeeRacks).toBe(true);
    expect(v.json.spectatorRacks.map((r: { rack: string[] }) => r.rack.length)).toEqual([7, 7]);
    expect((await call(`/games/${gameId}`, { cookie: a.cookie })).json.spectatorRacks).toBeNull(); // players never see others' trays

    await call(`/groups/${groupId}/settings`, { method: 'PATCH', cookie: a.cookie, body: { spectatorsSeeRacks: false } });
    expect((await call(`/games/${gameId}`, { cookie: c.cookie })).json).toMatchObject({ spectatorsSeeRacks: false, spectatorRacks: null });
    await call(`/groups/${groupId}/settings`, { method: 'PATCH', cookie: a.cookie, body: { spectatorsSeeRacks: true } });
    expect((await call(`/games/${gameId}`, { cookie: c.cookie })).json.spectatorRacks).toBeNull(); // never re-exposed
    expect((await call(`/groups/${groupId}/settings`, { method: 'PATCH', cookie: c.cookie, body: { spectatorsSeeRacks: false } })).status).toBe(403);
  });

  test('players see who is watching, live; spectators get no turn pushes', async () => {
    const { gameId, a, b, c } = await watched();
    const got: { t: string; view?: { watching: { userId: string; displayName: string }[]; role: string } }[] = [];
    const open = (u: TestUser, sink: typeof got) => {
      const ws = { send: (s: string) => void sink.push(JSON.parse(s)), close() {} };
      const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin: ORIGIN, cookie: u.cookie } }))!;
      sockets.open(ws, w);
      return { sub: (sub: string) => sockets.message(ws, w, JSON.stringify({ sub })), close: () => sockets.close(ws, w) };
    };
    const seen: typeof got = [];
    const sa = open(a, got);
    sa.sub(gameId);
    const sc = open(c, seen);
    sc.sub(gameId);
    expect(got.at(-1)!.view!.watching).toEqual([{ userId: c.id, displayName: expect.any(String) }]);
    expect(seen.at(-1)!.view!.role).toBe('spectator');
    const before = pushesTo(c).length;
    expect((await call(`/games/${gameId}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 0, type: 'pass' } })).status).toBe(200);
    expect(pushesTo(c)).toHaveLength(before);
    expect(pushesTo(b).at(-1)).toContain('Your turn.');
    sc.close();
    expect(got.at(-1)!.view!.watching).toEqual([]);
    sa.close();
  });
});

test('opening a group game tells the other members, except anyone on the group page', async () => {
  const { id, members } = await groupOf(3);
  const [a, b, c] = members as [TestUser, TestUser, TestUser];
  const got: unknown[] = [];
  const ws = { send: (m: string) => void got.push(JSON.parse(m)), close() {} };
  const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin: ORIGIN, cookie: b.cookie } }))!;
  sockets.open(ws, w);
  sockets.message(ws, w, JSON.stringify({ sub: `group:${id}` }));
  got.length = 0; // subscribing nudges a refetch; count from here
  const [aBefore, bBefore] = [pushesTo(a).length, pushesTo(b).length];
  const r = await call('/games', { method: 'POST', cookie: a.cookie, body: { bagSize: 100, randomOrder: false, groupId: id } });
  expect(r.status).toBe(201);
  expect(pushesTo(c).at(-1)).toMatch(/opened a game\. Join before it starts\.$/);
  expect(pushesTo(a)).toHaveLength(aBefore); // the host knows
  expect(pushesTo(b)).toHaveLength(bBefore); // on the page: sees it live instead
  expect(got).toContainEqual({ t: 'group' });
  sockets.close(ws, w);
});
