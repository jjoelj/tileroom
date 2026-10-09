// SPDX-License-Identifier: AGPL-3.0-or-later
export function serve(fetch: (req: Request) => Response | Promise<Response>, port: number, hostname: string) {
  return Bun.serve({ port, hostname, fetch });
}
