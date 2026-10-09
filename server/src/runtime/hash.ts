// SPDX-License-Identifier: AGPL-3.0-or-later
// OWASP argon2id parameters (SPEC §6). Bun's argon2 always uses parallelism 1.
const PARAMS = { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 } as const;

export const hashPassword = (password: string) => Bun.password.hash(password, PARAMS);

export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);

/** True when the stored hash was made with other parameters and should be redone on login. */
export const needsRehash = (hash: string) => !hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$');
