// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import webpush from 'web-push';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { randomId } from './codes';
import { pushSubs, sessions } from './db/schema';
import { ApiError, body, rateLimit } from './http';
import { db } from './runtime/db';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
export const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (pushConfigured) webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

/** Public info only: it passes through Apple's and Google's push services (SPEC §6.1). */
export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Sends to every device of each user. */
export async function notify(userIds: string[], payload: PushPayload) {
  await send(userIds.flatMap((id) => db.select().from(pushSubs).where(eq(pushSubs.userId, id)).all()), payload);
}

/** Deletes subscriptions the push service says are gone. */
async function send(subs: (typeof pushSubs.$inferSelect)[], payload: PushPayload) {
  if (!pushConfigured || !subs.length) return;
  const json = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json, { TTL: 86_400 });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) db.delete(pushSubs).where(eq(pushSubs.id, s.id)).run();
        else console.warn(`push failed (${status ?? 'network'})`);
      }
    }),
  );
}

/** Game and join routes need a push subscription on this session (SPEC §8). */
export const requirePush: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.session.pushSubId === null) throw new ApiError(428, 'push_required');
  await next();
};

const Subscription = z.object({
  endpoint: z.url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const push = new Hono<AppEnv>()
  .get('/push/key', (c) => c.json({ publicKey: VAPID_PUBLIC_KEY ?? null }))
  .post('/push/subscribe', async (c) => {
    const s = await body(c, Subscription);
    const user = c.var.user;
    const existing = db.select().from(pushSubs).where(eq(pushSubs.endpoint, s.endpoint)).get();
    const id = existing?.id ?? randomId();
    db.transaction((tx) => {
      const values = { userId: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth };
      if (existing) tx.update(pushSubs).set(values).where(eq(pushSubs.id, id)).run();
      else tx.insert(pushSubs).values({ id, ...values }).run();
      tx.update(sessions).set({ pushSubId: id }).where(eq(sessions.id, c.var.session.id)).run();
    });
    return c.json({ ok: true });
  })
  // "You're all set", right after enabling: only to the device just set up (this session's subscription).
  .post('/push/welcome', async (c) => {
    rateLimit(`push-test:${c.var.user.id}`, 5);
    const id = c.var.session.pushSubId;
    if (id) await send(db.select().from(pushSubs).where(eq(pushSubs.id, id)).all(), { title: 'Tileroom', body: "You're all set. We'll tell you when it's your turn." });
    return c.json({ ok: true });
  })
  // The Settings test button: every device, so each can be checked (SPEC §8). Waits for the push service's answer.
  .post('/push/test', async (c) => {
    rateLimit(`push-test:${c.var.user.id}`, 5);
    await notify([c.var.user.id], { title: 'Tileroom', body: 'Test notification. If you see this, notifications work on this device.' });
    return c.json({ ok: true });
  });
