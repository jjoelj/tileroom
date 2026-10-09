// SPDX-License-Identifier: AGPL-3.0-or-later
// Server-side bootstrap. The only way to create an account without an invite (SPEC §6).
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { checkPassword, Username } from './auth';
import { newInviteCode, normalizeCode, randomId, sha256 } from './codes';
import { invites, users } from './db/schema';
import { ApiError } from './http';
import { db, migrate } from './runtime/db';
import { hashPassword } from './runtime/hash';

const piped = process.stdin.isTTY ? undefined : createInterface({ input: process.stdin })[Symbol.asyncIterator]();

/** Reads a line without echoing it (or from piped stdin). */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  if (piped) {
    const line = (await piped.next()).value ?? '';
    process.stdout.write('\n');
    return line;
  }
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve) => {
    let s = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') process.exit(130);
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(s);
        }
        s = ch === '\u007f' || ch === '\b' ? s.slice(0, -1) : s + ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function createAdmin(name: string | undefined) {
  const parsed = Username.safeParse(name ?? '');
  if (!parsed.success) throw new Error('Usage: bun run cli create-admin <username>  (3–20 of a-z 0-9 _)');
  const username = parsed.data;
  if (db.select().from(users).where(eq(users.username, username)).get()) throw new Error(`${username} already exists`);
  const password = await askHidden('Password: ');
  if (password.length < 10 || password.length > 128) throw new Error('Use 10–128 characters');
  checkPassword(password, username);
  if ((await askHidden('Confirm password: ')) !== password) throw new Error("Passwords don't match");
  db.insert(users).values({ id: randomId(), username, displayName: username, passwordHash: await hashPassword(password), isAdmin: true }).run();
  console.log(`Created admin ${username}`);
}

function createInvite(note: string | undefined) {
  const code = newInviteCode();
  const normalized = normalizeCode(code);
  db.insert(invites).values({ codeHash: sha256(normalized), codeHint: normalized.slice(-4), note }).run();
  console.log(code); // shown once; only the hash is stored
}

const [command, arg] = process.argv.slice(2);
migrate();
try {
  if (command === 'create-admin') await createAdmin(arg);
  else if (command === 'create-invite') createInvite(arg);
  else throw new Error('Commands: create-admin <username>, create-invite [note]');
} catch (e) {
  console.error(e instanceof ApiError ? e.message : (e as Error).message);
  process.exitCode = 1;
}
process.exit();
