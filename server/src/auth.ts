// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { parse } from 'hono/utils/cookie';
import { z } from 'zod';
import { newToken, normalizeCode, randomId, sha256 } from './codes';
import { invites, sessions, users } from './db/schema';
import { ApiError, body, PUBLIC_ORIGINS, rateLimit } from './http';
import { renamed } from './realtime';
import { db, type Tx } from './runtime/db';
import { hashPassword, needsRehash, verifyPassword } from './runtime/hash';
import { clientIp } from './runtime/ip';

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AppEnv = { Variables: { user: User; session: Session } };

const COOKIE = 'th_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

// Only passwords that pass the length rule can matter, so the bundled list keeps just those (SecLists 10k, MIT).
const COMMON = new Set(readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8').split(/\r?\n/));

const DisplayName = z.string().trim().min(1).max(24);
export const Username =z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, 'Usernames are 3–20 letters, digits or _');
const Password = z.string().min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters');

/** Throws 400 `weak_password` for common passwords or the username itself. */
export function checkPassword(password: string, username: string) {
  const p = password.toLowerCase();
  if (COMMON.has(p) || p === username) throw new ApiError(400, 'weak_password', 'Pick a less common password');
}

export function createSession(tx: Tx, c: Context, userId: string) {
  const token = newToken();
  tx.insert(sessions)
    .values({ id: sha256(token), userId, expiresAt: Date.now() + SESSION_MS, userAgent: c.req.header('user-agent')?.slice(0, 200) })
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: PUBLIC_ORIGINS.every((o) => o.startsWith('https:')), // production; dev may mix http://localhost in
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

/** Loads the session if there is one. Sliding expiry, refreshed at most once a day. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const row = sessionFor(getCookie(c, COOKIE));
  if (row) {
    c.set('session', row.sessions);
    c.set('user', row.users);
  }
  await next();
};

/** The live session and user for a session token, if any. */
function sessionFor(token: string | undefined) {
  if (!token) return undefined;
  const row = db.select().from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, sha256(token))).get();
  const now = Date.now();
  if (!row || row.sessions.expiresAt <= now) return undefined;
  if (row.sessions.expiresAt - now < SESSION_MS - 86_400_000) {
    db.update(sessions).set({ expiresAt: now + SESSION_MS }).where(eq(sessions.id, row.sessions.id)).run();
  }
  return row;
}

/** The signed-in user behind a raw request (the WebSocket upgrade), if it comes from our own origin. */
export function requestUser(req: Request) {
  if (!PUBLIC_ORIGINS.includes(req.headers.get('origin') ?? '')) return undefined; // no cross-site sockets
  return sessionFor(parse(req.headers.get('cookie') ?? '', COOKIE)[COOKIE])?.users;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) throw new ApiError(401, 'signed_out');
  await next();
};

/** Non-GET requests must come from our own origin (SPEC §6, §10). */
export const checkOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !PUBLIC_ORIGINS.includes(c.req.header('origin') ?? '')) {
    throw new ApiError(403, 'bad_origin');
  }
  await next();
};

const usableInvite = (codeHash: string, now: number) =>
  and(eq(invites.codeHash, codeHash), isNull(invites.usedBy), or(isNull(invites.expiresAt), gt(invites.expiresAt, now)));

let dummyHash: Promise<string> | undefined;

export const auth = new Hono<AppEnv>()
  .post('/invites/check', async (c) => {
    rateLimit(`invite:${clientIp(c)}`, 10);
    const { inviteCode } = await body(c, z.object({ inviteCode: z.string().max(40) }));
    const row = db
      .select({ by: users.displayName })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.createdBy))
      .where(usableInvite(sha256(normalizeCode(inviteCode)), Date.now()))
      .get();
    return c.json({ valid: !!row, invitedBy: row?.by ?? null });
  })

  .post('/auth/signup', async (c) => {
    rateLimit(`invite:${clientIp(c)}`, 10);
    const b = await body(
      c,
      z.object({
        inviteCode: z.string().max(40),
        username: Username,
        password: Password,
        displayName: DisplayName,
      }),
    );
    // Validate everything before touching the invite, so a typo doesn't burn the code.
    checkPassword(b.password, b.username);
    if (db.select({ id: users.id }).from(users).where(eq(users.username, b.username)).get()) {
      throw new ApiError(409, 'username_taken', 'That username is taken');
    }
    const passwordHash = await hashPassword(b.password);
    const codeHash = sha256(normalizeCode(b.inviteCode));
    const id = randomId();
    try {
      db.transaction((tx) => {
        const invite = tx.select({ createdBy: invites.createdBy }).from(invites).where(eq(invites.codeHash, codeHash)).get();
        tx.insert(users).values({ id, username: b.username, passwordHash, displayName: b.displayName, invitedBy: invite?.createdBy }).run();
        const now = Date.now();
        const used = tx.update(invites).set({ usedBy: id, usedAt: now }).where(usableInvite(codeHash, now)).returning({ h: invites.codeHash }).all();
        if (used.length !== 1) throw new ApiError(400, 'invite_invalid', "This code isn't valid or was already used");
        createSession(tx, c, id);
      });
    } catch (e) {
      // Lost a race for the same username; the transaction rolled back, so the invite is untouched.
      if (String(e).includes('users.username')) throw new ApiError(409, 'username_taken', 'That username is taken');
      throw e;
    }
    return c.json({ ok: true });
  })

  .post('/auth/login', async (c) => {
    const b = await body(c, z.object({ username: z.string().max(40), password: z.string().max(128) }));
    const username = b.username.trim().toLowerCase();
    rateLimit(`login:${clientIp(c)}`, 30); // caps argon2 work per IP across usernames
    rateLimit(`login:${clientIp(c)}:${username}`, 5);
    const user = db.select().from(users).where(eq(users.username, username)).get();
    // Unknown usernames still pay for a verify, so timing doesn't reveal which exist.
    dummyHash ??= hashPassword(newToken());
    const ok = await verifyPassword(b.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) throw new ApiError(401, 'invalid_credentials', 'Wrong username or password');
    const rehash = needsRehash(user.passwordHash) ? await hashPassword(b.password) : null;
    db.transaction((tx) => {
      if (rehash) tx.update(users).set({ passwordHash: rehash }).where(eq(users.id, user.id)).run();
      if (c.var.session) tx.delete(sessions).where(eq(sessions.id, c.var.session.id)).run();
      createSession(tx, c, user.id);
    });
    return c.json({ ok: true });
  })

  .post('/auth/logout', (c) => {
    if (c.var.session) db.delete(sessions).where(eq(sessions.id, c.var.session.id)).run();
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  })

  .get('/me', (c) => {
    const u = c.var.user;
    return c.json({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isAdmin: u.isAdmin,
      remindTurn: u.remindTurn,
      pushReady: c.var.session.pushSubId !== null,
    });
  })

  .patch('/me/settings', async (c) => {
    const b = await body(c, z.object({ remindTurn: z.boolean().optional(), displayName: DisplayName.optional() }));
    const uid = c.var.user.id;
    if (b.remindTurn !== undefined) db.update(users).set({ remindTurn: b.remindTurn }).where(eq(users.id, uid)).run();
    if (b.displayName !== undefined && b.displayName !== c.var.user.displayName) {
      db.update(users).set({ displayName: b.displayName }).where(eq(users.id, uid)).run();
      renamed(uid, b.displayName); // open games and groups show the new name now
    }
    return c.json({ ok: true });
  });
