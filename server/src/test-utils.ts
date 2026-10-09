// SPDX-License-Identifier: AGPL-3.0-or-later
import { spyOn } from 'bun:test';
import webpush from 'web-push';
import { app } from './app';
import { resetRateLimits } from './http';
import type { PushPayload } from './push';
import { db } from './runtime/db';
import { createInvite } from './store';

export const ORIGIN = 'https://tileroom.test';

/** Every push "sent" during tests. */
export const sent: { endpoint: string; payload: PushPayload }[] = [];
spyOn(webpush, 'sendNotification').mockImplementation(async (sub, payload) => {
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(String(payload)) });
  return { statusCode: 201, body: '', headers: {} };
});

type CallOpts = { method?: string; body?: unknown; cookie?: string; origin?: string | null };

// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected ad hoc
export async function call(path: string, { method = 'GET', body, cookie, origin = ORIGIN }: CallOpts = {}): Promise<{ status: number; json: any; cookie?: string }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie')?.match(/^th_session=[^;]+/)?.[0];
  return { status: res.status, json: await res.json().catch(() => null), cookie: setCookie };
}

export const makeInvite = () => createInvite(db, null);

export const PASSWORD = 'correct horse battery';

let n = 0;
export type TestUser = { cookie: string; id: string; username: string; endpoint: string };

/** Signs up with a fresh invite and, unless `push: false`, registers a push subscription. */
export async function newUser({ push = true } = {}): Promise<TestUser> {
  resetRateLimits();
  const username = `user${++n}_${Date.now() % 1e6}`;
  const r = await call('/auth/signup', {
    method: 'POST',
    body: { inviteCode: makeInvite(), username, password: PASSWORD, displayName: `User ${n}` },
  });
  if (r.status !== 200 || !r.cookie) throw new Error(`signup failed: ${JSON.stringify(r.json)}`);
  const endpoint = `https://push.test/${username}`;
  if (push) await call('/push/subscribe', { method: 'POST', cookie: r.cookie, body: { endpoint, keys: { p256dh: 'p', auth: 'a' } } });
  const me = await call('/me', { cookie: r.cookie });
  return { cookie: r.cookie, id: me.json.id, username, endpoint };
}

export const pushesTo = (u: TestUser) => sent.filter((s) => s.endpoint === u.endpoint).map((s) => s.payload.body);
