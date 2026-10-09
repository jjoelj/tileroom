// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Origins the app is served from, comma-separated (e.g. localhost plus a Tailscale Funnel URL in dev). */
export const PUBLIC_ORIGINS = (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim());

/** An expected failure: becomes `{error, message?}` with this status. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Parses the JSON body with zod; 400 `invalid_body` otherwise. Never logs the body. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const r = schema.safeParse(json);
  if (!r.success) throw new ApiError(400, 'invalid_body', r.error.issues[0]?.message);
  return r.data;
}

const hits = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window limiter; throws 429 past `max` hits per `windowMs` for `key`. */
export function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  // ponytail: in-memory, single process; fine for one container (SPEC §1 non-goals)
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.resetAt <= now) return void hits.set(key, { count: 1, resetAt: now + windowMs });
  if (++h.count > max) throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again in a minute.');
}

export const resetRateLimits = () => hits.clear();
