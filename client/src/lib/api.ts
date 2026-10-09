// SPDX-License-Identifier: AGPL-3.0-or-later
import { session } from './state.svelte';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? 'Something went wrong. Try again.');
  }
}

/** JSON request to /api. 401 signs out, 428 sends the user back to the notifications gate. */
export async function api<T = unknown>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) session.me = null;
    if (res.status === 428 && session.me) session.me.pushReady = false;
    throw new ApiError(res.status, json?.error ?? 'error', json?.message);
  }
  return json as T;
}
