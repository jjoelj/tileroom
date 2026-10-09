// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes, randomInt } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const randomId = () => randomBytes(12).toString('base64url');
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const randomCode = (n: number) => Array.from({ length: n }, () => CROCKFORD[randomInt(32)]).join('');

/** Uppercase, drop spaces and dashes, map Crockford look-alikes (O→0, I/L→1). */
export const normalizeCode = (s: string) =>
  s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

const group = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g'))!.join('-');

/** 12 chars, ~60 bits, shown once as XXXX-XXXX-XXXX. */
export const newInviteCode = () => group(randomCode(12), 4);

/** 6 chars as K7Q-4XM: short enough to type, guessing is rate-limited (SPEC §10). */
export const newJoinCode = () => randomCode(6);
export const formatJoinCode = (code: string) => group(code, 3);
