// SPDX-License-Identifier: AGPL-3.0-or-later
// `bun run dev`: the API server (watch mode) and the Vite client together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const run = (script: string) => spawn('bun', ['run', script], { stdio: 'inherit', shell: true });
const children = [run('dev:server'), run('dev:client')];
const stop = (code = 0) => {
  for (const c of children) c.kill();
  process.exit(code);
};
process.on('SIGINT', () => stop());
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
