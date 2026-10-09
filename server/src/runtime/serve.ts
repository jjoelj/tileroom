// SPDX-License-Identifier: AGPL-3.0-or-later
export type Socket = { send(data: string): void; close(code?: number, reason?: string): void };

/** WebSocket endpoint: `accept` decides from the upgrade request (null rejects it); the rest see accept's data. */
export type Sockets<T> = {
  path: string;
  accept(req: Request): T | null;
  open(ws: Socket, data: T): void;
  message(ws: Socket, data: T, text: string): void;
  close(ws: Socket, data: T): void;
};

export function serve<T>(fetch: (req: Request) => Response | Promise<Response>, port: number, hostname: string, sockets: Sockets<T>) {
  type Data = { data: T };
  return Bun.serve<Data>({
    port,
    hostname,
    fetch(req, server) {
      if (new URL(req.url).pathname !== sockets.path) return fetch(req);
      const data = sockets.accept(req);
      if (data === null) return new Response('Forbidden', { status: 403 });
      return server.upgrade(req, { data: { data } }) ? undefined : new Response('Upgrade required', { status: 426 });
    },
    websocket: {
      idleTimeout: 120, // seconds; Bun pings idle sockets, so a quiet but live client stays connected
      open: (ws) => sockets.open(ws, ws.data.data),
      message: (ws, msg) => sockets.message(ws, ws.data.data, typeof msg === 'string' ? msg : msg.toString()),
      close: (ws) => sockets.close(ws, ws.data.data),
    },
  });
}
