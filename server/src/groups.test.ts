// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, test } from 'bun:test';
import { groupWords } from './db/schema';
import { expireProposals } from './groups';
import { resetRateLimits } from './http';
import { db } from './runtime/db';
import { call, newUser, pushesTo, type TestUser } from './test-utils';

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
    // the last admin leaves: the longest-standing member takes over
    expect((await call(`/groups/${id}/members/me`, { method: 'DELETE', cookie: a.cookie })).status).toBe(200);
    expect((await detail(id, b)).json.members).toEqual([expect.objectContaining({ userId: b.id, role: 'admin' }), expect.objectContaining({ userId: c.id, role: 'member' })]);
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
    expect((await call(`/groups/${id}/check/cat`, { cookie: a.cookie })).json).toEqual({ word: 'CAT', inBase: true, approved: 'ban', openProposal: null });
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
