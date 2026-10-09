// SPDX-License-Identifier: AGPL-3.0-or-later

/** "1 win", "2 wins", "0 tiles left". The only way counts are written in copy. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
