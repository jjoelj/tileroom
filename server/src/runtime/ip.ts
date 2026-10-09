// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

/** Client IP for rate limits. X-Forwarded-For is trusted only from the local Nginx (SPEC §11). */
export function clientIp(c: Context) {
  let remote: string | undefined;
  try {
    remote = getConnInfo(c).remote.address;
  } catch {
    remote = undefined; // no socket, e.g. app.request() in tests
  }
  const local = !remote || remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
  return (local && forwarded) || remote || 'local';
}
